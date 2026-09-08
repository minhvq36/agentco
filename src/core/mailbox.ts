/**
 * The assistant's mailbox. → docs/SPEC-tools-approval.md §11
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE ASSISTANT IS ONE PERSON. One person does one thing at a time.         │
 * │                                                                           │
 * │ That is not a tidy design choice — it is a TECHNICAL REQUIREMENT.         │
 * │ `askSession()` runs `resume: sessionId` and then overwrites `sessionId`   │
 * │ with the new one. Two overlapping calls both resume the same id and both  │
 * │ overwrite it — and ONE TURN IS LOST OUTRIGHT from the conversation's      │
 * │ memory. The user sees the assistant "forget" what it just said, with no   │
 * │ way to tell why.                                                          │
 * │                                                                           │
 * │ EMPLOYEES, though, run in parallel freely — they are stateless functions, │
 * │ each with its own session. The two states are INDEPENDENT, and the        │
 * │ interface has to say both: "the assistant is thinking" and "2 employees   │
 * │ are working".                                                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/** How many messages may queue before we ask the user to slow down. */
export const MAX_QUEUED = 12;

export type MailItem =
  | { kind: 'user'; text: string; at: number }
  | { kind: 'report'; planId: string; at: number };

export class Mailbox {
  private items: MailItem[] = [];
  private busy = false;

  get size(): number {
    return this.items.length;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** true when accepted; false when the queue is full. */
  push(item: MailItem): boolean {
    if (this.items.length >= MAX_QUEUED) return false;
    this.items.push(item);
    return true;
  }

  /** Drop everything — for `/stop`. Once the work is cancelled, queued messages mean nothing. */
  clear(): number {
    const n = this.items.length;
    this.items = [];
    return n;
  }

  /**
   * Take the next batch, MERGING consecutive user messages into ONE.
   *
   * Three sentences typed while the assistant is busy are ONE THOUGHT. Handling
   * them separately costs three calls AND makes the assistant answer sentence 1
   * while already holding the context of sentence 3. Merging is cheaper and more
   * correct.
   *
   * `report` items are NEVER merged — one summary per shift.
   */
  take(): MailItem[] | undefined {
    const first = this.items.shift();
    if (!first) return undefined;
    if (first.kind !== 'user') return [first];

    const batch: MailItem[] = [first];
    while (this.items[0]?.kind === 'user') batch.push(this.items.shift()!);
    return batch;
  }

  private chain: Promise<unknown> = Promise.resolve();
  private depth = 0;

  /**
   * 🔴 THE ASSISTANT JUST BECAME FREE. Fired ONCE, when the lock fully opens.
   * → `office.ts §pump`
   *
   * ┌──────────────────────────────────────────────────────────────────────
   * │ MEASURED 09/09: THE MAILBOX STUCK AT "2 WAITING", FOREVER.
   * │
   * │ `pump()` refuses to run while this lock is held, and it had exactly two
   * │ triggers: a user message arriving, and the end of a pump cycle. But
   * │ `run()` takes THIS SAME LOCK for its own turns — planning, the report,
   * │ `/clear`'s compaction. A message that lands during one of those is
   * │ pushed, sees `isBusy`, and turns around; the lock then opens with
   * │ nobody watching, and the message sits there until the user happens to
   * │ type again. The header keeps saying "2 waiting" for the rest of the
   * │ session — *"as if it only ever works once"*.
   * │
   * │ ⚠ THE EXIT BELONGS HERE, NOT AT THE THREE CALL SITES. Waking the pump
   * │ after each `lock()` in `office.ts` is the same fix written three times,
   * │ and the fourth caller written next month is the one that forgets. This
   * │ is the one place that knows the mutex just opened.
   * │
   * │ Third instance of one law in three days: *a waiting state needs an exit
   * │ that does not run on the success path.*
   * └──────────────────────────────────────────────────────────────────────
   */
  onFree?: () => void;

  /**
   * Lock the assistant — a REAL MUTEX that queues, not just a flag.
   *
   * A `busy = true/false` flag is not enough: `run()` calls `plan()` and then
   * `report()` from a different branch than the pump loop, both set the flag,
   * and whichever finishes first clears the other one's — recreating exactly the
   * overlapping-call bug this whole module exists to prevent.
   */
  lock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      this.depth++;
      this.busy = true;
      try {
        return await fn();
      } finally {
        this.depth--;
        if (this.depth === 0) {
          this.busy = false;
          /**
           * ⚠ AFTER `busy = false`, and inside the `finally` so a THROWN turn
           * wakes the pump too — a failed reply must not strand the messages
           * queued behind it. → `onFree`
           *
           * ⚠ Its own try/catch: this is a `finally`, and an exception thrown
           * from here would replace the real error of the turn with a
           * secondary one from the wake-up.
           */
          try {
            this.onFree?.();
          } catch {
            /* a listener that throws must not take the lock down with it */
          }
        }
      }
    });
    // Keep the chain alive even when one link throws.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run as Promise<T>;
  }
}

/**
 * Merge several user messages into one turn for the assistant.
 *
 * Built in CODE, not by an LLM call to "summarise" them — that would be buying
 * smoothness with tokens, which the four quality criteria forbid.
 *
 * ⚠ The wrapper sentence is ENGLISH and does NOT go through i18n, even though it
 * sits inside the user's turn. It is prompt scaffolding, not something displayed:
 * `handleUserBatch` takes it straight to the model and the chat pane never draws
 * it. Translating it by the interface switch would wire exactly the connection
 * the language rule forbids — the switch says "what do I want to SEE", while the
 * reply language has to follow the messages pasted directly below it.
 * → docs/CLAUDE.md §Language
 */
export function mergeUserText(items: readonly MailItem[]): string {
  const texts = items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text);
  if (texts.length === 1) return texts[0]!;
  return (
    `I sent ${texts.length} messages in a row while you were busy. ` +
    `Read all ${texts.length} and answer them as one request:\n` +
    texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  );
}
