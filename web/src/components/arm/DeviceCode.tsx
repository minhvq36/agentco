/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ DEVICE CODE — three NUMBERED steps, because this is the only flow that   │
 * │ makes someone do work ON A DIFFERENT SCREEN. → SPEC-arms §5h·7b          │
 * │                                                                          │
 * │ The web flow only needs "press the button, the tab handles it". Here     │
 * │ they carry a code somewhere else and type it in — and nothing links the  │
 * │ two screens except that code. So it has to be LARGE, copyable, and       │
 * │ clocked: a code that dies quietly means typing into a dead form and then │
 * │ hunting for a fault on their own side.                                   │
 * │                                                                          │
 * │ ⚠ NO automatic `window.open`: the case device flow exists to serve is    │
 * │ precisely *someone browsing on another machine or phone*. Offering to    │
 * │ open it is fine; assuming is not.                                        │
 * │                                                                          │
 * │ ⚠ THERE IS NO SECRET HERE. `userCode` is something the person has to     │
 * │ READ and carry; `state` only points at a session held by the daemon.     │
 * │ Quite unlike the web flow's `code_verifier`, which never leaves it.      │
 * │                                                                          │
 * │ `copied` lives IN here (split out of `ArmDialog` 28/08): nobody outside  │
 * │ this block cares about it, and a local state parked on the parent is one │
 * │ line that re-renders the whole dialog for a tick mark.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { DeviceLogin } from './types';
import { t } from '@i18n';

export function DeviceCode({
  name,
  device,
  now,
}: {
  /** The vendor's name — the instructions must name the screen they will open. */
  name: string;
  device: DeviceLogin;
  /** The parent's clock: it is also what clears an expired code, so it is not duplicated here. */
  now: number;
}) {
  const [copied, setCopied] = useState(false);
  const left = Math.max(0, device.expiresAt - now);

  return (
    <div className="mt-3 rounded-md border border-accent/40 bg-accent-soft/30 px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[13px] font-medium">{t('arm.deviceTitle', { name })}</div>
        {/* The clock: the code REALLY dies after 15 minutes, and they must see it die. */}
        <div className="shrink-0 font-mono text-[11px] text-muted">
          {t('arm.deviceLeft', {
            mm: Math.floor(left / 60000),
            ss: String(Math.floor((left % 60000) / 1000)).padStart(2, '0'),
          })}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <code className="flex-1 select-all rounded border border-line bg-bg px-3 py-2 text-center font-mono text-lg tracking-[0.2em]">
          {device.userCode}
        </code>
        <Button
          aria-label={t('arm.copyCode')}
          title={t('arm.copyCode')}
          onClick={() => {
            void navigator.clipboard?.writeText(device.userCode).then(
              () => setCopied(true),
              // Clipboard blocked (http, permissions) ⇒ do NOT claim it copied.
              // The code is still `select-all`, so it can be copied by hand — a
              // false ✓ is worse than no ✓ at all.
              () => setCopied(false),
            );
          }}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <ol className="mt-2.5 list-decimal space-y-1 pl-4 text-xs leading-relaxed text-muted">
        <li>
          {t('arm.deviceStep1Before')}{' '}
          <a
            className="underline decoration-dotted hover:text-fg"
            href={device.verificationUriComplete ?? device.verificationUri}
            target="_blank"
            rel="noreferrer noopener"
          >
            {device.verificationUri.replace(/^https?:\/\//, '')}
          </a>{' '}
          {t('arm.deviceStep1After')}
        </li>
        <li>{t('arm.deviceStep2')}</li>
        <li>{t('arm.deviceStep3')}</li>
      </ol>

      {/*
        ⚠ THIS SENTENCE HAS TO BE HERE, and it comes from a real case we walked
        into while measuring: if the browser is signed in as A DIFFERENT ACCOUNT,
        the key that comes back belongs to that account, and the only symptom is
        *"the arm sees nothing"* — a wrong-door message that sends people off to
        check permissions, check the installation, check the repo. → §5h·7k
      */}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        {t('arm.deviceAccountBefore')} <b>{t('arm.deviceAccountBold')}</b>
        {t('arm.deviceAccountAfter')}
      </p>
    </div>
  );
}
