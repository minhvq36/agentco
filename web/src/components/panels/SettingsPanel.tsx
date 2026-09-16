import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Languages, Moon, Palette, Sun } from 'lucide-react';

import { SectionTitle } from '@/components/ui/misc';
import { api } from '@/lib/api';
import { actions, useApp } from '@/lib/store';
import { THEMES, type Theme } from '@/lib/theme';
import { LOCALES, t, type Locale, type MessageKey } from '@i18n';
import type { UpdateView } from '@core/update-links';

/**
 * Settings — company-level, so it stays visible when there are no offices.
 * → docs/SPEC-ui.md §0 · docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ ⚠ NEITHER SWITCH CARRIES A SCOPE SENTENCE ANY MORE. (user, 10/09)        │
 * │                                                                          │
 * │ Both used to. The language one said the assistant still replies in       │
 * │ whatever language you type in; the theme one said the choice lives in    │
 * │ this browser and not in the company. Both were TRUE and both are still   │
 * │ true — they were pruned as screen clutter, and that is the user's call   │
 * │ to make.                                                                 │
 * │                                                                          │
 * │ ⚠ WHAT THEY WERE THERE FOR HAS NOT GONE AWAY, so it is written here      │
 * │ instead of being lost with them: the obvious reading of a control        │
 * │ labelled "language" is that it governs everything, and someone who flips │
 * │ it, sends a message and gets a reply in the other language has found a   │
 * │ bug as far as they are concerned. The boundary itself is load-bearing    │
 * │ and lives in `docs/CLAUDE.md §Language` — a Vietnamese user may well     │
 * │ want an English interface, and that combination has to keep working.     │
 * │ If that question ever comes back as a real support case, the sentence is │
 * │ the cheap answer and it goes back here.                                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Endonyms — each language named IN ITSELF, not translated.
 *
 * Someone who has landed in a language they cannot read needs to find their own
 * on this list. "Vietnamese" written in Vietnamese is findable by a Vietnamese
 * speaker; that same entry rendered as "Vietnamese" for an English interface is
 * not. This is the one list in the product that must NOT go through `t()`.
 */
const ENDONYM: Record<Locale, string> = {
  vi: 'Tiếng Việt', // i18n-allow-vietnamese: endonym — a language names itself
  en: 'English',
};

/**
 * ⚠ MESSAGE KEYS, NOT TEXT — the same rule as the tables at the top of
 * `Header.tsx`. This table is module-level, so a resolved string would freeze at
 * import time and these rows would keep the language the page loaded with while
 * everything around them switched.
 */
const THEME_LABEL: Record<Theme, MessageKey> = {
  dark: 'settings.themeDark',
  light: 'settings.themeLight',
};

const THEME_ICON: Record<Theme, typeof Sun> = {
  dark: Moon,
  light: Sun,
};

/**
 * One row of a radio group. Extracted the moment there were two groups on this
 * screen rather than after the third: the classes below decide what "selected"
 * looks like, and two copies of that is how one group quietly stops matching
 * the other.
 */
function Choice({
  on,
  onPick,
  children,
  trailing,
}: {
  on: boolean;
  onPick(): void;
  children: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={[
        'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-ink hover:bg-accent-soft/40',
      ].join(' ')}
    >
      <span className="flex items-center gap-2">{children}</span>
      {trailing}
    </button>
  );
}

/**
 * The product footer — a name, a copyright, a version. → docs/SPEC-packaging.md §1
 *
 * 🔴 IT LIVED IN THE HEADER FIRST, AND THAT WAS THE WRONG SPLIT. (user, 16/09)
 * The header is for EVENTS — "version X is available" is one: it expires and it
 * has a close button. Which version you are RUNNING is reference. Nobody needs
 * it until somebody asks, and then they need to be able to FIND it, not to have
 * been shown it all day.
 *
 * ⚠ NO "installed with npm" HERE ANY MORE. It answers a question only the
 * updater asks, and the update banner already branches on it — printing it in
 * both places would make the footer explain a thing it cannot act on.
 *
 * ⚠ THE YEAR IS COMPUTED, never typed. A hard-coded one is wrong from the 1st
 * of January and nothing anywhere reports it — the same silent-staleness the
 * generated `company.yaml` gave up comments to avoid.
 *
 * ⚠ The copyright stays although the licence is source-available: FSL grants
 * rights, it does not surrender ownership, and it is the copyright that makes
 * the grant enforceable at all. The PRODUCT is named here, never a person.
 *
 * ⚠ Silent until the daemon answers. "Version unknown" would be a second thing
 * to explain, and this line is worth nothing that costs anything.
 */
