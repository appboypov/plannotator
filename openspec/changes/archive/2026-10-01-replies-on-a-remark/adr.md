## ADR Review Manifest

- ADR 0004 (review API v1 matches Lavish): the Reply route keeps Lavish's request, `status`/`answered` answer and unknown-ids refusal; `reply` and the page route are additive.
- ADR 0006 (the service answers the page decisions): the page's Replies route is answered by the service like the Round stream; no new ADR.
- ADR 0003 (fork code in own modules): all changes are in fork modules; upstream files are untouched.
