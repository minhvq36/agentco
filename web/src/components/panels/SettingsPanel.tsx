import { Languages } from 'lucide-react';

import { SectionTitle } from '@/components/ui/misc';
import { actions, useApp } from '@/lib/store';
import { LOCALES, t, type Locale } from '@i18n';

/**
 * Settings — company-level, so it stays visible when there are no offices.
 * → docs/SPEC-ui.md §0 · docs/CLAUDE.md §Language
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ THE SCOPE SENTENCE IS THE FEATURE, NOT THE DECORATION.                   │
 * │                                                                          │
 * │ This switch changes the INTERFACE. It does not change what the assistant │
 * │ writes back, what a worker puts in a result file, or what gets recorded  │
 * │ as a lesson — all of those follow whatever language the person is typing │
 * │ in, which this setting cannot know. A Vietnamese user may well want an   │
 * │ English interface, and that combination has to keep working.             │
 * │                                                                          │
 * │ Without the sentence, the obvious reading of a control labelled          │
 * │ "language" is that it governs everything. Someone flips it, sends a      │
 * │ message, gets a reply in the other language, and files a bug. Saying the │
 * │ boundary out loud where the control lives is cheaper than answering that │
 * │ bug once.                                                                │
 * └──────────────────────────────────────────────────────────────────────────┘
 */

/**
 * Endonyms — each language named IN ITSELF, not translated.
 *
 * Someone who has landed in a language they cannot read needs to find their own
 * on this list. "Vietnamese" written in Vietnamese is findable by a Vietnamese
 * speaker; "Tiếng Việt" rendered as "Vietnamese" for an English interface is
 * not. This is the one list in the product that must NOT go through `t()`.
 */
const ENDONYM: Record<Locale, string> = {
  vi: 'Tiếng Việt', // i18n-allow-vietnamese: endonym — a language names itself
  en: 'English',
};

export function SettingsPanel() {
  const locale = useApp((s) => s.locale);

  return (
    <div className="h-full overflow-y-auto px-3 py-3">
      <SectionTitle className="mb-2 flex items-center gap-1.5">
        <Languages className="h-3.5 w-3.5" />
        {t('settings.language')}
      </SectionTitle>

      <div role="radiogroup" aria-label={t('settings.language')} className="flex flex-col gap-1">
        {LOCALES.map((code) => {
          const on = code === locale;
          return (
            <button
              key={code}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => void actions.setLanguage(code)}
              className={[
                'flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                on
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-line text-ink hover:bg-accent-soft/40',
              ].join(' ')}
            >
              <span>{ENDONYM[code]}</span>
              <span className="text-[11px] uppercase tracking-wider text-muted">{code}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[13px] leading-relaxed text-muted">{t('settings.languageScope')}</p>
    </div>
  );
}
