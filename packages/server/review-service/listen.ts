/**
 * The listen socket, `/api/review/v1/listen?session=<omp session id>`: one listener
 * per session, each with the Reviews it subscribed to. A subscription replays the
 * backlog of the Reviews it adds (open Remarks the session has not received and
 * pending Finish or Cancel notices, in store order), then announces the other
 * listeners it overlaps and confirms; later Remarks, notices and page loads go out
 * live. Contract: docs/review-api.md "Listen to Reviews".
 */
import {
  parseListenClientMessage,
  type ListenServerMessage,
  type PageOpenEvent,
  type ReviewId,
  type SessionId,
  type Subscription,
} from "@plannotator/shared/review-api";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { noticeEvent, remarkEvent, type BacklogRecord, type ReviewRecords, type StoredNotice, type StoredRemark } from "./records.ts";

/** What the service keeps per listen socket. */
export type ListenData = {
  session: SessionId;
  subscription: Subscription;
  /** Record ids sent on this socket, so a replay and a live send never both arrive. */
  sent: Set<string>;
  awaitingPong: boolean;
};

/** A client frame over this closes the socket with 1009. */
export const LISTEN_MAX_PAYLOAD = 64 * 1024;

/**
 * Bun drops a frame over its own limit without a close code, so its limit sits above
 * the contract's and the service closes with 1009 itself.
 */
const TRANSPORT_MAX_PAYLOAD = 1024 * 1024;

/** The service pings every listener this often and drops one that left the last ping unanswered. */
export const LISTEN_HEARTBEAT_MS = 30_000;

type Socket = ServerWebSocket<ListenData>;

function includes(subscription: Subscription, reviewId: ReviewId): boolean {
  return subscription === "all" || subscription.includes(reviewId);
}

/** The Reviews [a] and [b] both hold, in [a]'s order. */
function overlap(a: Subscription, b: Subscription): Subscription {
  if (a === "all") return b === "all" ? "all" : [...b];
  return a.filter((reviewId) => includes(b, reviewId));
}

/** A new socket's data for [session], subscribed to nothing yet. */
export function listenData(session: SessionId): ListenData {
  return { session, subscription: [], sent: new Set(), awaitingPong: false };
}

export class ReviewListeners {
  private readonly sockets = new Map<SessionId, Socket>();
  private readonly heartbeat: Timer;

  constructor(
    private readonly records: ReviewRecords,
    private readonly log: (line: string) => void,
    heartbeatMs: number = LISTEN_HEARTBEAT_MS,
  ) {
    this.heartbeat = setInterval(() => this.ping(), heartbeatMs);
    this.heartbeat.unref?.();
  }

  readonly websocket: WebSocketHandler<ListenData> = {
    maxPayloadLength: TRANSPORT_MAX_PAYLOAD,
    // The heartbeat below decides when a listener is gone; Bun's own idle close would
    // drop a quiet but healthy one.
    idleTimeout: 0,
    sendPings: false,
    open: (socket) => {
      const { session } = socket.data;
      const previous = this.sockets.get(session);
      this.sockets.set(session, socket);
      previous?.close(1000, "replaced by a new listener");
      this.log(`listener connected session=${session}`);
    },
    message: (socket, frame) => {
      if (Buffer.byteLength(frame) > LISTEN_MAX_PAYLOAD) return socket.close(1009, "message too big");
      return this.receive(socket, typeof frame === "string" ? frame : frame.toString("utf8")).catch((cause: unknown) => {
        const error = cause instanceof Error ? cause.message : String(cause);
        this.log(`listener message failed session=${socket.data.session}: ${error}`);
        send(socket, { type: "error", error });
      });
    },
    pong: (socket) => {
      socket.data.awaitingPong = false;
    },
    close: (socket) => {
      const { session } = socket.data;
      if (this.sockets.get(session) !== socket) return;
      this.sockets.delete(session);
      this.log(`listener disconnected session=${session}`);
    },
  };

  /** Sessions whose subscription includes [reviewId], each once. */
  subscribers(reviewId: ReviewId): SessionId[] {
    return this.listenersOf(reviewId).map((socket) => socket.data.session);
  }

  /** Sends Remarks just stored to every listener of their Review that has not received them. */
  async remarksStored(reviewId: ReviewId, stored: readonly StoredRemark[]): Promise<void> {
    const backlog = stored.map((remark): BacklogRecord => ({ kind: "remark", remark }));
    await Promise.all(this.listenersOf(reviewId).map((socket) => this.deliver(socket, reviewId, backlog)));
  }