function VersionFooter() {
  const [view, setView] = useState<UpdateView | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .update()
      .then((v) => {
        if (alive) setView(v);
      })
      .catch(() => {
        /* no answer, no line */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!view) return null;
  return (
    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3">
      <FooterLine view={view} />
      <UpdateAction view={view} />
    </div>
  );
}

function FooterLine({ view }: { view: UpdateView }) {
  return (
    // ⚠ Left, like every other line in this panel. Centred was tried (user,
    // 16/09) and put back: the section titles and the choices all start at the
    // same x, and one line breaking that column reads as a mistake rather than
    // as a flourish.
    <p className="text-[11.5px] leading-relaxed text-muted">
      {t('settings.footer', { year: String(new Date().getFullYear()), version: view.current })}
    </p>
  );
}

/**
 * The update, immediately to the right of the version. → SPEC-packaging §3.7.4
 *
 * 🔴 NO DISMISS CONTROL, and that is the whole reason it lives here (user,
 * 17/09). The header's banner can be closed because it arrives uninvited; this
 * one is only ever seen by somebody who opened Settings, so a notice that
 * cannot be dismissed is information rather than nagging. Closing the banner
 * used to mean losing the only way back to it until the next release.
 *
 * 🔴 THE PAGE OUTLIVES ITS OWN SERVER. `POST /api/update` answers 202 and the
 * daemon then stops existing — there is no connection to report progress on.
 * This component is already in the browser, so it holds the "updating" state
 * itself and polls `/healthz` until a version answers:
 *
 *   a NEW version  → reload, and the page comes back on the new code
 *   the OLD one    → nothing changed; say so and stop
 *   nothing at all → same sentence once the ceiling is reached
 *
 * ⚠ It polls `/healthz` rather than `/api/update`, because `/healthz` is the
 * one route that exists before anything else is ready and carries the version
 * with no cache in front of it.
 */
type Phase = { at: 'idle' } | { at: 'working' } | { at: 'failed' };

function UpdateAction({ view }: { view: UpdateView }) {
  /**
   * 🔴 THE SERVER'S `applying` SEEDS THIS, because the page forgets. (user,
   * 17/09) Changing the language mid-update remounted the component, local
   * state went back to idle, and the button reappeared as if nothing were
   * happening — on an update that was in fact running. Pressing it again
   * earned a 409, which the old code reported as "nothing changed": a lie,
   * told while it worked.
   */
  const [phase, setPhase] = useState<Phase>(view.applying ? { at: 'working' } : { at: 'idle' });

  // ⚠ Whoever mounts after a restart has to pick the truth up again, not keep
  // whatever it was constructed with.
  useEffect(() => {
    if (view.applying) setPhase({ at: 'working' });
  }, [view.applying]);

  // ⚠ STABLE, or the effect below it re-runs on every render: a new function
  // identity in a dependency array restarts the watcher, which restarts its
  // five-minute ceiling, forever. → `WatchForRestart`
  const gaveUp = useCallback(() => setPhase({ at: 'failed' }), []);

  // ⚠ A run in progress outranks `available`: while the new version is
  // unpacking the cache still says an update exists, and going back to a button
  // there is the whole bug.
  if (phase.at === 'idle' && (!view.available || !view.latest)) return null;
  const latest = view.latest ?? view.current;

  if (phase.at === 'working') {
    return (
      <span className="text-[11.5px] text-accent">
        {t('settings.updateWorking')}
        <WatchForRestart before={view.current} onGaveUp={gaveUp} />
      </span>
    );
  }
  if (phase.at === 'failed') {
    return <span className="text-[11.5px] text-warn">{t('settings.updateFailed')}</span>;
  }

  return (
    <button
      type="button"
      className="rounded-md border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11.5px] text-accent transition-colors hover:bg-accent/20"
      onClick={() => {
        // ⚠ Straight to `working`, and the WATCHER does the rest — including
        // when this click loses the race and the server answers 409 because an
        // update is already running. That is not a failure; it is the truth
        // arriving by a different door.
        setPhase({ at: 'working' });
        void api.applyUpdate().catch(() => {
          /* 409 means somebody already started it; anything else shows up as
             the watcher giving up, with the daemon still on the old version */
        });
      }}
    >
      {t('settings.updateTo', { version: latest })}
    </button>
  );
}

/**
 * Watch `/healthz` through the restart, and reload when the version moves.
 *
 * ⚠ A COMPONENT, so that mounting is what starts it. Whoever renders the
 * "updating" state gets the watcher for free — including a mount that happened
 * because the page was rebuilt half way through, which is the case that was
 * broken.
 *
 * ⚠ THE CEILING IS GENEROUS ON PURPOSE. A packaged update downloads ~25 MB,
 * unpacks it and then STARTS THE NEW TREE ONCE to prove it runs before
 * committing (§3.7.1); an npm one runs a real `npm install`. Both are minutes
 * on a slow line, and giving up early would tell somebody it failed while it
 * was still working.
 */
function WatchForRestart({ before, onGaveUp }: { before: string; onGaveUp(): void }) {
  useEffect(() => {
    let alive = true;
    const until = Date.now() + 5 * 60_000;

    const tick = async (): Promise<void> => {
      while (alive && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 1_000));
        try {
          const res = await fetch('/healthz', { cache: 'no-store' });
          if (!res.ok) continue;
          const body = (await res.json()) as { version?: string };
          if (typeof body.version === 'string' && body.version !== before) {
            if (alive) window.location.reload();
            return;
          }
        } catch {
          /* the server is between lives — the expected middle of this */
        }
      }
      if (alive) onGaveUp();
    };
    void tick();
    return () => {
      alive = false;
    };
  }, [before, onGaveUp]);

  return null;
}

