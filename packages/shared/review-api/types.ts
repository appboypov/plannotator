/**
 * Review API v1: the wire shapes of the fork's always-on review service.
 *
 * The contract is Lavish's review API v1 (`~/Repos/Forks/pew-pew-lavish/docs/review-api.md`)
 * with the same JSON field names, so a plugin written for Lavish reads it unchanged.
 * Plannotator's words map onto Lavish's wire names: a Remark travels as a
 * `feedback_item` with an `fi_` id, Approve is the `finish` notice. What Plannotator
 * adds (a `temporary` Visibility, Approve notes, the stored Reply) is additive.
 * `docs/review-api.md` is the prose contract; this file is its types.
 */

// ---------------------------------------------------------------------------
// Identifiers and closed sets
// ---------------------------------------------------------------------------

/** A Review's id: 16 lowercase hex characters, the same for the same canonical subject. */
export type ReviewId = string;

/** A Remark's id: `fi_` plus 24 lowercase hex characters, unique across Reviews. */
export type RemarkId = string;

/** A Finish or Cancel notice's id: `nt_` plus 24 lowercase hex characters. */
export type NoticeId = string;

/** A Reply's id: `rp_` plus 24 lowercase hex characters. */
export type ReplyId = string;

/** An omp session id naming a listener. */
export type SessionId = string;

/** An ISO 8601 time, such as `2026-10-01T09:00:00.000Z`. */
export type IsoTime = string;

/**
 * Who can open a Review's page: `local` (this Mac), `public` (anyone with the link,
 * through ctas.de-appspecialist.nl) or `temporary` (anyone with the link, through ngrok).
 */
export type Visibility = "local" | "public" | "temporary";

/** Every Visibility, in the order the docs name them. */
export const VISIBILITIES: readonly Visibility[] = ["local", "public", "temporary"];

/** How a Review's current Round stands. */
export type ReviewState = "open" | "finished" | "cancelled";

/** How an ended Round ended: Approve on the page, or Cancel by an agent. */
export type EndedState = Exclude<ReviewState, "open">;

/** Who ended a Round last: the reviewer on the page, or an agent. Upstream's reopen gate. */
export type EndedBy = "user" | "agent";

/** What an open did: opened (or kept open), or found a Review the reviewer ended. */
export type OpenStatus = "opened" | "user-ended";

/** The Reviews a listener hears: every Review, including later ones, or the named ones. */
export type Subscription = "all" | ReviewId[];

// ---------------------------------------------------------------------------
// Version and health
// ---------------------------------------------------------------------------

/** `GET /api/review/version`: the review API version the service speaks. */
export type ApiVersion = { major: number; minor: number };

