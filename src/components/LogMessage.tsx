import React, { useEffect, useState } from 'react';
import type { GameLog } from '../types';
import { DisplayLanguage, pickTranslationSource } from '../i18n';
import { needsTranslation, translateLogText } from '../services/translationService';

interface Props {
  log: GameLog;
  language: DisplayLanguage;
}

/**
 * Renders a log entry's text in the display language.
 *
 * System messages and vote summaries already carry bilingual fields — they
 * only pick the matching field, no AI translation. Speech entries whose text
 * mismatches the display language (e.g. Japanese corpus speech) are translated
 * asynchronously via translationService; the original text is shown until the
 * translation arrives, and a small "view original" toggle appears afterwards.
 *
 * In EN mode, when the English field is missing or a known canned fallback
 * stub while a Chinese original exists, pickTranslationSource swaps in the zh
 * original as the source — so pending/failed/local-dev states show the zh
 * original (never the stub), and the toggle switches translation ↔ zh original.
 */
const LogMessage: React.FC<Props> = ({ log, language }) => {
  const baseText = pickTranslationSource(log, language);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showOriginal, setShowOriginal] = useState(false);

  useEffect(() => {
    setTranslated(null);
    setShowOriginal(false);
    if (log.isSystem || !needsTranslation(baseText, language)) return;
    let cancelled = false;
    translateLogText(log.id, baseText, language).then(result => {
      if (!cancelled && result && result !== baseText) setTranslated(result);
    });
    return () => { cancelled = true; };
  }, [log.id, log.isSystem, baseText, language]);

  if (!translated) return <>{baseText}</>;

  return (
    <>
      {showOriginal ? baseText : translated}
      <button
        onClick={event => { event.stopPropagation(); setShowOriginal(value => !value); }}
        className="block mt-1 text-[9px] underline opacity-60 hover:opacity-100"
      >
        {showOriginal
          ? (language === 'zh' ? '查看译文' : 'Show translation')
          : (language === 'zh' ? '查看原文' : 'Show original')}
      </button>
    </>
  );
};

export default LogMessage;
