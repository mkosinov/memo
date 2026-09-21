/**
 * Channel-health flag (GH #330, spec §5.1).
 *
 * Deliberately NON-React: a plain module-level boolean with synchronous
 * accessors. The only reader is the synchronous QueryCache.onError callback
 * (wired in Task 5) which classifies fetch failures as «network lost» only
 * while the SSE channel is also down; later — the «no response» branch of
 * the deletion error contract (docs/domain-rules/deletion.md).
 *
 * No React reactivity on purpose: nothing renders from this flag — the
 * user-facing indicator is the persistent toast owned by
 * ServerEventsProvider.
 */

/** True only while the SSE channel is in a recoverable-lost state. */
let channelDown = false;

export function setChannelDown(down: boolean): void {
  channelDown = down;
}

export function isChannelDown(): boolean {
  return channelDown;
}
