import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { History, Moon, Vote } from 'lucide-react';
import AccessibleDialog from './AccessibleDialog';
import ShareCardPanel from './ShareCardPanel';
import { listReplays } from '../replay/replayStore';
import type { ReplayRecord } from '../replay/replayTypes';
import {
  ABSTAIN_TARGET_LABEL,
  SUSPICION_LEVELS,
  buildFinalSuspicionRanking,
  buildSuspicionSeries,
  buildVoteReasonGroups,
  buildWolfChatGroups,
  type ReplaySuspicionPoint,
  type ReplaySuspicionSeries,
} from '../replay/replaySelectors';

export interface ReplayReviewProps {
  /**
   * Terminal gate. `App` only mounts this component on the GAME_OVER branch and
   * still passes the same condition, so no replay entry can exist while the
   * match is live. `false` renders nothing at all.
   */
  isGameOver: boolean;
  /**
   * Explicit replay (tests / future embedding). When omitted, the newest saved
   * replay is read with `listReplays()` from the H2-A data layer.
   */
  replay?: ReplayRecord | null;
  /**
   * Re-read trigger for the newest stored replay. `App` passes
   * `game.savedRecordId`, which changes after the GAME_OVER save effect and
   * flushes the newly written replay into the open panel.
   */
  refreshKey?: string | number | null;
  /** Open the dialog on mount (component tests). Defaults to closed. */
  initialOpen?: boolean;
}

const BOARD_LABELS: Record<ReplayRecord['boardId'], string> = {
  '9-standard': '9-Player Standard',
  '12-standard': '12-Player Standard',
};

const WINNER_LABELS: Record<ReplayRecord['outcome']['winner'], string> = {
  VILLAGERS: 'Village Wins',
  WEREWOLVES: 'Werewolves Win',
};

/** Read the newest saved replay without ever throwing. */
const latestStoredReplay = (): ReplayRecord | null => {
  try {
    return listReplays()[0] ?? null;
  } catch {
    return null;
  }
};

export const formatSuspicionPercent = (score: number | null): string => (
  score === null ? '—' : `${Math.round(score * 100)}%`
);

// Chart geometry in the fixed SVG viewBox. Keeping a viewBox and a fluid width
// means the chart scales down to the 390px viewport without a horizontal scroll.
const CHART_WIDTH = 640;
const CHART_HEIGHT = 240;
const CHART_LEFT = 42;
const CHART_RIGHT = 14;
const CHART_TOP = 18;
const CHART_BOTTOM = 34;
const PLOT_WIDTH = CHART_WIDTH - CHART_LEFT - CHART_RIGHT;
const PLOT_HEIGHT = CHART_HEIGHT - CHART_TOP - CHART_BOTTOM;

const pointX = (roundIndex: number, roundCount: number): number => {
  if (roundCount <= 1) return CHART_LEFT + PLOT_WIDTH / 2;
  return CHART_LEFT + (roundIndex / (roundCount - 1)) * PLOT_WIDTH;
};

const pointY = (score: number): number => CHART_TOP + (1 - score) * PLOT_HEIGHT;

/**
 * Split a line into contiguous round runs. A gap (for example the human dying)
 * starts a new segment so the SVG never draws a misleading bridge.
 */
const lineSegments = (
  points: readonly ReplaySuspicionPoint[],
  rounds: readonly number[],
): ReplaySuspicionPoint[][] => {
  const indexByRound = new Map(rounds.map((round, index) => [round, index]));
  const segments: ReplaySuspicionPoint[][] = [];
  let current: ReplaySuspicionPoint[] = [];
  let previousIndex: number | null = null;

  for (const point of points) {
    const index = indexByRound.get(point.round);
    if (index === undefined) continue;
    if (previousIndex !== null && index !== previousIndex + 1) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(point);
    previousIndex = index;
  }
  if (current.length > 0) segments.push(current);
  return segments;
};

