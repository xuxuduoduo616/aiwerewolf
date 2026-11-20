import React, { useEffect, useRef, useState } from 'react';
import { GamePhase, Role } from '../types';
import { getPhaseLabel } from '../constants';
import type { useGameState } from '../hooks/useGameState';
import type { useRecords } from '../hooks/useRecords';
import type { DisplayLanguage } from '../i18n';
import type { SkinProduct } from '../economy/catalog';
import { resolveVoteResult } from '../gameEngine';
import { playTick } from '../services/speechAudio';
import { PlayerCard } from '../components/PlayerCard';
import { PlayerKnowledgeBadge, WitchVictimNotice } from '../components/PlayerKnowledgeBadge';
import ActionBar from '../components/ActionBar';
import RecordsPanel from '../components/RecordsPanel';
import SpeechInput from '../components/SpeechInput';
import GameRoom, { GamePlayerSeat } from '../components/GameRoom';
import GameAudioControls from '../components/GameAudioControls';
import GameControlsGuide from '../components/GameControlsGuide';
import GameLogDialog, { GameLogFeed } from '../components/GameLogDialog';
import ReplayReview from '../components/ReplayReview';
import LeaveGameDialog from '../components/LeaveGameDialog';
import MatchIntroOverlay from '../components/MatchIntroOverlay';
import PhaseAtmosphere from '../components/PhaseAtmosphere';
import PhaseWorkspace from '../components/PhaseWorkspace';
import MatchFullscreenButton from '../components/MatchFullscreenButton';
import { getTimeOfDay, useFallenPlayers, usePhaseCue } from '../motion/phaseCues';
import { Clock3, LogOut, Pause, Play, ScrollText, Skull, Trophy, User as UserIcon } from 'lucide-react';

const MY_PLAYER_ID = 1;

export const ROLE_LABELS_EN: Record<Role, string> = {
  [Role.WEREWOLF]: 'Werewolf',
  [Role.VILLAGER]: 'Villager',
  [Role.SEER]: 'Seer',
  [Role.WITCH]: 'Witch',
  [Role.HUNTER]: 'Hunter',
  [Role.IDIOT]: 'Idiot',
};

const ROLE_DESCRIPTIONS_EN: Record<Role, string> = {
  [Role.WEREWOLF]: 'Choose a victim with your pack at night, then conceal your identity during the day.',
  [Role.VILLAGER]: 'You have no night ability. Find the werewolves through speeches, votes, and deduction.',
  [Role.SEER]: 'Check one player each night to learn whether they are a werewolf.',
  [Role.WITCH]: 'You have one antidote and one poison, and each can be used only once per game.',
  [Role.HUNTER]: 'When killed normally, you may shoot one player. You cannot shoot if poisoned.',
  [Role.IDIOT]: 'If exiled during the day, reveal and survive, but lose your vote for the rest of the game.',
};

export interface GameScreenProps {
  game: ReturnType<typeof useGameState>;
  rec: ReturnType<typeof useRecords>;
  isGuest: boolean;
  principalId: string | null;
  displayLanguage: DisplayLanguage;
  equippedSkinProduct: SkinProduct | null;
  economyFeedback: string | null | undefined;
  gameControlsSeen: Set<string>;
  /** Leave the match; App owns navigation and start/leave locks. */
  onReturnToLobby: () => void;
}

/**
 * Full-screen match view. Rendered outside the application shell so it can
 * be responsive on both desktop and mobile; lazy-loaded from App so the lobby
 * and login never pay for game-room code.
 */
