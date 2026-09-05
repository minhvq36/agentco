/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ APP INSTALLATION — CHECKED AUTOMATICALLY. → SPEC-arms §5h·7o              │
 * │                                                                           │
 * │ No input field at all (user, 27/08: *"no typing — press try and let it    │
 * │ check by itself"*). Picking the account runs it, and the result is THE    │
 * │ LIST OF REPOS THE VENDOR ACTUALLY GRANTS — which the ✓ from `tools/list`  │
 * │ cannot tell you.                                                          │
 * │                                                                           │
 * │ ⚠ THREE states, three different sentences. Never merge `failed` with      │
 * │ `installed: []`: one means *"could not check"*, the other *"checked, and  │
 * │ the answer is not installed"*. Merging them either blocks someone who     │
 * │ has installed it, or waves through someone who has not.                   │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { ArmScope, RepoScanState } from './types';
import { t } from '@i18n';

export function RepoScan({
  name,
  scope,
  scan,
  scanning,
  anyway,
  onAnyway,
  onRecheck,
}: {
  name: string;
  scope?: ArmScope;
  scan: RepoScanState;
  scanning: boolean;
  /** The escape-hatch checkbox — see the note further down this file. */
  anyway: boolean;
  onAnyway(v: boolean): void;
  onRecheck(): void;
}) {
  return (
    <div className="mt-3 rounded-md border border-line px-3 py-3">
      <div className="text-[13px] font-medium">{t('arm.repoTitle')}</div>

      {scanning ? (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {t('arm.repoScanning', { name })}
        </div>
      ) : scan && 'failed' in scan ? (
        /*
          COULD NOT CHECK ≠ NOT INSTALLED. Let them carry on, but say plainly
          that we do not know — staying quiet here builds false confidence.
        */
        <p className="mt-1 text-xs leading-relaxed text-warn">
          {t('arm.repoScanFailedBefore')} <b>{scope?.say}</b> {t('arm.repoScanFailedAfter')}
        </p>
      ) : scan && scan.installed.length > 0 ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            {t('arm.repoInstalledBefore')} <b>{scan.installed.length}</b>{' '}
            {t('arm.repoInstalledMid')} <b>@{scan.login}</b>
            {scan.seen > scan.installed.length && (
              <> {t('arm.repoNotInstalled', { n: scan.seen - scan.installed.length })}</>
            )}
            .
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {scan.installed.slice(0, 12).map((r) => (
              <span
                key={r}
                className="rounded bg-line/70 px-1.5 py-0.5 font-mono text-[11px] text-muted"
              >
                {r.split('/')[1]}
              </span>
            ))}
            {scan.installed.length > 12 && (
              <span className="px-1 text-[11px] text-muted">+{scan.installed.length - 12}</span>
            )}
          </div>
          {/*
            ⚠ STATE THE LIMIT OF THE MEASUREMENT ITSELF. Public repos are
            readable REGARDLESS of the installation (measured 27/08), so this
            list is about *full access*, not *everything that can be read*. Not
            saying so lets people believe it is tighter than it is.
          */}
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
            {t('arm.repoPublicNoteBefore')} <b>{t('arm.repoPublicNoteBold')}</b>{' '}
            {t('arm.repoPublicNoteAfter')}
          </p>
        </>
      ) : scan ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-danger">
            <b>@{scan.login}</b> {t('arm.repoNoneAfter')}
          </p>
          {scope && (
            <Button
              className="mt-2 w-full"
              onClick={() => window.open(scope.url, '_blank', 'noopener')}
            >
              {scope.say}
            </Button>
          )}
          <Button size="sm" className="mt-1.5 w-full" onClick={onRecheck}>
            {t('arm.repoRecheck')}
          </Button>
          {/*
            A MANDATORY ESCAPE HATCH, and not a concession.
            `search user:<login>` DOES NOT SEE ORGANISATION REPOS, so "empty"
            does not prove "nothing installed". Hard-blocking here would trap
            someone who did everything right — and a trap has no way out.
          */}
          <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-relaxed text-muted">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={anyway}
              onChange={(e) => onAnyway(e.target.checked)}
            />
            <span>
              {t('arm.repoAnywayBefore')} <i>{t('arm.repoAnywayItalic')}</i>.
            </span>
          </label>
        </>
      ) : null}
    </div>
  );
}
