/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ "USE YOUR OWN APP" — collapsed, but NOT hidden. → SPEC-arms §5h·7h        │
 * │                                                                           │
 * │ ⚠ §5h·7h once described this as *"a first-class citizen"* while ZERO      │
 * │ LINES OF CODE existed (caught 27/08). This is the implementation, and it  │
 * │ sits inside the sign-in block because it has to be decided BEFORE Sign    │
 * │ in is pressed — swapping the client after a key exists leaves the old     │
 * │ key belonging to the old client.                                          │
 * │                                                                           │
 * │ Collapsed because 99% never need it; reachable because the other 1% are   │
 * │ enterprise customers for whom this is the condition of using the product  │
 * │ at all. When it is on, a badge shows on the summary line — a mode that    │
 * │ changes behaviour while folded shut is a trap.                            │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/misc';
import { t } from '@i18n';

export function OwnClient({
  name,
  own,
  value,
  onChange,
  onSave,
}: {
  /** The vendor's name — "your own app" has to say WHOSE app. */
  name: string;
  /** Whether a customer client has been SAVED. Different from `value !== ''`, which is mid-typing. */
  own: boolean;
  value: string;
  onChange(v: string): void;
  onSave(): void;
}) {
  return (
    <details className="mt-2 border-t border-line/60 pt-2" open={own}>
      <summary className="cursor-pointer text-[11px] text-muted">
        {t('arm.ownClientSummary', { name })}{' '}
        {own && <span className="text-accent">{t('arm.ownClientOn')}</span>}
      </summary>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        {t('arm.ownClientNoteBefore', { name })} <b>{t('arm.ownClientNoteBold')}</b>{' '}
        {t('arm.ownClientNoteAfter')}
      </p>
      <div className="mt-1.5 flex gap-1.5">
        <Input
          className="flex-1 font-mono text-[12px]"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Iv23li…"
        />
        <Button size="sm" onClick={onSave}>
          {t('common.save')}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        {t('arm.ownClientWarnBefore')} <b>{t('arm.ownClientWarnBold')}</b>{' '}
        {t('arm.ownClientWarnAfter')}
      </p>
    </details>
  );
}
