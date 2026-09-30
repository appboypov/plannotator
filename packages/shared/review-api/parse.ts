import { isAbsolute } from "node:path";
import {
  VISIBILITIES,
  type ListenClientMessage,
  type ListReviewsQuery,
  type OpenReviewRequest,
  type ReplyRequest,
  type SessionId,
  type Subscription,
  type Visibility,
  type VisibilityRequest,
} from "./types.ts";

/** A parsed request, or the HTTP 400 body that refuses it. Refusals write nothing. */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The refusal texts of review API v1, shared by the service and its docs. */
export const ERRORS = {
  fileRequired: "file path required",
  fileNotAbsolute: "file must be an absolute path",
  visibility: "visibility must be local, public or temporary",
  reopen: "reopen must be a boolean",
  replyText: "reply text required",
  answers: "answers must be an array of Feedback item ids",
  unknownRemarks: "unknown feedback items",
  reviewNotFound: "review not found",
  sessionRequired: "session required",
  round: "round must be a positive integer",
  message: "expected a JSON subscribe or ack message",
  subscription: 'reviews must be "all" or an array of Review ids',
  ackId: "ack needs a notice id",
} as const;

const REVIEW_ID = /^[0-9a-f]{16}$/;

/** Whether [value] has a Review id's form (16 lowercase hex characters). */
export function isReviewId(value: string): boolean {
  return REVIEW_ID.test(value);
}

/** [value] as a Visibility, or undefined when it is not one. */
export function parseVisibility(value: unknown): Visibility | undefined {
  return VISIBILITIES.find((visibility) => visibility === value);
}

/** The body of `POST /api/review/v1/reviews`. */
export function parseOpenReviewRequest(body: unknown): Parsed<OpenReviewRequest> {
  const fields = record(body);
  const file = fields.file;
  if (typeof file !== "string" || !file.trim()) return refuse(ERRORS.fileRequired);
  if (!isAbsolute(file)) return refuse(ERRORS.fileNotAbsolute);
  const request: OpenReviewRequest = { file };
  if (fields.reopen !== undefined) {
    if (typeof fields.reopen !== "boolean") return refuse(ERRORS.reopen);
    request.reopen = fields.reopen;
  }
  if (fields.visibility !== undefined) {
    const visibility = parseVisibility(fields.visibility);
    if (!visibility) return refuse(ERRORS.visibility);
    request.visibility = visibility;
  }
  return { ok: true, value: request };
}

/** The `file` query of `GET /api/review/v1/reviews`; `null` when the query has none. */
export function parseListReviewsQuery(file: string | null): Parsed<ListReviewsQuery> {
  if (file === null) return { ok: true, value: {} };
  if (!file.trim() || !isAbsolute(file)) return refuse(ERRORS.fileNotAbsolute);
  return { ok: true, value: { file } };
}

/** The body of `POST /api/review/v1/reviews/:review_id/replies`; duplicate answers count once. */
export function parseReplyRequest(body: unknown): Parsed<Required<ReplyRequest>> {
  const fields = record(body);
  const text = fields.text;
  if (typeof text !== "string" || !text.trim()) return refuse(ERRORS.replyText);
  const answers = fields.answers ?? [];
  if (!isStringArray(answers)) return refuse(ERRORS.answers);
  return { ok: true, value: { text, answers: [...new Set(answers)] } };
}

/** The body of `POST /api/review/v1/reviews/:review_id/visibility`. */
export function parseVisibilityRequest(body: unknown): Parsed<VisibilityRequest> {
  const visibility = parseVisibility(record(body).visibility);
  return visibility ? { ok: true, value: { visibility } } : refuse(ERRORS.visibility);
}

/** The `session` query of the listen handshake: a nonblank omp session id. */
export function parseListenSession(session: string | null): Parsed<SessionId> {
  return session?.trim() ? { ok: true, value: session } : refuse(ERRORS.sessionRequired);
}

/** One text frame from a listener; duplicate Review ids in a subscription count once. */
export function parseListenClientMessage(frame: string): Parsed<ListenClientMessage> {
  let data: unknown;
  try {
    data = JSON.parse(frame);
  } catch {
    return refuse(ERRORS.message);
  }
  const fields = record(data);
  if (fields.type === "subscribe") {
    const reviews = parseSubscription(fields.reviews);
    return reviews ? { ok: true, value: { type: "subscribe", reviews } } : refuse(ERRORS.subscription);
  }
  if (fields.type === "ack") {
    return typeof fields.id === "string" && fields.id
      ? { ok: true, value: { type: "ack", id: fields.id } }
      : refuse(ERRORS.ackId);
  }
  return refuse(ERRORS.message);
}

function parseSubscription(value: unknown): Subscription | undefined {
  if (value === "all") return "all";
  if (!isStringArray(value) || value.some((id) => !id.trim())) return undefined;
  return [...new Set(value)];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function refuse(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
