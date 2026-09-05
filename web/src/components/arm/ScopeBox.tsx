/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ 🔴 VENDOR-SIDE SCOPE — RIGHT AFTER SIGN-IN, on the same screen.           │
 * │ (order settled 27/08)                                                     │
 * │                                                                           │
 * │ Two reasons, and the second is the one that matters:                      │
 * │  ① Installing the app MUST HAPPEN BEFORE any repo-dependent step.         │
 * │  ② *"pick up what the user just allowed on github in time"* — we cannot   │
 * │     read the installation, so the only thing we can synchronise on is     │
 * │     the ORDER OF ACTIONS: install first, then probe.                      │
 * │                                                                           │
 * │ Without this block the `installations/new` URL APPEARS NOWHERE IN THE     │
 * │ PRODUCT (before 27/08 it lived only in the walkthrough). Someone plugs    │
 * │ the arm in, sees ✓ with a tool count, and then gets 404 on every call —   │
 * │ and GitHub returns 404 rather than 403 on purpose, so the error sends     │
 * │ them off to check their keys. → C-2 · F-3                                 │
 * │                                                                           │
 * │ ⚠ We do NOT show "have you installed it" here and do NOT assume a         │
 * │ default. (Asked outright 27/08: *"if I skip install and carry on, does    │
 * │ it DEFAULT to All repositories?"*) — NO, AND WE CANNOT KNOW. Never        │
 * │ installed ⇒ NO ACCESS AT ALL, not "everything". No MCP tool answers that  │
 * │ question directly, so this block draws no state. `RepoScan` infers it by  │
 * │ another route and is the ONLY place allowed to say "installed / not       │
 * │ installed". → §5h·7o                                                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Button } from '@/components/ui/button';
import type { ArmScope } from './types';
import { t } from '@i18n';

export function ScopeBox({ name, scope }: { name: string; scope: ArmScope }) {
  return (
    <div className="mt-3 rounded-md border border-line px-3 py-3">
      <div className="text-[13px] font-medium">{t('arm.scopeTitle', { name })}</div>
      {/*
        Trimmed 02/09 to a TITLE + BUTTON. The two old paragraphs (scope is held
        by the vendor · a private repo is unreadable until installed) are gone.

        ⚠ What they warned about did NOT go with them — it moved somewhere that
        speaks at a better moment: `RepoScan`, directly below this block, is the
        ONLY place allowed to say "installed / not installed" (§5h·7o), and the
        translated 404 at run time (§5h·7f-bis) catches exactly the person who
        forgot. A line read before it can be understood holds nobody; those two
        speak when it matters.
      */}
      <Button className="mt-2 w-full" onClick={() => window.open(scope.url, '_blank', 'noopener')}>
        {scope.say}
      </Button>
    </div>
  );
}