  /** Sends a notice just stored to every listener of its Review. */
  async noticeStored(notice: StoredNotice): Promise<void> {
    const backlog: BacklogRecord[] = [{ kind: "notice", notice }];
    await Promise.all(this.listenersOf(notice.review_id).map((socket) => this.deliver(socket, notice.review_id, backlog)));
  }

  /** Live only: tells the Review's listeners its page was loaded. */
  pageOpened(event: PageOpenEvent): void {
    for (const socket of this.listenersOf(event.review_id)) send(socket, event);
  }

  private listenersOf(reviewId: ReviewId): Socket[] {
    return [...this.sockets.values()].filter((socket) => includes(socket.data.subscription, reviewId));
  }

  /** Closes every listener and stops the heartbeat. */
  stop(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.values()) socket.close(1001, "service stopping");
    this.sockets.clear();
  }

  private async receive(socket: Socket, frame: string): Promise<void> {
    const parsed = parseListenClientMessage(frame);
    if (!parsed.ok) {
      send(socket, { type: "error", error: parsed.error });
      return;
    }
    const message = parsed.value;
    if (message.type === "ack") {
      // As in Lavish, any listener may acknowledge any notice; a known one answers nothing.
      const result = await this.records.acknowledge(message.id, new Date().toISOString());
      if (result === "unknown") send(socket, { type: "error", error: `unknown notice ${message.id}` });
      return;
    }
    if (this.sockets.get(socket.data.session) !== socket) return;
    const previous = socket.data.subscription;
    socket.data.subscription = message.reviews;
    let replayed = 0;
    for (const reviewId of this.records.reviewIds()) {
      if (!includes(message.reviews, reviewId) || includes(previous, reviewId)) continue;
      replayed += await this.deliver(socket, reviewId, this.records.backlog(reviewId));
    }
    this.announce(socket);
    send(socket, { type: "subscribed", reviews: message.reviews });
    this.log(
      `listener subscribed session=${socket.data.session} reviews=${message.reviews === "all" ? "all" : message.reviews.length} replayed=${replayed}`,
    );
  }

  /**
   * Sends the records of [backlog] the socket still needs, in order: open Remarks its
   * session has not received, pending notices this socket has not sent. Returns how many.
   */
  private async deliver(socket: Socket, reviewId: ReviewId, backlog: readonly BacklogRecord[]): Promise<number> {
    const { session, sent } = socket.data;
    const remarkIds: string[] = [];
    let count = 0;
    for (const record of backlog) {
      const id = record.kind === "remark" ? record.remark.id : record.notice.id;
      if (sent.has(id)) continue;
      if (record.kind === "remark" && (record.remark.status !== "open" || record.remark.delivered_to.includes(session))) continue;
      if (record.kind === "notice" && record.notice.status !== "pending") continue;
      // A socket that is closing drops the frame; the record then waits for the session's next socket.
      if (!send(socket, record.kind === "remark" ? remarkEvent(record.remark) : noticeEvent(record.notice))) break;
      sent.add(id);
      if (record.kind === "remark") remarkIds.push(id);
      count += 1;
    }
    if (remarkIds.length > 0) await this.records.delivered(reviewId, remarkIds, session);
    return count;
  }

  /** Tells [socket] and every listener it overlaps about each other. */
  private announce(socket: Socket): void {
    for (const other of this.sockets.values()) {
      if (other === socket) continue;
      const shared = overlap(socket.data.subscription, other.data.subscription);
      if (shared !== "all" && shared.length === 0) continue;
      send(socket, { type: "listener", session: other.data.session, reviews: shared });
      send(other, {
        type: "listener",
        session: socket.data.session,
        reviews: overlap(other.data.subscription, socket.data.subscription),
      });
    }
  }

  private ping(): void {
    for (const socket of this.sockets.values()) {
      if (socket.data.awaitingPong) {
        this.log(`listener missed a heartbeat session=${socket.data.session}`);
        socket.terminate();
        continue;
      }
      socket.data.awaitingPong = true;
      socket.ping();
    }
  }
}

/** Sends [message]; false when the socket dropped it (Bun answers 0 for a closed socket). */
function send(socket: Socket, message: ListenServerMessage): boolean {
  return socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message)) !== 0;
}