const GameScreen: React.FC<GameScreenProps> = ({
  game, rec, isGuest, principalId, displayLanguage, equippedSkinProduct,
  economyFeedback, gameControlsSeen, onReturnToLobby,
}) => {
  const [isGameInfoOpen, setIsGameInfoOpen] = useState(false);
  const [isLeaveGameOpen, setIsLeaveGameOpen] = useState(false);
  const gameHeaderRef = useRef<HTMLElement>(null);
  const gameInfoTriggerRef = useRef<HTMLButtonElement>(null);
  const leaveGameTriggerRef = useRef<HTMLButtonElement>(null);
  const phaseCue = usePhaseCue(game.phase, game.roundCount);
  const fallenIds = useFallenPlayers(game.players);
  const timeOfDay = getTimeOfDay(game.phase);
  const humanWolfNight = game.phase === GamePhase.NIGHT_WEREWOLVES && game.me?.role === Role.WEREWOLF && game.me.isAlive;

  useEffect(() => {
    if (game.phase === GamePhase.GAME_OVER || game.phase === GamePhase.LOBBY || game.phase === GamePhase.LOGIN) {
      setIsLeaveGameOpen(false);
    }
  }, [game.phase]);

  // Vote-countdown tick: one short beep per second during the final 3s of the
  // human vote countdown (browser-tts-mvp). The audio service enforces mute
  // and the autoplay gesture requirement; timer semantics are untouched.
  useEffect(() => {
    if (game.voteTimer !== null && game.voteTimer >= 1 && game.voteTimer <= 3) {
      playTick();
    }
  }, [game.voteTimer]);

  const returnToLobby = () => {
    setIsLeaveGameOpen(false);
    setIsGameInfoOpen(false);
    onReturnToLobby();
  };

  const requestReturnToLobby = () => {
    if (game.phase === GamePhase.GAME_OVER) {
      returnToLobby();
      return;
    }
    setIsGameInfoOpen(false);
    setIsLeaveGameOpen(true);
  };

  // ── helpers ──────────────────────────────────────────────────────────
  const seatStyle = (index: number, total: number): React.CSSProperties => {
    const angle = -90 + (360 / total) * index;
    const rad = (angle * Math.PI) / 180;
    const isFinalTwelvePlayerShoulderSeat =
      game.phase === GamePhase.GAME_OVER && total === 12 && [2, 4, 8, 10].includes(index);
    const verticalRadius = isFinalTwelvePlayerShoulderSeat ? 40.5 : 37;
    return {
      left: `${50 + 42 * Math.cos(rad)}%`,
      top: `${50 + verticalRadius * Math.sin(rad)}%`,
      transform: 'translate(-50%, -50%)',
    };
  };

  // Latest completed vote round → structured summary in the log sidebar.
  const voteRound = game.voteRecords.length > 0
    ? Math.max(...game.voteRecords.map(v => v.round))
    : null;
  const showVoteSummary =
    voteRound !== null &&
    game.phase !== GamePhase.DAY_VOTING &&
    game.phase !== GamePhase.DAY_DISCUSSION;
  const voteSummaryEliminatedId = (() => {
    if (voteRound === null) return null;
    const tally: Record<number, number> = {};
    for (const v of game.voteRecords) {
      if (v.round === voteRound && v.targetId !== null) {
        tally[v.targetId] = (tally[v.targetId] || 0) + 1;
      }
    }
    return resolveVoteResult(tally);
  })();

  const logFeedProps = {
    logs: game.logs,
    language: displayLanguage,
    showVoteSummary,
    voteRound,
    voteRecords: game.voteRecords,
    players: game.players,
    eliminatedPlayerId: voteSummaryEliminatedId,
    isProcessingAI: (game.isProcessingAI || game.wolfThinking) && !game.isPaused,
    canViewWolfChat: game.me?.role === Role.WEREWOLF,
  };

  const gameHeader = (
    <header ref={gameHeaderRef} tabIndex={-1} className="game-room-header px-3 md:px-5 border-b border-zinc-800/80 bg-black/55 backdrop-blur flex items-center justify-between">
      <div className="game-room-phase-summary flex items-center gap-2 md:gap-3">
        <div className="game-round-indicator w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-full bg-zinc-100 text-black flex items-center justify-center font-black text-sm">
          {Math.max(1, game.roundCount)}
        </div>
        <div className="min-w-0">
          <h2 className="text-xs md:text-sm font-bold tracking-wide">{game.config?.name}</h2>
          <p className="text-[10px] md:text-xs text-zinc-400">{getPhaseLabel(game.phase, 'en')}</p>
        </div>
      </div>
      <div className="game-room-header-controls">
        <GameAudioControls
          voiceEnabled={game.ttsEnabled} volume={game.audioVolume} rate={game.ttsRate} muted={game.isMuted}
          onVoiceChange={game.setTtsEnabled} onVolumeChange={game.setAudioVolume}
          onRateChange={game.setTtsRate} onMuteChange={game.setIsMuted}
        />
        <div className="game-room-utility-controls">
          <MatchFullscreenButton />
          <button
            ref={gameInfoTriggerRef}
            type="button"
            onClick={() => { if (!isLeaveGameOpen) setIsGameInfoOpen(true); }}
            className="game-log-trigger icon-button"
            data-tour-target="game-log"
            title="Game log and records"
            aria-label="Open game log and records"
            aria-haspopup="dialog"
          >
            <ScrollText className="w-4 h-4" aria-hidden="true" />
            <span>Log</span>
          </button>
          <button ref={leaveGameTriggerRef} type="button" onClick={requestReturnToLobby} className="icon-button" data-tour-target="game-exit" title="exit the game" aria-label="exit the game" aria-haspopup={game.phase === GamePhase.GAME_OVER ? undefined : 'dialog'}>
            <LogOut className="w-4 h-4" aria-hidden="true" />
            <span>Exit</span>
          </button>
        </div>
      </div>
    </header>
  );

  const gameSidebar = (
    <aside className="game-room-sidebar bg-zinc-950/88" aria-label="Game log sidebar">
      <div className="h-16 px-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-bold">
          <ScrollText className="w-4 h-4" />
          {rec.showRecords ? 'My records' : 'Game log'}
        </div>
        <button
          type="button"
          onClick={() => rec.setShowRecords(!rec.showRecords)}
          className="min-h-11 min-w-11 text-xs text-zinc-400 hover:text-white"
        >
          {rec.showRecords ? 'Log' : 'Records'}
        </button>
      </div>
      {rec.showRecords ? (
        <RecordsPanel records={rec.records} show error={rec.recordError} compact isGuest={isGuest} />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 md:p-4">
          <GameLogFeed {...logFeedProps} endRef={game.logsEndRef} />
        </div>
      )}
    </aside>
  );

  return (
    <>
      <GameRoom
        header={gameHeader}
        sidebar={gameSidebar}
        boardLabel="Werewolf seats and action console"
        timeOfDay={timeOfDay}
      >
        <PhaseWorkspace
          className={`center-console game-action-console${humanWolfNight ? ' wolf-night-console' : ''}${game.winner ? (game.winner === 'WEREWOLVES' ? ' victory-wolves' : ' victory-village') : ''}`}
          seats={game.players.map((player, index) => {
            const isHumanWolf = game.me?.role === Role.WEREWOLF && game.me?.isAlive === true;
            const isWolfTeammate = isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF';
            const justFell = fallenIds.has(player.id);
            return (
              <GamePlayerSeat key={player.id} desktopStyle={seatStyle(index, game.players.length)} className={justFell ? 'is-fallen' : undefined}>
                <PlayerCard
                  player={player} isMe={player.id === MY_PLAYER_ID}
                  equippedSkin={player.id === MY_PLAYER_ID ? equippedSkinProduct : null}
                  revealRole={game.phase === GamePhase.GAME_OVER}
                  isSelected={game.selectedPlayerId === player.id}
                  isSpeaking={game.currentSpeaker?.id === player.id || game.wolfSpeakerId === player.id}
                  hasSpoken={game.phase === GamePhase.DAY_DISCUSSION && game.spokenPlayerIds.has(player.id)}
                  compact onClick={() => game.setSelectedPlayerId(player.id)}
                  isWolfTeammate={isWolfTeammate}
                  customBadge={
                    game.nightState.wolfKillId === player.id && game.me?.role === Role.WEREWOLF
                      ? <Skull className="w-5 h-5 text-red-300" />
                      : <PlayerKnowledgeBadge
                          playerId={player.id}
                          viewer={game.me}
                          phase={game.phase}
                          nightState={game.nightState}
                          seerCheck={game.aiSeerLastCheck}
                        />
                  }
                />
                {justFell && (
                  <span className="seat-fallen-stamp vote-stamp" aria-hidden="true">
                    <Skull className="w-6 h-6" />
                  </span>
                )}
              </GamePlayerSeat>
            );
          })}
        >
            {game.winner ? (
              <div className={`text-center ${game.winner === 'WEREWOLVES' ? 'game-over-wolves' : 'game-over-village'}`}>
                <Trophy className="w-10 h-10 mx-auto mb-3 text-zinc-100" />
                <h1 className="text-3xl font-black">{game.winner === 'WEREWOLVES' ? 'Werewolves Win' : 'Village Wins'}</h1>
                <p className="text-sm text-zinc-300 mt-2">Round {Math.max(1, game.roundCount)} complete{game.me ? ` · ${ROLE_LABELS_EN[game.me.role]}` : ''}</p>
                <p className="text-xs text-zinc-400 mt-2">{isGuest ? 'Guest match complete. Log in to save future matches.' : game.savedRecordId === 'failed' ? 'Record could not be saved.' : game.savedRecordId ? 'Record saved.' : 'Saving record...'}</p>
                <button onClick={returnToLobby} className="mt-5 action-button game-return-button">Return to Lobby</button>
                <ReplayReview
                  isGameOver={game.phase === GamePhase.GAME_OVER && Boolean(game.winner)}
                  refreshKey={game.savedRecordId}
                />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <div>
                    <div className="text-xs text-zinc-500">PHASE</div>
                    <div key={game.phase} className="text-lg font-bold phase-label-in">{getPhaseLabel(game.phase, 'en')}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {game.wolfCountdown !== null && (
                      <div className="timer-pill"><Clock3 className="w-4 h-4" />{game.wolfCountdown}s</div>
                    )}
                    {game.voteTimer !== null && (
                      <div className={`timer-pill${game.voteTimer <= 3 && !game.isPaused ? ' urgent' : ''}`}>
                        <Clock3 className="w-4 h-4" />{game.voteTimer}s
                      </div>
                    )}
                    {game.speechTimer !== null && game.currentSpeaker?.id === MY_PLAYER_ID && (
                      <div className={`timer-pill${game.speechTimer <= 10 && !game.isPaused ? ' urgent' : ''}`}>
                        <Clock3 className="w-4 h-4" />{game.speechTimer}s
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={game.togglePause}
                      className={`game-pause-button${game.isPaused ? ' is-paused' : ''}`}
                    >
                      {game.isPaused ? <>Resume <Play aria-hidden="true" size={15} /></> : <>Pause <Pause aria-hidden="true" size={15} /></>}
                    </button>
                  </div>
                </div>
                {game.currentSpeaker && game.currentSpeaker.id !== MY_PLAYER_ID && (
                    <button
                      type="button"
                      onClick={game.skipCurrentSpeech}
                      disabled={game.isPaused}
                      className="skip-speech-button"
                      title="Skip this AI speech and move to the next speaker"
                    >
                      Skip speech
                    </button>
                  )}
                <p className="mt-4 text-sm text-zinc-300 leading-relaxed min-h-[42px]">
                  <span role="status" className="game-pause-status">{game.isPaused ? 'AI Paused — Take your time to read' : ''}</span>
                  {!game.isPaused && game.phaseHint}
                </p>
                {/* Flips once when the match view mounts, not on every phase. */}
                <div className="role-reveal mt-4 rounded border border-zinc-700 bg-black/35 p-3 text-xs text-zinc-300">
                  <div className="flex items-center gap-2 font-bold text-zinc-100">
                    <UserIcon className="w-4 h-4" />
                    Your role: {game.me ? ROLE_LABELS_EN[game.me.role] : 'Unknown'}
                  </div>
                  {!humanWolfNight && <p className="mt-2 text-zinc-400">{game.me ? ROLE_DESCRIPTIONS_EN[game.me.role] : ''}</p>}
                  {humanWolfNight && game.nightState.wolfKillId !== null && <p className="mt-2 text-red-200">Confirmed target: Player {game.nightState.wolfKillId}</p>}
                  {game.selectedPlayer && <p className="mt-2 text-zinc-300">Selected: Player {game.selectedPlayer.id} <span data-ui-copy-category="USER_AUTHORED" data-ui-copy-allow="USER_APP_SELECTED_PLAYER">{game.selectedPlayer.name}</span></p>}
                  <WitchVictimNotice viewer={game.me} phase={game.phase} nightState={game.nightState} />
                </div>
                <ActionBar
                  phase={game.phase} me={game.me} selectedPlayer={game.selectedPlayer}
                  isProcessingAI={game.isPaused || game.isProcessingAI} witchStatus={game.witchStatus}
                  nightState={game.nightState}
                  onAction={() => game.selectedPlayerId && game.handlePlayerAction(game.selectedPlayerId)}
                  onVoteSkip={() => game.finishVote(null)}
                  onWitchSave={game.handleWitchSave}
                  onWitchSkip={game.skipWitch}
                  onSkipWolfChat={game.skipWolfChat}
                />
                <SpeechInput
                  key={`speech-${game.phase}-${game.roundCount}`}
                  value={game.userInput} onChange={value => { if (humanWolfNight) game.interruptWolfChat(); game.setUserInput(value); }}
                  onSubmit={humanWolfNight ? () => { rec.setShowRecords(false); game.handleWolfChatSubmit(); } : game.handleHumanSpeechSubmit}
                  onCompose={humanWolfNight ? game.interruptWolfChat : undefined}
                  wolfPlayers={humanWolfNight ? game.players : undefined}
                  submitDisabled={game.isPaused}
                  visible={humanWolfNight || (game.phase === GamePhase.DAY_DISCUSSION && game.currentSpeaker?.id === MY_PLAYER_ID)}
                  selectedPlayer={game.selectedPlayer}
                  language={displayLanguage}
                />
              </>
            )}
        </PhaseWorkspace>
      </GameRoom>

      <PhaseAtmosphere timeOfDay={timeOfDay} cue={game.introPending ? null : phaseCue} />

      {game.introPending && (
        <MatchIntroOverlay
          boardName={game.config?.name ?? 'AI Werewolf'}
          roleLabel={game.me ? ROLE_LABELS_EN[game.me.role] : null}
          players={game.players}
          returnFocusRef={gameHeaderRef}
          onDone={game.releaseIntro}
        />
      )}

      {principalId && !game.introPending && game.phase !== GamePhase.GAME_OVER && (
        <GameControlsGuide key={principalId} principalId={principalId}
          seenThisSession={gameControlsSeen} isPaused={game.isPaused} togglePause={game.togglePause} />
      )}
      <GameLogDialog
        open={isGameInfoOpen && !isLeaveGameOpen}
        onClose={() => setIsGameInfoOpen(false)}
        returnFocusRef={gameInfoTriggerRef}
        records={rec.records}
        recordError={rec.recordError}
        {...logFeedProps}
      />
      {isLeaveGameOpen && (
        <LeaveGameDialog
          onCancel={() => setIsLeaveGameOpen(false)}
          onConfirm={returnToLobby}
          returnFocusRef={leaveGameTriggerRef}
        />
      )}
      {economyFeedback && (
        <p className="economy-global-feedback economy-global-feedback--game" role="status" aria-live="polite">
          {economyFeedback}
        </p>
      )}
    </>
  );
};

export default GameScreen;
