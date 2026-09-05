import { useEffect, useRef } from 'react';
import { CornerDownLeft, FileText, MessageSquare } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Empty, Textarea } from '@/components/ui/misc';
import { Markdown } from '@/lib/markdown';
import { hasTable } from '@/lib/markdown-core';
import { actions, labelFor, useApp } from '@/lib/store';
import { t } from '@i18n';

/**
 * The chat box for the assistant. The ONLY door for anything the user types —
 * the assistant decides for itself whether this is conversation, a question to
 * ask back, or work to hand to the team.
 *
 * Typing "Hi" and kicking off a whole DAG plan is the bug a user meets on their
 * very first action; `/say` on the backend exists so it cannot happen again.
 */
export function ChatPanel() {
  const messages = useApp((s) => s.messages);
  const sending = useApp((s) => s.sending);
  const activity = useApp((s) => s.activity);
  /**
   * The draft comes from the STORE, not from this component's `useState`.
   *
   * The sidebar mounts panels with `{panel === 'chat' && <ChatPanel />}` — a tab
   * switch unmounts, and component state dies with it. The user is halfway
   * through a long request, hops to the Library tab to copy a path, comes back:
   * **empty**. → `AppState.draft`
   */
  const text = useApp((s) => s.draft);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, activity]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <Empty
            icon={<MessageSquare className="h-7 w-7" />}
            title={t('chat.emptyTitle')}
            hint={
              <>
                {t('chat.emptyHint')}
                <br />
                {t('chat.emptyHintTypeBefore')} <code>/help</code> {t('chat.emptyHintTypeAfter')}
              </>
            }
          />
        ) : (
          <div className="flex min-w-0 flex-col gap-3">
            {messages.map((m) => (
              <div key={m.id} className={`min-w-0 ${m.role === 'user' ? 'text-right' : ''}`}>
                {/*
                  WHO IS SPEAKING — only when it is NOT the assistant.

                  Since 19/08 a `deliver: reply` task sends the answer STRAIGHT
                  from the employee to the user (SPEC-offices.md §6). Without a
                  label the user assumes the assistant answered by itself — and
                  the whole point of the product is watching your team work.

                  The name is looked up from `role`, NOT taken from `text`: the
                  protocol says `say` never contains the speaker's name, because
                  baking it into the string prints it twice and takes the choice
                  of how to label away from every future client.
                */}
                {m.role !== 'user' && m.role !== 'assistant' && (
                  <div className="mb-0.5 text-[11px] font-medium text-muted">{labelFor(m.role)}</div>
                )}
                {/*
                  `whitespace-pre-wrap` is REQUIRED, not decoration. The backend
                  assembles multi-line replies in code — `/help`, the list of
                  plan steps, the end-of-shift report — and they use real
                  newlines. HTML collapses every run of whitespace into one
                  space, so without this `/help` arrives as one unreadable slab
                  of text.

                  `break-words`: long file paths and URLs have no whitespace to
                  break at — without it the chat bubble stretches itself and the
                  whole panel grows a horizontal scrollbar.
                */}
                {/*
                  BUBBLE WIDTH — three shapes, and the third one exists for the
                  table.

                  An ordinary message shrinks to its content (`inline-block`),
                  because a bubble spanning the full width for "Done." reads as
                  a layout bug.

                  A message WITH A TABLE is the opposite: a table is the one
                  thing in markdown whose width carries information, so it takes
                  the panel's full width. And `block w-full` here is not
                  cosmetic — it gives the table's wrapper a DEFINITE WIDTH to
                  measure against, which `inline-block` does not have. Without
                  it the `max-w-full` + `overflow-x-auto` inside lose their
                  reference, the table stretches the bubble, and the panel grows
                  a horizontal scrollbar. → `Table` in lib/markdown.tsx
                */}
                <div
                  className={
                    m.role === 'user'
                      ? 'ml-auto inline-block max-w-[85%] whitespace-pre-wrap break-words rounded-xl rounded-br-sm bg-accent-soft px-3 py-2 text-left text-[13.5px] text-ink'
                      : `break-words rounded-xl rounded-bl-sm border border-line bg-paper px-3 py-2 text-[13.5px] leading-relaxed text-ink ${
                          hasTable(m.text) ? 'block w-full' : 'inline-block max-w-[92%]'
                        }`
                  }
                >
                  {/*
                    Only RENDER markdown for messages from the system. A USER's
                    message stays verbatim — they see exactly what they typed,
                    with no interface reinterpreting it. Typing `**` for
                    emphasis and watching it disappear is a quiet way of telling
                    the user they typed something wrong.

                    `whitespace-pre-wrap` moved INSIDE `Markdown` (each block
                    keeps its own), because a code block has to scroll
                    horizontally on its own — left outside, one long line of code
                    stretches the entire bubble.
                  */}
                  {m.role === 'user' ? (
                    m.text
                  ) : m.files?.length ? (
                    <FileLinks text={m.text} files={m.files} />
                  ) : (
                    <Markdown text={m.text} />
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>

      {activity && <Activity text={activity} />}

      <form
        className="flex flex-none items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void actions.say();
        }}
      >
        {/*
          A textarea, NOT an input: Enter sends, Shift+Enter breaks the line.

          Deliberately NO hint line in the interface, and no setting. This is a
          key combination everyone already knows from every other chat app —
          writing it down spends permanent space teaching something the user
          already knows.

          The height grows with the content and starts scrolling at ~5 lines: a
          long request typed into a 36px box means people cannot re-read what
          they just wrote, and that is when they send a sentence missing its
          second half.
        */}
        <Textarea
          value={text}
          rows={1}
          onChange={(e) => actions.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            // ⚠ `isComposing` is REQUIRED for Vietnamese. Vietnamese input
            // methods (Telex/VNI, and every IME) use Enter to commit the
            // character being composed — swallowing that key sends the message
            // while the user is halfway through a letter.
            if (e.nativeEvent.isComposing) return;
            e.preventDefault();
            void actions.say();
          }}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.messageLabel')}
          disabled={sending}
          className="max-h-[7.5rem] min-h-[2.25rem] resize-none py-1.5 leading-relaxed"
          style={{ height: 'auto' }}
          ref={(el) => {
            if (!el) return;
            // Grow with the content: reset to auto before measuring, otherwise
            // `scrollHeight` only ever increases and never shrinks back when
            // text is deleted.
            el.style.height = 'auto';
            el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          }}
        />
        <Button type="submit" variant="primary" size="icon" disabled={sending || !text.trim()} aria-label={t('chat.send')}>
          <CornerDownLeft className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}

/**
 * A message carrying ARTIFACT PATHS — each path becomes a button that opens the
 * preview. → docs/SPEC-artifacts.md §2.5 · docs/SPEC-ui.md
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY MATCH AGAINST `files` AND NEVER SNIFF PATHS OUT OF THE TEXT.         │
 * │                                                                          │
 * │ Part of the message in the stream is written by the MODEL (an employee's │
 * │ `answer` on a `deliver: reply` task). Finding paths with a regex over    │
 * │ that text means: an employee invents a very plausible-looking path, the  │
 * │ interface turns it into a button, and the user clicks it trusting us.    │
 * │ That is **lending a guessed sentence the interface's authority** — and   │
 * │ the user has no way to tell the difference.                              │
 * │                                                                          │
 * │ `files` is filled only by `whereBlock`, and every path in it has passed  │
 * │ three doors: derived from a tool that WAS CALLED (`receipt.landed`, not  │
 * │ the model-declared `artifacts`) → `safeJoin` blocks anything outside the │
 * │ office → `existsSync`.                                                   │
 * │                                                                          │
 * │ Short rule: **only a path THE CODE ITSELF put there is clickable.**      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Matching is a SUFFIX comparison, not a regex: `say` prints the path with the
 * `company/offices/<id>/` prefix so it can be pasted into a file explorer, while
 * `files` carries the path relative to the office directory. Two frames of
 * reference, one deterministic comparison — and since the same function builds
 * both ends, they cannot drift apart.
 *
 * A line matching NO file goes through `Markdown` like any other message. No
 * branch here is allowed to break how things render today.
 */
function FileLinks({ text, files }: { text: string; files: string[] }) {
  return (
    <span className="block">
      {text.split('\n').map((line, i) => {
        const hit = files.find((f) => line.trim().endsWith(f));
        if (!hit) {
          return (
            <span key={i} className="block">
              <Markdown text={line} />
            </span>
          );
        }
        return (
          <button
            key={i}
            type="button"
            onClick={() => actions.revealArtifact(hit)}
            /*
              `text-left` + `break-all`: a long path has no whitespace to break
              at, and a button that cannot wrap stretches the bubble. `w-full`
              makes the whole line the target — an 8px-tall target gets missed,
              and the user concludes it is not clickable at all.
            */
            className="flex w-full items-center gap-1.5 break-all rounded px-1 py-0.5 text-left font-mono text-[12px] text-accent hover:bg-accent-soft"
            title={t('chat.openPreview')}
          >
            <FileText className="h-3.5 w-3.5 flex-none" aria-hidden />
            <span className="min-w-0">{line.trim()}</span>
          </button>
        );
      })}
    </span>
  );
}

/**
 * The "what is happening" line. Without it, the gap between pressing Send and
 * the assistant replying is 5–15 seconds of complete silence, and the user
 * cannot tell whether the system received anything — that gap is exactly where
 * people press Send a second time.
 *
 * The three dots are plain CSS, not an LLM call. The cross-constraint of the
 * four quality bars: "smooth" is never bought with tokens.
 */
function Activity({ text }: { text: string }) {
  return (
    <div
      className="flex flex-none items-center gap-2 border-t border-line px-4 py-2 text-[13px] text-muted"
      role="status"
      aria-live="polite"
    >
      <span className="flex gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="soft-pulse h-1.5 w-1.5 rounded-full bg-accent"
            style={{ animationDelay: `${i * 0.22}s` }}
          />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
    </div>
  );
}