const SuspicionChart: React.FC<{ series: ReplaySuspicionSeries }> = ({ series }) => {
  const roundCount = series.rounds.length;
  // Draw the highlighted human line last so it stays on top of the AI lines.
  const orderedLines = [...series.lines].sort(
    (a, b) => Number(a.isHumanSeat) - Number(b.isHumanSeat) || a.seat - b.seat,
  );
  const ariaLabel = `Suspicion of the human seat by ${series.lines.filter(line => !line.isHumanSeat).length} AI seats across ${roundCount} recorded rounds, scale 0 to 1`;

  return (
    <div
      data-testid="replay-suspicion-chart"
      className="mt-3 w-full min-w-0 overflow-hidden rounded border border-zinc-800 bg-black/40 p-2"
    >
      <svg
        className="block h-auto w-full"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-label={ariaLabel}
      >
        {SUSPICION_LEVELS.map(level => {
          const y = pointY(level);
          return (
            <g key={level}>
              <line
                x1={CHART_LEFT}
                x2={CHART_WIDTH - CHART_RIGHT}
                y1={y}
                y2={y}
                stroke="rgba(244,244,245,0.14)"
                strokeWidth={1}
              />
              <text x={CHART_LEFT - 8} y={y + 4} textAnchor="end" fontSize={11} fill="#a1a1aa">
                {level === 0 ? '0' : level === 1 ? '1' : level.toFixed(2).replace(/^0/, '')}
              </text>
            </g>
          );
        })}

        {series.rounds.map((round, index) => (
          <text
            key={`round-${round}`}
            x={pointX(index, roundCount)}
            y={CHART_HEIGHT - 10}
            textAnchor="middle"
            fontSize={11}
            fill="#a1a1aa"
          >
            R{round}
          </text>
        ))}

        {orderedLines.map(line => {
          const segments = lineSegments(line.points, series.rounds);
          return (
            <g
              key={line.seat}
              data-testid="replay-suspicion-line"
              data-seat={line.seat}
              data-human-seat={line.isHumanSeat ? 'true' : 'false'}
            >
              {segments.map((segment, segmentIndex) => (
                <polyline
                  key={`segment-${segmentIndex}`}
                  fill="none"
                  stroke={line.color}
                  strokeWidth={line.isHumanSeat ? 2.5 : 1.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={line.isHumanSeat ? 1 : 0.82}
                  points={segment.map(point => {
                    const index = series.rounds.indexOf(point.round);
                    return `${pointX(index, roundCount).toFixed(2)},${pointY(point.score).toFixed(2)}`;
                  }).join(' ')}
                />
              ))}
              {line.points.map(point => {
                const index = series.rounds.indexOf(point.round);
                return (
                  <circle
                    key={`point-${point.round}`}
                    cx={pointX(index, roundCount)}
                    cy={pointY(point.score)}
                    r={line.isHumanSeat ? 3 : 2}
                    fill={line.color}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const SuspicionLegend: React.FC<{ series: ReplaySuspicionSeries }> = ({ series }) => (
  <ul
    data-testid="replay-suspicion-legend"
    className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3"
  >
    {series.lines.map(line => (
      <li
        key={line.seat}
        data-testid="replay-suspicion-legend-item"
        data-seat={line.seat}
        data-human-seat={line.isHumanSeat ? 'true' : 'false'}
        className={`flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 ${
          line.isHumanSeat ? 'border border-zinc-500 bg-zinc-800/80 text-zinc-100' : 'text-zinc-400'
        }`}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: line.color }}
        />
        <span className="truncate">
          Seat {line.seat}
          {line.isHumanSeat ? ' (you) · AI avg' : ''}
        </span>
        <span className="ml-auto shrink-0 tabular-nums text-zinc-300">
          {formatSuspicionPercent(line.latest)}
        </span>
      </li>
    ))}
  </ul>
);

const FinalRanking: React.FC<{ replay: ReplayRecord }> = ({ replay }) => {
  const ranking = buildFinalSuspicionRanking(replay);
  if (!ranking || ranking.entries.length === 0) return null;

  return (
    <div
      data-testid="replay-final-ranking"
      className="mt-3 rounded border border-zinc-800 bg-zinc-900/60 p-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] uppercase tracking-wide text-zinc-500">
        <span>Final read · Day {ranking.round}</span>
        {ranking.humanRank !== null && (
          <span data-testid="replay-human-rank">
            You are #{ranking.humanRank} of {ranking.entries.length}
          </span>
        )}
      </div>
      <ul className="mt-2 space-y-1">
        {ranking.entries.map(entry => (
          <li
            key={entry.seat}
            data-testid="replay-final-ranking-row"
            data-seat={entry.seat}
            className={`flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-[11px] ${
              entry.isHumanSeat ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
            }`}
          >
            <span className="w-6 shrink-0 tabular-nums text-zinc-500">#{entry.rank}</span>
            <span className="min-w-0 flex-1 truncate">
              Seat {entry.seat}
              {entry.isHumanSeat ? ' (you)' : ''}
            </span>
            <span className="shrink-0 tabular-nums text-zinc-300">
              {formatSuspicionPercent(entry.averageScore)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const VoteReasonList: React.FC<{ replay: ReplayRecord; humanSeat: number }> = ({ replay, humanSeat }) => {
  const groups = buildVoteReasonGroups(replay);
  return (
    <section data-testid="replay-votes" className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
        <Vote className="h-4 w-4" aria-hidden="true" />
        Vote reasons
      </h3>
      <p className="mt-1 text-xs text-zinc-500">Every recorded exile vote, grouped by round.</p>
      {groups.length === 0 ? (
        <p data-testid="replay-votes-empty" className="mt-2 text-xs text-zinc-500">
          No votes were recorded for this replay.
        </p>
      ) : (
        <div className="mt-2 space-y-3">
          {groups.map(group => (
            <div key={group.round} data-testid="replay-vote-round" data-round={group.round}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Day {group.round}</p>
              <ul className="mt-1 space-y-1.5">
                {group.rows.map(row => (
                  <li
                    key={`${row.round}-${row.voterId}`}
                    data-testid="replay-vote-row"
                    data-round={row.round}
                    data-voter={row.voterId}
                    data-target={row.targetId ?? 'abstain'}
                    className="min-w-0 rounded border border-zinc-800 bg-black/35 p-2"
                  >
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]">
                      <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-zinc-400">Round {row.round}</span>
                      <span className="font-bold text-zinc-200">Seat {row.voterId}</span>
                      <span aria-hidden="true" className="text-zinc-500">→</span>
                      <span className="font-bold text-zinc-200">
                        {row.targetId === null
                          ? ABSTAIN_TARGET_LABEL
                          : `Seat ${row.targetId}${row.targetId === humanSeat ? ' (you)' : ''}`}
                      </span>
                    </p>
                    <p
                      className={`mt-1 text-xs leading-relaxed [overflow-wrap:anywhere] ${
                        row.hasReason ? 'text-zinc-300' : 'italic text-zinc-500'
                      }`}
                    >
                      {row.reason}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
};

const WolfChatList: React.FC<{ replay: ReplayRecord }> = ({ replay }) => {
  const groups = buildWolfChatGroups(replay);
  // No empty block: a replay without werewolf chat renders nothing here.
  if (groups.length === 0) return null;

  return (
    <section data-testid="replay-wolf-chat" className="min-w-0">
      <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-100">
        <Moon className="h-4 w-4" aria-hidden="true" />
        Wolf night chat
      </h3>
      <p className="mt-1 text-xs text-zinc-500">What the pack said behind closed eyes.</p>
      <div className="mt-2 space-y-3">
        {groups.map(group => (
          <div key={group.round} data-testid="replay-wolf-chat-round" data-round={group.round}>
            <p className="text-[10px] font-bold uppercase tracking-widest text-red-300/80">Night {group.round}</p>
            <ul className="mt-1 space-y-1.5">
              {group.rows.map((row, index) => (
                <li
                  key={`${row.round}-${row.speakerId}-${index}`}
                  data-testid="replay-wolf-chat-row"
                  data-round={row.round}
                  data-speaker={row.speakerId}
                  className="min-w-0 rounded border border-red-900/60 bg-red-950/25 p-2"
                >
                  <p className="text-[10px] font-bold text-red-200/90">Seat {row.speakerId}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-300 [overflow-wrap:anywhere]">
                    {row.message}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
};

/** The dialog body. Exported so tests and H2-E can render it in isolation. */
export const ReplayReviewPanel: React.FC<{ replay: ReplayRecord }> = ({ replay }) => {
  const series = buildSuspicionSeries(replay);
  const aiSeatCount = series.lines.filter(line => !line.isHumanSeat).length;
  const rounds = replay.outcome.rounds;

  return (
    <div data-testid="replay-review-panel" className="min-w-0 space-y-5 text-left">
      <header className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Local match replay</p>
        <p className="mt-1 text-base font-black text-zinc-100">
          {BOARD_LABELS[replay.boardId] ?? replay.boardId}
          {' · '}
          {WINNER_LABELS[replay.outcome.winner] ?? replay.outcome.winner}
        </p>
        <p className="mt-0.5 text-xs text-zinc-400">
          {rounds} round{rounds === 1 ? '' : 's'} · {replay.isGuest ? 'Guest match' : 'Signed-in match'}
        </p>
      </header>

      <section data-testid="replay-suspicion" className="min-w-0">
        <h3 className="text-sm font-bold text-zinc-100">Suspicion over time</h3>
        <p className="mt-1 text-xs text-zinc-500">
          How suspicious each AI seat was of you (Seat {series.humanSeat}) after each recorded round.
          The highlighted line is the AI average toward you.
        </p>
        {series.hasData ? (
          <>
            <SuspicionChart series={series} />
            <SuspicionLegend series={series} />
            <p className="mt-1 text-[10px] text-zinc-500">
              {aiSeatCount} AI lines + your highlighted average · vertical scale 0–1
            </p>
          </>
        ) : (
          <p data-testid="replay-suspicion-empty" className="mt-2 text-xs text-zinc-500">
            Suspicion data unavailable for this replay.
          </p>
        )}
        <FinalRanking replay={replay} />
      </section>

      <VoteReasonList replay={replay} humanSeat={series.humanSeat} />
      <WolfChatList replay={replay} />

      <p data-testid="replay-local-note" className="text-[10px] leading-relaxed text-zinc-500">
        Replays are stored only in this browser (most recent 5 matches). No network request is made to build this panel.
      </p>

      {/* H2-E mounts <ShareCardPanel /> at the bottom of this panel. */}
      <div data-testid="replay-share-slot" className="min-h-4 min-w-0">
        <ShareCardPanel replay={replay} />
      </div>
    </div>
  );
};

const ReplayReview: React.FC<ReplayReviewProps> = ({
  isGameOver,
  replay,
  refreshKey,
  initialOpen = false,
}) => {
  const [isOpen, setIsOpen] = useState(initialOpen);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [storedReplay, setStoredReplay] = useState<ReplayRecord | null>(() => (
    replay === undefined ? latestStoredReplay() : null
  ));
  // The terminal card sits inside `.center-console`, which is transformed (and
  // `.game-room` clips overflow). Rendering the dialog in a body portal escapes
  // that containing block so the fixed backdrop really covers the viewport.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
    return () => setPortalTarget(null);
  }, []);

  useEffect(() => {
    if (replay !== undefined) return;
    setStoredReplay(latestStoredReplay());
  }, [replay, refreshKey]);

  if (!isGameOver) return null;

  const activeReplay = replay !== undefined ? replay : storedReplay;
  const canRenderReplay = Boolean(
    activeReplay
    && activeReplay.outcome
    && typeof activeReplay.outcome.rounds === 'number'
    && Array.isArray(activeReplay.players),
  );
  const openReview = () => {
    // Re-read on open so the panel never shows the previous match when the
    // GAME_OVER save effect and the first render landed in the same commit.
    if (replay === undefined) setStoredReplay(latestStoredReplay());
    setIsOpen(true);
  };

  const dialog = (
    <AccessibleDialog
      open={isOpen}
      title="Replay review"
      description="Suspicion curves, exile vote reasons, and werewolf night chat from the saved match."
      closeLabel="Close replay review"
      onClose={() => setIsOpen(false)}
      returnFocusRef={triggerRef}
    >
      {activeReplay && canRenderReplay ? (
        <ReplayReviewPanel replay={activeReplay} />
      ) : (
        <div data-testid="replay-review-panel" className="min-w-0 text-left">
          <p data-testid="replay-unavailable" className="text-sm text-zinc-200">Replay unavailable.</p>
          <p className="mt-1 text-xs text-zinc-500">
            This match finished without a saved local replay. You can still return to the lobby.
          </p>
        </div>
      )}
    </AccessibleDialog>
  );

  return (
    <section data-testid="replay-review" className="mt-4 w-full">
      <button
        ref={triggerRef}
        type="button"
        data-testid="replay-review-open"
        onClick={openReview}
        aria-haspopup="dialog"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded border border-zinc-600 bg-zinc-900/85 px-4 py-2 text-sm font-bold text-zinc-100 transition-colors hover:bg-zinc-800"
      >
        <History className="h-4 w-4" aria-hidden="true" />
        Replay review
      </button>
      {portalTarget ? createPortal(dialog, portalTarget) : dialog}
    </section>
  );
};

export default ReplayReview;
