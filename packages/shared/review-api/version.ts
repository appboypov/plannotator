import type { ApiVersion } from "./types.ts";

/**
 * The review API version this build serves, answered on `GET /api/review/version`.
 *
 * A client checks `major` before it opens, listens or writes: a different major is
 * a different contract. `minor` grows with changes a client may ignore: a new field,
 * or a server message it no longer receives.
 * The version route itself is unversioned, like Lavish's, so any major can be read.
 */
export const API_VERSION: ApiVersion = { major: 1, minor: 3 };
