## Decisions

- Every save that only changes metadata spreads `store.get(id)` read after its last await, so no Round change in flight is overwritten. `ReviewStore.save` already records in memory synchronously and writes the latest state in order.