/** `GET /plannotator/health`: the service is up, with its build version. */
export type HealthResponse = {
  ok: true;
  app: "plannotator";
  /** The fork build version, such as `0.27.22`. */
  version: string;
  api: ApiVersion;
  /** The LaunchAgent running the service, present when launchd runs it. */
  service?: { label: string };
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Every refused request answers an `error` string. */
export type ErrorResponse = { error: string };

/** A Reply naming Remarks the Review does not have: HTTP 400, nothing written. */
export type UnknownRemarksResponse = { error: "unknown feedback items"; unknown: RemarkId[] };

// ---------------------------------------------------------------------------
// Shapes: Round, Remark, Reply, Review
// ---------------------------------------------------------------------------

/** A Round of a Review: its number, starting at 1, and how it stands. */
export type Round = {
  review_id: ReviewId;
  round: number;
  state: ReviewState;
};

/** Where on the document or code diff a Remark sits. Each field is `""` when the page sent none. */
export type RemarkAnchor = {
  /** The annotated block id or file/line selector, `""` for a global comment. */
  selector: string;
  /** The annotation kind, lowercase: `comment`, `deletion` or `global_comment`. */
  tag: string;
  /** The annotated excerpt of the document. */
  text: string;
};

/** A Remark: one annotation the reviewer sent, stored in its Review's Round. */
export type Remark = {
  id: RemarkId;
  review_id: ReviewId;
  /** The Round the Remark was sent in. */
  round: number;
  /** The reviewer's words; `""` for an annotation without words, such as a deletion. */
  text: string;
  anchor: RemarkAnchor;
  /**
   * Plannotator's addition: the page's whole Send feedback text this Remark came with,
   * upstream's agent-facing markdown (with what is not a Remark, such as question answers,
   * images and code annotations). Every Remark of one Send feedback carries the same text.
   * Absent on Remarks stored without it.
   */
  feedback?: string;
};

/** An open Remark in a one-file list: a Remark and when it was stored. */
export type OpenRemark = Remark & { at: IsoTime | null };

/** A Reply: an agent's answer, shown on the page beside the Remarks it answers. */
export type Reply = {
  id: ReplyId;
  review_id: ReviewId;
  text: string;
  /** The Remarks this Reply answers, each once, in the order named. */
  answers: RemarkId[];
  at: IsoTime;
};

/** Whether a Remark still waits for an answer: `answered` once a Reply names it. */
export type RemarkStatus = "open" | "answered";

/** A Remark as its Review page shows it: when it was stored, its status and the Replies that answer it. */
export type PageRemark = Remark & {
  at: IsoTime;
  status: RemarkStatus;
  /** The Replies naming this Remark, in the order they were sent. */
  replies: Reply[];
};

/** `GET /plannotator/session/:review_id/api/review-replies` on HTTP 200, open or ended. */
export type ReviewRepliesResponse = {
  review_id: ReviewId;
  /** Every Remark of every Round, in store order. */
  remarks: PageRemark[];
  /** The Replies that name no Remark, in the order they were sent. */
  replies: Reply[];
};

/** A Review: one document or PR's lasting link, its current Round and who listens. */
export type Review = Round & {
  link: string;
  /** The canonical absolute file path or PR/MR URL. */
  file: string;
  visibility: Visibility;
  round_opened_at: IsoTime | null;
  /** Open Remarks across all Rounds. */
  open_item_count: number;
  last_page_open: IsoTime | null;
  /** The sessions in this Review's line, each once, the one that holds it first. */
  listeners: SessionId[];
  /** Only in a one-file list (`?file=`): the open Remarks in store order. */
  open_items?: OpenRemark[];
};

// ---------------------------------------------------------------------------
// Routes: requests and responses
// ---------------------------------------------------------------------------

/** `POST /api/review/v1/reviews`. */
export type OpenReviewRequest = {
  /** An absolute path to an existing file on this Mac or a supported PR/MR URL. */
  file: string;
  /** Reopen a Review the reviewer finished (Approve). A cancelled one reopens without it. */
  reopen?: boolean;
  /** A new Review opens `local` when absent; an existing Review keeps its own. */
  visibility?: Visibility;
};

/** `POST /api/review/v1/reviews` on HTTP 200. */
export type OpenReviewResponse = {
  review_id: ReviewId;
  link: string;
  status: OpenStatus;
  round: number;
  visibility: Visibility;
};

/** `GET /api/review/v1/reviews[?file=<absolute path or PR URL>]`. */
export type ListReviewsQuery = { file?: string };

/** `GET /api/review/v1/reviews` on HTTP 200, sorted by `file`. */
export type ListReviewsResponse = { reviews: Review[] };

/** `POST /api/review/v1/reviews/:review_id/replies`. */
export type ReplyRequest = {
  text: string;
  /** Remarks of this Review the Reply answers; default `[]`. */
  answers?: RemarkId[];
};

/** `POST /api/review/v1/reviews/:review_id/replies` on HTTP 200. */
export type ReplyResponse = {
  status: "sent";
  answered: RemarkId[];
  reply: Reply;
};

/** `POST /api/review/v1/reviews/:review_id/cancel` on HTTP 200 (no request body). */
export type CancelReviewResponse = Omit<Round, "state"> & { state: EndedState };

/** `POST /api/review/v1/reviews/:review_id/visibility`. */
export type VisibilityRequest = { visibility: Visibility };

/** `POST /api/review/v1/reviews/:review_id/visibility` on HTTP 200. */
export type VisibilityResponse = {
  review_id: ReviewId;
  visibility: Visibility;
  link: string;
};

// ---------------------------------------------------------------------------
// The page's Round-checked commands
// ---------------------------------------------------------------------------

/** HTTP 409: the page's `round` is not the Review's current Round. */
export type StaleRoundResponse = { status: "stale-round"; error: string; round: number };

/** HTTP 409: the current Round has ended. */
export type EndedRoundResponse = {
  status: "ended";
  error: string;
  round: number;
  state: EndedState | null;
  ended_by: EndedBy | null;
};

/** What a Round-checked page command answers when its Round is not open. */
export type RoundRefusal = StaleRoundResponse | EndedRoundResponse;

// ---------------------------------------------------------------------------
// Listen socket: `/api/review/v1/listen?session=<omp session id>`
// ---------------------------------------------------------------------------

/** Client: replace the subscription; the server replays the backlog of each Review it comes to hold. */
export type SubscribeMessage = { type: "subscribe"; reviews: Subscription };

/** Client: acknowledge a Finish or Cancel notice so it is not replayed again. */
export type AckMessage = { type: "ack"; id: NoticeId };

/** Every message a listener may send. */
export type ListenClientMessage = SubscribeMessage | AckMessage;

/** Server: a Remark, live or replayed. */
export type RemarkEvent = { type: "feedback_item" } & Remark;

/** Server: the reviewer approved, which finished the Round. */
export type FinishNotice = {
  type: "finish";
  id: NoticeId;
  review_id: ReviewId;
  round: number;
  at: IsoTime;
  /** The Approve's notes; `""` for an Approve without notes, and for a Close. */
  notes: string;
  /**
   * Plannotator's addition: `true` when the reviewer closed the page (Close) instead of
   * approving, which upstream's annotate reports as `dismissed`. Absent on an Approve;
   * Lavish clients ignore it.
   */
  dismissed?: true;
};

/** Server: an agent cancelled the Round. */
export type CancelNotice = {
  type: "cancel";
  id: NoticeId;
  review_id: ReviewId;
  round: number;
  at: IsoTime;
};

/** A stored notice that closed a Round; replayed until acknowledged. */
export type Notice = FinishNotice | CancelNotice;

/** Server: the subscription is installed, after its replay. */
export type SubscribedMessage = { type: "subscribed"; reviews: Subscription };

/** Server: a client message was refused; nothing changed and the socket stays open. */
export type ListenErrorMessage = { type: "error"; error: string };

/** Every message the listen socket sends. */
export type ListenServerMessage = RemarkEvent | Notice | SubscribedMessage | ListenErrorMessage;
