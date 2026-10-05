import { isAbsolute } from "node:path";
import { parsePRUrl } from "../pr-types";

/** A PR subject uses upstream's URL grammar and one platform URL per request. */
export function canonicalPRSubject(value: string): string | undefined {
  const ref = parsePRUrl(value);
  if (!ref) return undefined;
  switch (ref.platform) {
    case "github": return `https://${ref.host.toLowerCase()}/${ref.owner}/${ref.repo}/pull/${ref.number}`;
    case "gitlab": return `https://${ref.host.toLowerCase()}/${ref.projectPath}/-/merge_requests/${ref.iid}`;
    case "bitbucket": return `https://bitbucket.org/${ref.workspace}/${ref.repo}/pull-requests/${ref.number}`;
  }
}

/** Files retain their path until the service resolves symlinks; URLs normalize without I/O. */
export function parseReviewSubject(value: string): { ok: true; value: string } | { ok: false; error: string } {
  if (/^https?:\/\//i.test(value)) {
    const canonical = canonicalPRSubject(value);
    return canonical ? { ok: true, value: canonical } : { ok: false, error: `Invalid PR/MR URL: ${value}` };
  }
  return isAbsolute(value)
    ? { ok: true, value }
    : { ok: false, error: "file must be an absolute path" };
}
