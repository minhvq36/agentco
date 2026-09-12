/**
 * MINIMAL markdown — builds React nodes, NEVER an HTML string.
 *
 * Shared by the chat box and the `.md` preview in the Artifacts panel. Parsing
 * lives in `markdown-core.ts` (pure, with its own tests); this file only maps a
 * settled parse onto tags.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ WHY HAND-WRITTEN, AND WHY NEVER `dangerouslySetInnerHTML`.               │
 * │                                                                          │
 * │ The text here is MODEL-GENERATED. An answer written for a client can     │
 * │ perfectly well contain `<img src=x onerror=…>` — by accident, or because │
 * │ a document the user uploaded had that in it. Pouring that into           │
 * │ `innerHTML` opens an XSS hole in the console that drives the company,    │
 * │ which has no authentication beyond "same machine" (the same argument     │
 * │ that forced `.svg` to `octet-stream`, SPEC-artifacts §3).                │
 * │                                                                          │
 * │ Building React nodes makes everything TEXT by default — there is no path │
 * │ from a string to a tag. That is also why no markdown→HTML library is     │
 * │ pulled in: they return STRINGS, and a string has to go through innerHTML.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ FIVE RULES, NO MORE — and two things left out ON PURPOSE.                │
 * │                                                                          │
 * │   ✅ ```code blocks```   ✅ `inline code`   ✅ **bold**   ✅ # headings  │
 * │   ✅ | tables |          ✅ [label](https://…)                           │
 * │                                                                          │
 * │ Links were added on 08/09, for the shape a worker with web access ACTUALLY│
 * │ produces: a comparison or a price list with its sources under it. Printed │
 * │ raw, the reader has to select a URL out of the middle of a sentence and   │
 * │ paste it — and the `[label](url)` brackets around it read as noise.       │
 * │ `http`/`https` only, checked at parse time. → `markdown-core.ts §SAFE_URL`│
 * │                                                                          │
 * │ Tables were added on 20/08 because they are a shape employees ACTUALLY   │
 * │ produce: glossaries, spend breakdowns, price comparisons. Showing the raw│
 * │ `|` characters makes the user assemble the table in their head — and they│
 * │ open the `.md` to REVIEW it before sending it to a client, so misreading │
 * │ it means sending the wrong thing.                                        │
 * │                                                                          │
 * │   ⛔ `_italics_` — this product says `plan_id`, `hot_knowledge_tokens`,  │
 * │      `max_turns`, `default_deliver` all day long. Turning underscores    │
 * │      into italics shreds our own text.                                   │
 * │                                                                          │
 * │   ⛔ lists and 4-space indentation — see `blocksOf`.                     │
 * │                                                                          │
 * │ The smallest surface breaks least. Every rule added is a new way to ruin │
 * │ the sentences the backend already assembles in code.                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Fragment } from 'react';

import { blocksOf, spansOf, type Align } from './markdown-core';
import { t } from '@i18n';

/**
 * Heading sizes — DELIBERATELY CLOSE TO BODY TEXT.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ A browser renders `#` and `##` at 2em and 1.5em by default. Inside a     │
 * │ ~330px chat bubble a 27px line takes nearly the whole width and shoves   │
 * │ everything else down — the reader loses the thread, and it feels like    │
 * │ the interface is SHOUTING.                                               │
 * │                                                                          │
 * │ So the hierarchy comes from WEIGHT and COLOUR, not size: 1–1.5px is      │
 * │ enough for the eye to see rank while the layout stays still. The 56rem   │
 * │ preview earns exactly one step more — no further.                        │
 * └──────────────────────────────────────────────────────────────────────────┘
 */
const SIZES = {
  chat: ['text-[15px]', 'text-[14px]', 'text-[13.5px]'],
  preview: ['text-[17px]', 'text-[15px]', 'text-[14px]'],
} as const;

