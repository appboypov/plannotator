/**
 * The listen socket, `/api/review/v1/listen?session=<omp session id>`: one listener
 * per session, each with the Reviews it subscribed to. Each Review has a line of the
 * listeners whose subscription includes it: those that name it, in the order they
 * started naming it, then those subscribed to all, in the order they subscribed to
 * all. The first in line holds the Review and alone receives its Remarks and notices.
 * Whenever a Review's holder changes, by a subscription or a socket opening or
 * closing, the new holder first receives the Review's backlog (open Remarks its
 * session has not received and pending notices this socket has not received, in store
 * order); a subscription confirms with `subscribed` after its own share of that.
 * Contract: docs/review-api.md "Listen to Reviews".
 */
import {
  parseListenClientMessage,
  type ListenServerMessage,
  type ReviewId,
  type SessionId,
} from "@plannotator/shared/review-api";
import type { ServerWebSocket, WebSocketHandler } from "bun";
import { noticeEvent, remarkEvent, type BacklogRecord, type ReviewRecords, type StoredNotice, type StoredRemark } from "./records.ts";

/** What the service keeps per listen socket. */
export type ListenData = {
  session: SessionId;
  /**
   * The socket's subscription with its place in each line it stands in: per Review it
   * names, or once for every Review when it subscribed to all. A lower number stands
   * further ahead.
   */
  place: { named: Map<ReviewId, number> } | { all: number };
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

/** A new socket's data for [session], subscribed to nothing yet. */
export function listenData(session: SessionId): ListenData {
  return { session, place: { named: new Map() }, sent: new Set(), awaitingPong: false };
}

export class ReviewListeners {
  private readonly sockets = new Map<SessionId, Socket>();
  private readonly heartbeat: Timer;
  /** Hands out places in line: each new place stands behind every earlier one. */
  private places = 0;

  constructor(
    private readonly records: ReviewRecords,
    private readonly log: (line: string) => void,
    heartbeatMs: number = LISTEN_HEARTBEAT_MS,
    private readonly linked: (reviewId: ReviewId) => boolean = () => false,
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
      // The replaced socket leaves its lines now, so nothing more goes to a closing socket.
      void this.reline(() => this.sockets.set(session, socket)).catch((cause: unknown) => this.failed(session, cause));
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
      void this.reline(() => this.sockets.delete(session)).catch((cause: unknown) => this.failed(session, cause));
      this.log(`listener disconnected session=${session}`);
    },
  };

  /** The sessions in [reviewId]'s line, its holder first. */
  subscribers(reviewId: ReviewId): SessionId[] {
    return this.line(reviewId).map((socket) => socket.data.session);
  }

  /** Sends Remarks just stored to their Review's holder. */
  async remarksStored(reviewId: ReviewId, stored: readonly StoredRemark[]): Promise<void> {
    const holder = this.line(reviewId)[0];
    if (holder) await this.deliver(holder, reviewId, stored.map((remark): BacklogRecord => ({ kind: "remark", remark })));
  }

  /** Sends a notice just stored to its Review's holder. */
  async noticeStored(notice: StoredNotice): Promise<void> {
    const holder = this.line(notice.review_id)[0];
    if (holder) await this.deliver(holder, notice.review_id, [{ kind: "notice", notice }]);
  }

  /** Closes every listener and stops the heartbeat. */
  stop(): void {
    clearInterval(this.heartbeat);
    for (const socket of this.sockets.values()) socket.close(1001, "service stopping");
    this.sockets.clear();
  }

  /** The current sockets whose subscription includes [reviewId], in line order. */
  private line(reviewId: ReviewId): Socket[] {
    if (this.linked(reviewId)) return [];
    const named: [number, Socket][] = [];
    const all: [number, Socket][] = [];
    for (const socket of this.sockets.values()) {
      const { place } = socket.data;
      if ("all" in place) all.push([place.all, socket]);
      else if (place.named.has(reviewId)) named.push([place.named.get(reviewId)!, socket]);
    }
    const byPlace = (a: [number, Socket], b: [number, Socket]) => a[0] - b[0];
    return [...named.sort(byPlace), ...all.sort(byPlace)].map(([, socket]) => socket);
  }

  /**
   * Applies [change] to the lines, then hands each Review with records whose holder
   * changed to its new holder: the backlog that holder has not received. Returns how
   * many records each socket received.
   */
  private async reline(change: () => void): Promise<Map<Socket, number>> {
    const reviewIds = this.records.reviewIds();
    const before = reviewIds.map((reviewId) => this.line(reviewId)[0]);
    change();
    const received = new Map<Socket, number>();
    await Promise.all(
      reviewIds.map(async (reviewId, index) => {
        const holder = this.line(reviewId)[0];
        if (!holder || holder === before[index]) return;
        const count = await this.deliver(holder, reviewId, this.records.backlog(reviewId));
        received.set(holder, (received.get(holder) ?? 0) + count);
      }),
    );
    return received;
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
    const { reviews } = message;
    const previous = socket.data.place;
    const received = await this.reline(() => {
      socket.data.place =
        reviews === "all"
          ? { all: "all" in previous ? previous.all : (this.places += 1) }
          : {
              named: new Map(
                reviews.map((reviewId) => [
                  reviewId,
                  ("named" in previous ? previous.named.get(reviewId) : undefined) ?? (this.places += 1),
                ]),
              ),
            };
    });
    send(socket, { type: "subscribed", reviews });
    this.log(
      `listener subscribed session=${socket.data.session} reviews=${reviews === "all" ? "all" : reviews.length} replayed=${received.get(socket) ?? 0}`,
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
      // A socket that is closing drops the frame; the record then waits for the Review's next holder.
      if (!send(socket, record.kind === "remark" ? remarkEvent(record.remark) : noticeEvent(record.notice))) break;
      sent.add(id);
      if (record.kind === "remark") remarkIds.push(id);
      count += 1;
    }
    if (remarkIds.length > 0) await this.records.delivered(reviewId, remarkIds, session);
    return count;
  }

  private failed(session: SessionId, cause: unknown): void {
    this.log(`listener delivery failed session=${session}: ${cause instanceof Error ? cause.message : String(cause)}`);
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
