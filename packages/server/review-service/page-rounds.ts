/**
 * The Round stream of each Review page (`<page>/api/review-round`, an event stream the
 * service answers itself): the Review's Round on connect and again whenever it ends
 * or a new one opens, so an open tab closes when its Round is over (see
 * `@plannotator/shared/review-api/page-round`).
 */
import type { ReviewId, Round } from "@plannotator/shared/review-api";

/** A comment line this often keeps a quiet stream open through the doors' proxies. */
export const PAGE_ROUND_KEEPALIVE_MS = 25_000;

const encoder = new TextEncoder();

type Stream = ReadableStreamDefaultController<Uint8Array>;

export class PageRounds {
  private readonly streams = new Map<ReviewId, Set<Stream>>();
  private readonly keepalive: Timer;

  constructor(keepaliveMs: number = PAGE_ROUND_KEEPALIVE_MS) {
    this.keepalive = setInterval(() => this.each(() => true, encoder.encode(": keepalive\n\n")), keepaliveMs);
    this.keepalive.unref?.();
  }

  /** A page's stream, starting with [round]. */
  stream(round: Round): Response {
    let opened: Stream | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        opened = controller;
        const streams = this.streams.get(round.review_id) ?? new Set<Stream>();
        streams.add(controller);
        this.streams.set(round.review_id, streams);
        controller.enqueue(frame(round));
      },
      cancel: () => {
        if (opened) this.streams.get(round.review_id)?.delete(opened);
      },
    });
    return new Response(body, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" },
    });
  }

  /** Tells every open page of the Review its Round now. */
  publish(round: Round): void {
    this.each((reviewId) => reviewId === round.review_id, frame(round));
  }

  /** Ends every stream and the keepalive. */
  stop(): void {
    clearInterval(this.keepalive);
    for (const streams of this.streams.values()) {
      for (const controller of streams) {
        try {
          controller.close();
        } catch {
          // Already closed by the page.
        }
      }
    }
    this.streams.clear();
  }

  private each(matches: (reviewId: ReviewId) => boolean, chunk: Uint8Array): void {
    for (const [reviewId, streams] of this.streams) {
      if (!matches(reviewId)) continue;
      for (const controller of streams) {
        try {
          controller.enqueue(chunk);
        } catch {
          // The page went away between its last read and this write.
          streams.delete(controller);
        }
      }
    }
  }
}

function frame(round: Round): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(round)}\n\n`);
}