/**
 * 🔴 A LINK IS THE ONLY THING IN HERE THAT LEAVES THE MACHINE.
 * → `markdown-core.ts §Span.href`
 *
 * ┌──────────────────────────────────────────────────────────────────────────
 * │ THE LABEL AND THE DESTINATION ARE TWO DIFFERENT STRINGS, AND THE MODEL
 * │ WROTE BOTH. `[your invoice](https://evil.example)` is valid markdown, so
 * │ a link rendered with the label alone hands a model-chosen destination the
 * │ interface's own credibility — the failure class this repo already
 * │ legislates for result paths (*"only a path CODE placed there is
 * │ clickable"*).
 * │
 * │ What is different, and why this is allowed: a result path ASSERTS that a
 * │ file of the user's exists; an external link asserts nothing except *"the
 * │ author wrote this address"*. So it may be opened — provided the address
 * │ is READABLE BEFORE THE CLICK. Hence `title`, which every browser shows on
 * │ hover and every screen reader announces.
 * │
 * │ ⚠ `rel="noopener noreferrer"`: without `noopener` the opened page gets a
 * │ handle on this one through `window.opener` and can navigate it — the
 * │ console that drives the whole company, with no authentication beyond
 * │ "same machine". `noreferrer` keeps the local URL out of the other site's
 * │ logs.
 * │
 * │ ⚠ The scheme was already checked at PARSE time, not here. A renderer that
 * │ decides safety is a second opinion, and this one runs in two places.
 * └──────────────────────────────────────────────────────────────────────────
 */
function Inline({ text }: { text: string }) {
  return (
    <>
      {spansOf(text).map((s, i) => {
        const body = s.code ? (
          <code className="rounded bg-line/60 px-1 py-px font-mono text-[0.9em] text-ink">{s.text}</code>
        ) : s.href ? (
          <a
            href={s.href}
            target="_blank"
            rel="noopener noreferrer"
            title={s.href}
            className="text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
          >
            {s.text}
          </a>
        ) : (
          s.text
        );
        return (
          <Fragment key={i}>
            {s.bold ? <strong className="font-semibold">{body}</strong> : body}
          </Fragment>
        );
      })}
    </>
  );
}

const ALIGN: Record<Align, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
};

/**
 * A markdown table. It shares its visual language with `CsvTable` in the
 * Artifacts panel — two tables side by side in the same product that look
 * different send the user hunting for the meaning of the difference.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ TWO LAYERS AGAINST OVERFLOW, AND BOTH ARE REQUIRED.                       │
 * │                                                                           │
 * │  1. `overflow-x-auto` + `max-w-full` on the WRAPPER — the same rule as    │
 * │     for code blocks: wide content scrolls INSIDE its own block. Without   │
 * │     it the table stretches the chat bubble and the whole panel grows a    │
 * │     horizontal scrollbar.                                                 │
 * │                                                                           │
 * │  2. A bubble holding a table must be a block with a DEFINITE WIDTH        │
 * │     (`block w-full`, see `ChatPanel`), not an `inline-block` that shrinks │
 * │     to its content. With `inline-block` the wrapper's width depends on    │
 * │     the content inside it — `max-w-full` has nothing left to measure      │
 * │     against, and layer 1 stops working.                                   │
 * │                                                                           │
 * │ So however narrow the panel gets (MIN_W = 300px) the table only scrolls   │
 * │ horizontally inside itself and can never widen the sidebar.               │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `min-w-max` on the `<table>`: let the table keep its natural width and scroll,
 * instead of being squeezed to fit until every cell wraps into a vertical column
 * of letters.
 */
