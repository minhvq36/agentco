/**
 * 🔴 WHAT THE RING BUFFER IS ALLOWED TO REPLAY WHEN AN OFFICE IS OPENED.
 * → `store.ts §openOffice` · `server.ts` (`GET /api/office/:id` → `history`)
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ MEASURED 08/09: EVERY RELOAD EMPTIED THE CHAT PANE, AND NOTHING WAS LOST │
 * │ ON DISK.                                                                 │
 * │                                                                          │
 * │ `openOffice` replays two sources in order: `chat` (the conversation read │
 * │ from `.state/chat.jsonl`) and then `history` (the daemon's in-memory     │
 * │ ring buffer, for live state). The second loop skipped `master.message`   │
 * │ so the thread was not printed twice — and applied everything else.       │
 * │                                                                          │
 * │ `office.cleared` was in that buffer: one `/clear` at 12:10, then twenty  │
 * │ messages of real conversation. On F5 the twenty came back from disk and  │
 * │ the replayed `office.cleared` — index 3 of 119, from a moment two hours  │
 * │ gone — wiped them, while the messages that would have refilled the pane  │
 * │ were the ones being skipped. The user's report was *"I never pressed     │
 * │ /clear"*, and they were right: they pressed it once, long before.        │
 * │                                                                          │
 * │ ⚠ THE RULE IS NOT "SKIP THE ONE THAT BIT US". A ring buffer replays the  │
 * │ PAST; an event that is an INSTRUCTION (a thing that happened at one      │
 * │ moment) obeys it a second time, while an event that is a STATE simply    │
 * │ lands on its own latest value. `office.cleared` already says so in its   │
 * │ own store branch — *"an INSTRUCTION, not a sentence to read"* — ten      │
 * │ lines from the loop that replayed it anyway.                             │
 * │                                                                          │
 * │ ⇒ Every new event type has to answer this question here, in one list,    │
 * │ rather than each caller deciding again. → `test/chat-replay.test.ts`     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import type { AgentEvent } from './types';

/**
 * The two the replay must not apply, and they are excluded for DIFFERENT
 * reasons — worth keeping apart, because a third one will be one or the other:
 *
 *   `master.message`  already replayed from disk, one line earlier. Applying it
 *                     here prints the whole conversation twice.
 *   `office.cleared`  an instruction that empties the pane. It happened once,
 *                     at a moment that has passed, and the disk already shows
 *                     what survived it — `/clear` deletes `chat.jsonl` itself.
 */
const NOT_REPLAYED: ReadonlySet<AgentEvent['type']> = new Set<AgentEvent['type']>([
  'master.message',
  'office.cleared',
]);

/** May this event from the ring buffer be applied to the store? */
export const replayable = (type: AgentEvent['type']): boolean => !NOT_REPLAYED.has(type);
