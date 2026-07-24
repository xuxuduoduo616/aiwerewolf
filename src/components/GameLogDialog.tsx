import React, { useId, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { GameLog, GameRecord, Player, VoteRecord } from '../types';
import type { DisplayLanguage } from '../i18n';
import AccessibleDialog from './AccessibleDialog';
import LogMessage from './LogMessage';
import RecordsPanel from './RecordsPanel';
import VoteSummary from './VoteSummary';

export type GameInfoView = 'log' | 'records';

interface GameLogFeedProps {
  logs: GameLog[];
  language: DisplayLanguage;
  showVoteSummary: boolean;
  voteRound: number | null;
  voteRecords: VoteRecord[];
  players: Player[];
  eliminatedPlayerId: number | null;
  isProcessingAI: boolean;
  endRef?: React.RefObject<HTMLDivElement>;
}

interface GameLogDialogProps extends Omit<GameLogFeedProps, 'endRef'> {
  open: boolean;
  onClose: () => void;
  returnFocusRef: React.RefObject<HTMLButtonElement>;
  records: GameRecord[];
  recordError?: string;
}

export const GameLogFeed: React.FC<GameLogFeedProps> = ({
  logs,
  language,
  showVoteSummary,
  voteRound,
  voteRecords,
  players,
  eliminatedPlayerId,
  isProcessingAI,
  endRef,
}) => (
  <div className="game-log-feed">
    {logs.map(log => (
      <div
        key={log.id}
        className={`log-entry-in ${log.isSystem ? 'text-center' : log.speakerId === 1 ? 'text-right' : 'text-left'}`}
      >
        {log.isSystem ? (
          <span className={`inline-block text-[10px] md:text-[11px] px-2 md:px-3 py-1 rounded-full border ${log.tone === 'wolf' ? 'border-red-900 bg-red-950/35 text-red-100' : 'border-zinc-800 bg-black/30 text-zinc-400'}`}>
            <LogMessage log={log} language={language} />
          </span>
        ) : (
          <div className={`inline-block max-w-full rounded-lg border p-1.5 md:p-2 text-xs leading-relaxed ${log.speakerId === 1 ? 'bg-zinc-100 text-black border-zinc-200' : 'bg-zinc-900 border-zinc-700 text-zinc-200'}`}>
            <div className="text-[10px] font-bold opacity-70 mb-1">
              {log.speakerId === 1
                ? 'YOU'
                : `PLAYER ${log.speakerId}`}
            </div>
            <LogMessage log={log} language={language} />
          </div>
        )}
      </div>
    ))}
    {showVoteSummary && voteRound !== null && (
      <VoteSummary
        voteRecords={voteRecords}
        players={players}
        round={voteRound}
        eliminatedPlayerId={eliminatedPlayerId}
      />
    )}
    {isProcessingAI && (
      <div className="text-xs text-zinc-500 flex items-center gap-2" role="status">
        <Loader2 className="w-3 h-3 animate-spin" />
        AI is considering the situation...
      </div>
    )}
    {endRef && <div ref={endRef} />}
  </div>
);

const GameLogDialog: React.FC<GameLogDialogProps> = ({
  open,
  onClose,
  returnFocusRef,
  records,
  recordError,
  language,
  ...feedProps
}) => {
  const [view, setView] = useState<GameInfoView>('log');
  const reactId = useId().replace(/:/g, '');
  const logTabRef = useRef<HTMLButtonElement>(null);
  const recordsTabRef = useRef<HTMLButtonElement>(null);
  const logTabId = `game-log-tab-${reactId}`;
  const recordsTabId = `game-records-tab-${reactId}`;
  const logPanelId = `game-log-panel-${reactId}`;
  const recordsPanelId = `game-records-panel-${reactId}`;

  const selectView = (nextView: GameInfoView, moveFocus = false) => {
    setView(nextView);
    if (moveFocus) {
      window.requestAnimationFrame(() => {
        (nextView === 'log' ? logTabRef.current : recordsTabRef.current)?.focus();
      });
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    selectView(event.key === 'ArrowLeft' || event.key === 'Home' ? 'log' : 'records', true);
  };

  const handleClose = () => {
    setView('log');
    onClose();
  };

  return (
    <AccessibleDialog
      open={open}
      title="Game information"
      onClose={handleClose}
      closeLabel="Close game information"
      className="game-log-dialog"
      initialFocusRef={logTabRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="game-info-tabs" role="tablist" aria-label="Game information views">
        <button
          ref={logTabRef}
          id={logTabId}
          type="button"
          role="tab"
          aria-selected={view === 'log'}
          aria-controls={logPanelId}
          tabIndex={view === 'log' ? 0 : -1}
          onClick={() => selectView('log')}
          onKeyDown={handleTabKeyDown}
        >
          Game log
        </button>
        <button
          ref={recordsTabRef}
          id={recordsTabId}
          type="button"
          role="tab"
          aria-selected={view === 'records'}
          aria-controls={recordsPanelId}
          tabIndex={view === 'records' ? 0 : -1}
          onClick={() => selectView('records')}
          onKeyDown={handleTabKeyDown}
        >
          My records
        </button>
      </div>

      {view === 'log' ? (
        <div
          id={logPanelId}
          className="game-info-panel"
          role="tabpanel"
          aria-labelledby={logTabId}
          tabIndex={0}
        >
          <GameLogFeed language={language} {...feedProps} />
        </div>
      ) : (
        <div
          id={recordsPanelId}
          className="game-info-panel"
          role="tabpanel"
          aria-labelledby={recordsTabId}
          tabIndex={0}
        >
          <RecordsPanel records={records} show error={recordError} compact />
        </div>
      )}
    </AccessibleDialog>
  );
};

export default GameLogDialog;