function Table({ head, rows, align }: { head: string[]; rows: string[][]; align: Align[] }) {
  return (
    <div className="my-1.5 max-w-full overflow-x-auto rounded-lg border border-line">
      <table className="min-w-max border-collapse text-[12.5px]">
        <thead>
          <tr>
            {head.map((c, i) => (
              <th
                key={i}
                className={`border-b border-line bg-line/30 px-2.5 py-1.5 font-semibold text-ink ${
                  ALIGN[align[i] ?? 'left']
                }`}
              >
                <Inline text={c} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="even:bg-line/15">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={`border-b border-line/60 px-2.5 py-1 align-top text-ink last:border-r-0 ${
                    ALIGN[align[j] ?? 'left']
                  }`}
                >
                  <Inline text={c} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Markdown({ text, variant = 'chat' }: { text: string; variant?: 'chat' | 'preview' }) {
  const sizes = SIZES[variant];

  return (
    <>
      {blocksOf(text).map((b, i) => {
        if (b.kind === 'code') {
          return (
            <div key={i} className="my-1.5 overflow-hidden rounded-lg border border-line bg-line/25">
              {/*
                A language label, NO syntax colouring — a deliberate decision.

                Colouring is an ASSERTION about syntax: paint a string as a
                comment by mistake and the reader believes it, and wrong colour
                is worse than none. Hand-writing tokenizers for py/TS/C/C++/Java
                is five grammars wrong in five different ways.

                And it is measured (SPEC-artifacts §3): 14 of 14 artifacts on the
                user's machine are `.md` — employees only have `Write`/`Edit`,
                and no role yet produces code. This is a feature for a user WHO
                DOES NOT EXIST. When there is a real engineering department,
                `highlight.js` goes exactly here.
              */}
              {b.lang && (
                <div className="border-b border-line px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wide text-muted">
                  {b.lang}
                </div>
              )}
              {/*
                `overflow-x-auto` belongs HERE, not on the parent: a long line of
                code has to scroll INSIDE its own block. Without it the whole
                panel grows a horizontal scrollbar and the chat bubble stretches.
              */}
              <pre className="overflow-x-auto px-2.5 py-2">
                <code className="font-mono text-[12px] leading-relaxed text-ink">{b.text}</code>
              </pre>
            </div>
          );
        }

        if (b.kind === 'table') {
          return <Table key={i} head={b.head} rows={b.rows} align={b.align} />;
        }

        if (b.kind === 'heading') {
          const size = sizes[Math.min(b.level, 3) - 1] ?? sizes[2];
          return (
            <div key={i} className={`mt-2 mb-1 font-semibold text-ink first:mt-0 ${size}`}>
              <Inline text={b.text} />
            </div>
          );
        }

        /**
         * TASK LISTS. → markdown-core.ts `TASK`
         *
         * The box is drawn in CSS, not with `<input type="checkbox">`:
         *
         *  · A browser's default `<input>` ignores the palette, so it shows up
         *    OS-blue in the middle of a carefully coloured interface.
         *  · It is CLICKABLE by default, and clickable here is a lie: there is
         *    no path back to the file. `disabled` instead greys it out like a
         *    control that is broken.
         *
         * `aria-hidden` on the box plus a "done/not done" label for screen
         * readers: a blind user has to hear the state, not just see a ✓.
         */
        if (b.kind === 'tasks') {
          return (
            <ul key={i} className="my-1.5 flex flex-col gap-1">
              {b.items.map((it, k) => (
                <li key={k} className="flex items-start gap-2">
                  <span
                    aria-hidden
                    className={`mt-[0.15em] flex h-[1em] w-[1em] flex-none items-center justify-center rounded-[3px] border text-[0.7em] leading-none ${
                      it.done
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line bg-transparent text-transparent'
                    }`}
                  >
                    ✓
                  </span>
                  <span className="sr-only">{it.done ? t('md.taskDone') : t('md.taskTodo')}</span>
                  {/* Strike through what is done, but do NOT fade the text:
                      people still have to be able to read back what they did. */}
                  <span className={`min-w-0 break-words ${it.done ? 'text-muted line-through' : 'text-ink'}`}>
                    <Inline text={it.text} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }

        // Blank lines at BOTH ENDS are trimmed, the ones INSIDE are kept: the
        // backend assembles plenty of multi-line messages (`/help`, the strip of
        // plan steps, the "artifact saved at" block) and they depend on exactly
        // those newlines.
        const body = b.text.replace(/^\n+|\n+$/g, '');
        if (!body) return null;
        return (
          <span key={i} className="block whitespace-pre-wrap break-words">
            <Inline text={body} />
          </span>
        );
      })}
    </>
  );
}
