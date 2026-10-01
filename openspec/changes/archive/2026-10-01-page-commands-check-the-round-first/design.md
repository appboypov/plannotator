## Decisions

- The Round check runs on `store.get(id)` read after `readJson`, with no await before the draft clear is sent, and runs again after the clear. Same rule as `metadata-saves-keep-the-round`: state read before an await is stale after it.