export function SettingsPanel() {
  const locale = useApp((s) => s.locale);
  const theme = useApp((s) => s.theme);

  return (
    <div className="flex h-full flex-col overflow-y-auto px-3 py-3">
      <SectionTitle className="mb-2 flex items-center gap-1.5">
        <Languages className="h-3.5 w-3.5" />
        {t('settings.language')}
      </SectionTitle>

      <div role="radiogroup" aria-label={t('settings.language')} className="flex flex-col gap-1">
        {LOCALES.map((code) => (
          <Choice
            key={code}
            on={code === locale}
            onPick={() => void actions.setLanguage(code)}
            trailing={
              <span className="text-[11px] uppercase tracking-wider text-muted">{code}</span>
            }
          >
            {ENDONYM[code]}
          </Choice>
        ))}
      </div>

      {/*
        APPEARANCE — two rows, and dark is first because dark is what agentco
        looks like. There is deliberately no "follow the machine": the operating
        system does not get a vote on the product's own colours, and an install
        with nothing stored is dark rather than a guess. → `web/src/lib/theme.ts`
      */}
      <SectionTitle className="mb-2 mt-6 flex items-center gap-1.5">
        <Palette className="h-3.5 w-3.5" />
        {t('settings.theme')}
      </SectionTitle>

      <div role="radiogroup" aria-label={t('settings.theme')} className="flex flex-col gap-1">
        {THEMES.map((id) => {
          const Icon = THEME_ICON[id];
          return (
            <Choice key={id} on={id === theme} onPick={() => actions.setTheme(id)}>
              <Icon className="h-4 w-4" />
              {t(THEME_LABEL[id])}
            </Choice>
          );
        })}
      </div>

      <VersionFooter />
    </div>
  );
}
