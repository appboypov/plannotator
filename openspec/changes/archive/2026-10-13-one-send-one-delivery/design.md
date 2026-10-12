# Design

Generate the batch identity in `remarksFromFeedback`, the common plan/PR Send feedback conversion. Persist it with each Remark and preserve it on load. `remarkEvent` and `openRemark` expose it only when present, so legacy records remain unchanged and live/replayed frames share the same identity.

The per-Review poster selects the first pending record. If it is a batched Remark, collect all still-pending Remarks with that batch identity in store order. Snapshot their destination before posting, render one header and one closing reply instruction, and mark every selected id posted with the same comment id in one atomic remarks file write. The existing relink destination guard applies to the whole selection; a moved destination is not acknowledged. Notices remain independent and keep their existing acknowledgement path.

Tests first cover shared ids, distinct sends, durable reload, legacy absence, live/replay/listing propagation, grouped HTTP posts, pending-only selection, retries, relinking and unchanged single-item formatting. Run only named targeted files plus the repository typecheck.
