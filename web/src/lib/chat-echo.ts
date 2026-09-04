/**
 * Settling the OPTIMISTIC bubble against the server's echo.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY THE MESSAGE IS DRAWN BEFORE THE SERVER CONFIRMS IT. (user 05/09)     │
 * │                                                                          │
 * │ The chat pane used to draw NOTHING until the user's own sentence came     │
 * │ back as a `master.message` event: POST → daemon emits → SSE → store. On   │
 * │ a quiet daemon that is imperceptible; with a worker running it stretched  │
 * │ to 1–2 seconds of the box being empty after pressing Send.                │
 * │                                                                          │
 * │ And there is nothing to wait FOR. `office.say()` emits that echo on its   │
 * │ very first line, before `resolveRefs`, before the mailbox, before any     │
 * │ model call — it cannot fail on content, and what the human typed is not   │
 * │ a fact the server is the authority on. Waiting bought nothing.            │
 * │                                                                          │
 * │ ⚠ The echo still MUST NOT be dropped: it is what keeps a second tab and   │
 * │ the Telegram bridge on one single stream. So the bubble is drawn at once  │
 * │ and marked `pending`, and the echo SETTLES it instead of appending a      │
 * │ duplicate.                                                                │
 * │                                                                          │
 * │ Matching on the text itself is exact, not a heuristic: `office.say` emits │
 * │ `message` VERBATIM, before `@path` rewriting touches it, so both ends     │
 * │ hold byte-identical strings. Oldest-first, so sending the same sentence   │
 * │ twice settles two bubbles in the order they were sent.                    │
 * │                                                                          │
 * │ Its own module, not a method on the store: the store imports the `@i18n`  │
 * │ alias, which a plain `node --test` cannot resolve — the same reason       │
 * │ `markdown-core.ts` sits apart from `markdown.tsx`. A pure function is     │
 * │ also the only shape this can be tested in at all.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * @returns the settled list, or `undefined` when this echo matches no pending
 *   bubble — the caller then appends it the ordinary way. `undefined` rather
 *   than the untouched list so the caller cannot accidentally treat "nothing to
 *   settle" as "already handled" and swallow a message from another tab.
 */
export function mergeUserEcho<T extends { role: string; text: string; pending?: boolean }>(
  messages: readonly T[],
  say: string,
): T[] | undefined {
  const at = messages.findIndex((m) => m.pending === true && m.role === 'user' && m.text === say);
  if (at < 0) return undefined;
  return messages.map((m, i) => {
    if (i !== at) return m;
    // The key is REMOVED, not set to undefined: `pending` is what marks a bubble
    // as still settle-able, and a lingering key would let the next identical
    // echo settle the same bubble twice.
    const { pending: _settled, ...rest } = m;
    return rest as T;
  });
}
