import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import type { ReplayRecord } from '../replay/replayTypes';
import {
  SHARE_CARD_EXPORT_UNAVAILABLE,
  buildShareCardModel,
  exportShareCardPng,
  isShareCardExportSupported,
  type ShareCardExportResult,
  type ShareCardModel,
} from '../services/shareCardImage';

export interface ShareCardPanelProps {
  /** The replay of the finished match shown in `ReplayReviewPanel`. */
  replay: ReplayRecord;
  /**
   * Test seam. Production always uses the local canvas exporter; tests can
   * inject a deterministic result without a DOM.
   */
  exportPng?: (model: ShareCardModel) => Promise<ShareCardExportResult>;
}

type SupportState = 'unknown' | 'supported' | 'unsupported';
type ExportState = 'idle' | 'working' | 'done' | 'failed';

/**
 * H2-E: the "AI's view of you" preview + local PNG export.
 *
 * Mounted at the bottom of the post-game replay panel only. The component never
 * fetches anything; the button hands the pure share-card model to the canvas
 * exporter in `shareCardImage.ts`, which downloads a local PNG.
 */
export const ShareCardPanel: React.FC<ShareCardPanelProps> = ({ replay, exportPng }) => {
  const winner = replay?.outcome?.winner ?? null;
  const model = useMemo(
    () => (winner ? buildShareCardModel(replay) : null),
    [replay, winner],
  );
  const [support, setSupport] = useState<SupportState>('unknown');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [savedFileName, setSavedFileName] = useState<string | null>(null);

  useEffect(() => {
    // Effects never run during SSR, so static markup can still show the preview.
    setSupport(isShareCardExportSupported() ? 'supported' : 'unsupported');
  }, []);

  const runExport = exportPng ?? exportShareCardPng;
  const unavailable = support === 'unsupported' || exportState === 'failed';
  const working = exportState === 'working';

  const handleExport = useCallback(async () => {
    if (!model || working || unavailable) return;
    setExportState('working');
    setSavedFileName(null);
    try {
      const result = await runExport(model);
      if (result.ok) {
        setSavedFileName(result.fileName);
        setExportState('done');
      } else {
        setExportState('failed');
      }
    } catch {
      // A broken canvas must never take the replay panel down with it.
      setExportState('failed');
    }
  }, [model, runExport, unavailable, working]);

  if (!model || !winner) return null;

  return (
    <section
      data-testid="share-card-panel"
      className="mt-2 min-w-0 rounded border border-zinc-700 bg-zinc-950/70 p-3 text-left"
    >
      <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
        <Share2 className="h-4 w-4 text-zinc-300" aria-hidden="true" />
        AI&apos;s view of you
      </h3>
      <p className="mt-1 text-xs text-zinc-500">
        A local share card built from this saved replay. Exporting writes a PNG to your
        downloads; nothing is uploaded.
      </p>

      <div
        data-testid="share-card-preview"
        data-file-name={model.fileName}
        className="mt-3 min-w-0 rounded border border-zinc-800 bg-gradient-to-br from-zinc-950 to-red-950/25 p-3"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">
          {model.title}
        </p>
        <p data-testid="share-card-seat" className="mt-1 text-base font-black text-zinc-100">
          {model.seatLine}
        </p>
        <p data-testid="share-card-meta" className="mt-0.5 text-[11px] text-zinc-400">
          {model.metaLine}
        </p>

        {model.suspicionAvailable ? (
          <dl className="mt-3 grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
            {model.stats.map(stat => (
              <div
                key={stat.key}
                data-testid={`share-card-stat-${stat.key}`}
                className="min-w-0 rounded border border-zinc-800 bg-black/35 px-2 py-1.5"
              >
                <dt className="text-[10px] uppercase tracking-wide text-zinc-500">{stat.label}</dt>
                <dd className="mt-0.5 text-sm font-bold text-zinc-100 [overflow-wrap:anywhere]">
                  {stat.value}
                </dd>
                <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">{stat.detail}</p>
              </div>
            ))}
          </dl>
        ) : (
          <p
            data-testid="share-card-suspicion-unavailable"
            className="mt-3 rounded border border-red-900/60 bg-red-950/25 px-2 py-1.5 text-xs text-red-200"
          >
            {model.suspicionUnavailableText}
          </p>
        )}

        <div className="mt-3 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
            {model.quotesTitle}
          </p>
          {model.quotes.length === 0 ? (
            <p data-testid="share-card-quotes-empty" className="mt-1 text-xs text-zinc-500">
              {model.emptyQuotesText}
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1.5">
              {model.quotes.map((quote, index) => (
                <li
                  key={`${quote.kind}-${quote.round}-${quote.speakerId}-${index}`}
                  data-testid="share-card-quote"
                  data-kind={quote.kind}
                  data-round={quote.round}
                  data-speaker={quote.speakerId}
                  className="min-w-0 rounded border border-zinc-800 bg-black/30 px-2 py-1.5"
                >
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-500">
                    {quote.label}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
                    {quote.text}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <button
        type="button"
        data-testid="share-card-export"
        onClick={handleExport}
        disabled={working || unavailable}
        aria-disabled={working || unavailable}
        className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded border border-zinc-600 bg-zinc-900/85 px-4 py-2 text-sm font-bold text-zinc-100 transition-colors hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {working ? 'Preparing PNG…' : 'Export PNG'}
      </button>

      {(unavailable || exportState === 'done') && (
        <p
          role="status"
          aria-live="polite"
          data-testid={unavailable ? 'share-card-export-error' : 'share-card-export-status'}
          className={`mt-2 text-xs ${
            unavailable ? 'text-red-300' : 'text-emerald-300'
          }`}
        >
          {unavailable
            ? SHARE_CARD_EXPORT_UNAVAILABLE
            : `Saved ${savedFileName ?? model.fileName} to your downloads.`}
        </p>
      )}
    </section>
  );
};

export default ShareCardPanel;
