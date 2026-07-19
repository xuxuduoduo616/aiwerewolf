import React, { useState } from 'react';
import { GamePhase, Role, DIFFICULTY_CONFIGS, difficultyLabel, difficultyDescription } from './types';
import { GAME_MODES, getPhaseLabel, ROLE_DESCRIPTIONS, ROLE_LABELS } from './constants';
import useAuth from './hooks/useAuth';
import { useRecords } from './hooks/useRecords';
import { useGameState } from './hooks/useGameState';
import { PlayerCard } from './components/PlayerCard';
import ActionBar from './components/ActionBar';
import RecordsPanel from './components/RecordsPanel';
import WolfChannel from './components/WolfChannel';
import SpeechInput from './components/SpeechInput';
import VoteSummary from './components/VoteSummary';
import LogMessage from './components/LogMessage';
import GlobalShell from './components/GlobalShell';
import type { ShellView } from './components/GlobalShell';
import LobbyHome from './components/LobbyHome';
import MatchSelection from './components/MatchSelection';
import ProfileView from './components/ProfileView';
import { useDisplayLanguage } from './i18n';
import { resolveVoteResult } from './gameEngine';
import { playTick } from './services/speechAudio';
import {
  Clock3, History, KeyRound, Languages, Loader2,
  LogOut, Mail, Moon, Power, RefreshCw, ScrollText, Shield,
  Skull, Trophy, User as UserIcon, Volume2, VolumeX,
} from 'lucide-react';

const MY_PLAYER_ID = 1;

const App: React.FC = () => {
  const auth = useAuth();
  const [displayLanguage, toggleDisplayLanguage] = useDisplayLanguage();
  const [activeView, setActiveView] = useState<ShellView>('home');
  const rec = useRecords(auth.session);
  const game = useGameState({
    session: auth.session,
    isGuest: auth.isGuest,
    profile: auth.profile,
    authEmail: auth.authEmail,
    records: rec.records,
    setRecords: rec.setRecords,
    recordError: rec.recordError,
    setRecordError: rec.setRecordError,
  });

  // Vote-countdown tick: one short beep per second during the final 3s of the
  // human vote countdown (browser-tts-mvp). The audio service enforces mute
  // and the autoplay gesture requirement; timer semantics are untouched.
  React.useEffect(() => {
    if (game.voteTimer !== null && game.voteTimer >= 1 && game.voteTimer <= 3) {
      playTick();
    }
  }, [game.voteTimer]);

  // ── helpers ──────────────────────────────────────────────────────────
  const seatStyle = (index: number, total: number): React.CSSProperties => {
    const angle = -90 + (360 / total) * index;
    const rad = (angle * Math.PI) / 180;
    return {
      left: `${50 + 42 * Math.cos(rad)}%`,
      top: `${50 + 37 * Math.sin(rad)}%`,
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

  // ── LOGIN ─────────────────────────────────────────────────────────────
  if (auth.isRestoringSession) {
    return (
      <div className="sketch-scene min-h-screen flex items-center justify-center font-sans text-zinc-200">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">正在恢复登录状态…</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <div className="sketch-scene min-h-screen flex items-center justify-center font-sans text-zinc-200">
        <div className="auth-panel parchment-border w-[min(92vw,430px)] p-8 border border-zinc-600 bg-zinc-950/86 rounded-lg shadow-[0_0_45px_rgba(0,0,0,0.6)]">
          <div className="text-center mb-7">
            <Moon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <h1 className="text-4xl text-zinc-100 font-bold tracking-wide cinzel">AI WEREWOLF</h1>
            <p className="text-xs text-zinc-400 mt-2">Shadows of the Village</p>
          </div>
          <div className="space-y-3">
            <label className="block text-xs text-zinc-400">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
              <input className="w-full bg-black/70 border border-zinc-700 rounded px-10 py-3 text-white outline-none focus:border-zinc-300" placeholder="you@example.com" value={auth.authEmail} onChange={e => auth.setAuthEmail(e.target.value)} />
            </div>
            <label className="block text-xs text-zinc-400">Display Name</label>
            <input className="w-full bg-black/70 border border-zinc-700 rounded px-4 py-3 text-white outline-none focus:border-zinc-300" placeholder="optional" value={auth.authName} onChange={e => auth.setAuthName(e.target.value)} />
            {auth.authStep === 'VERIFY' && (
              <>
                <label className="block text-xs text-zinc-400">Verification Code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input className="w-full bg-black/70 border border-zinc-700 rounded px-10 py-3 text-white outline-none focus:border-zinc-300" placeholder="6-digit email code" value={auth.authCode} onChange={e => auth.setAuthCode(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {auth.authError && <p className="mt-4 text-xs leading-relaxed text-amber-200 bg-amber-950/35 border border-amber-900 rounded p-3">{auth.authError}</p>}
          <button
            onClick={() => auth.authStep === 'EMAIL'
              ? auth.handleSendOtp()
              : auth.handleVerifyOtp(records => { rec.setRecords(records); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); })}
            disabled={auth.isAuthLoading}
            className="mt-6 w-full bg-zinc-100 text-black py-3 font-bold rounded hover:bg-white transition flex items-center justify-center gap-2"
          >
            {auth.isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {auth.authStep === 'EMAIL' ? 'SEND EMAIL CODE' : 'VERIFY AND ENTER'}
          </button>
          <div className="flex justify-between mt-4 text-xs text-zinc-400">
            <button onClick={() => auth.setAuthStep(auth.authStep === 'EMAIL' ? 'VERIFY' : 'EMAIL')} className="hover:text-white">Switch Step</button>
            <button onClick={() => auth.handleGuest(() => { rec.loadLocalRecords(); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); })} className="hover:text-white">Guest Trial</button>
          </div>
          <p className="mt-5 text-[11px] leading-relaxed text-zinc-500 text-center border-t border-zinc-800 pt-4">
            新手推荐：点击 <span className="text-zinc-300">Guest Trial</span> 直接试玩，选择「新手」难度。
            AI 会引导你熟悉预言家查验、女巫用药、狼人夜刀等机制。
          </p>
        </div>
      </div>
    );
  }

  // ── After login, everything renders inside the mobile shell ──────────
  // Full game view (preserved from original App.tsx — now rendered inside shell)
  const renderGameView = () => (
    <div className="sketch-scene h-full text-zinc-200 overflow-hidden" style={{ flex: 1 }}>
      <div className="relative z-10 h-full grid grid-cols-[1fr_340px]">
        <main className="relative flex flex-col min-w-0">
          {/* Header */}
          <header className="h-16 px-5 border-b border-zinc-800/80 bg-black/55 backdrop-blur flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-zinc-100 text-black flex items-center justify-center font-black">{Math.max(1, game.roundCount)}</div>
              <div>
                <h2 className="text-sm font-bold tracking-wide">{game.config?.displayName}</h2>
                <p className="text-xs text-zinc-400">{getPhaseLabel(game.phase, game.gameLanguage)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => game.setTtsEnabled(!game.ttsEnabled)}
                className="icon-button"
                aria-pressed={game.ttsEnabled}
                title={displayLanguage === 'zh' ? 'AI语音开关' : 'AI voice on/off'}
                aria-label={displayLanguage === 'zh' ? 'AI语音开关' : 'AI voice on/off'}
              >
                <Power className={`w-4 h-4${game.ttsEnabled ? ' text-emerald-300' : ''}`} />
              </button>
              <input
                type="range" min={0} max={1} step={0.05}
                value={game.audioVolume}
                onChange={e => game.setAudioVolume(Number(e.target.value))}
                className="w-16 h-9 cursor-pointer accent-zinc-200"
                title={displayLanguage === 'zh' ? '音量' : 'Volume'}
                aria-label={displayLanguage === 'zh' ? '音量' : 'Volume'}
              />
              <input
                type="range" min={0.5} max={2} step={0.1}
                value={game.ttsRate}
                onChange={e => game.setTtsRate(Number(e.target.value))}
                className="w-16 h-9 cursor-pointer accent-zinc-200"
                title={displayLanguage === 'zh' ? '语速' : 'Speech rate'}
                aria-label={displayLanguage === 'zh' ? '语速' : 'Speech rate'}
              />
              <button onClick={() => game.setIsMuted(!game.isMuted)} className="icon-button" title={displayLanguage === 'zh' ? '静音/取消静音' : 'Mute / Unmute'} aria-label={displayLanguage === 'zh' ? '静音/取消静音' : 'Mute / Unmute'}>{game.isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}</button>
              <button onClick={() => { game.setPhase(GamePhase.LOBBY); rec.setShowRecords(true); }} className="icon-button" title={displayLanguage === 'zh' ? '返回大厅' : 'Return to lobby'} aria-label={displayLanguage === 'zh' ? '返回大厅' : 'Return to lobby'}><RefreshCw className="w-4 h-4" /></button>
            </div>
          </header>

          {/* Seat stage */}
          <section className="relative flex-1 min-h-0">
            <div className="seat-stage">
              {game.players.map((player, index) => {
                const isHumanWolf = game.me?.role === Role.WEREWOLF && game.me?.isAlive === true;
                const isWolfTeammate = isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF';
                return (
                <div key={player.id} className="absolute" style={seatStyle(index, game.players.length)}>
                  <PlayerCard
                    player={player} isMe={player.id === MY_PLAYER_ID}
                    revealRole={game.phase === GamePhase.GAME_OVER}
                    isSelected={game.selectedPlayerId === player.id}
                    isSpeaking={game.currentSpeaker?.id === player.id}
                    hasSpoken={game.phase === GamePhase.DAY_DISCUSSION && game.spokenPlayerIds.has(player.id)}
                    compact onClick={() => game.setSelectedPlayerId(player.id)}
                    isWolfTeammate={isWolfTeammate}
                    customBadge={
                      game.nightState.wolfKillId === player.id && game.me?.role === Role.WEREWOLF
                        ? <Skull className="w-5 h-5 text-red-300" />
                        : game.aiSeerLastCheck && game.aiSeerLastCheck.targetId === player.id && (game.me?.role === Role.SEER || game.me?.role === Role.WITCH)
                          ? (game.aiSeerLastCheck.isGood
                            ? <span className="bg-emerald-900/80 border border-emerald-500 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">金水</span>
                            : <span className="bg-red-950/80 border border-red-500 text-red-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">查杀</span>)
                          : undefined
                    }
                  />
                </div>
                );
              })}

              {/* Center console */}
              <div className={`center-console${game.winner ? (game.winner === 'WEREWOLVES' ? ' victory-wolves' : ' victory-village') : ''}`}>
                {game.winner ? (
                  <div className={`text-center ${game.winner === 'WEREWOLVES' ? 'game-over-wolves' : 'game-over-village'}`}>
                    <Trophy className="w-10 h-10 mx-auto mb-3 text-zinc-100" />
                    <h1 className="text-3xl font-black">{game.winner === 'WEREWOLVES' ? '狼人胜利' : '好人胜利'}</h1>
                    <p className="text-sm text-zinc-300 mt-2">第{Math.max(1, game.roundCount)}轮结束{game.me ? ` · ${ROLE_LABELS[game.me.role]}` : ''}</p>
                    <p className="text-xs text-zinc-400 mt-2">{game.savedRecordId ? '战绩已记录。' : '正在记录战绩...'}</p>
                    <button onClick={() => { game.setPhase(GamePhase.LOBBY); rec.setShowRecords(true); }} className="mt-5 action-button">返回大厅</button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-xs text-zinc-500">PHASE</div>
                        <div className="text-lg font-bold">{getPhaseLabel(game.phase, game.gameLanguage)}</div>
                      </div>
                      {game.wolfCountdown !== null && (
                        <div className="timer-pill"><Clock3 className="w-4 h-4" />{game.wolfCountdown}s</div>
                      )}
                      {game.voteTimer !== null && (
                        <div className={`timer-pill${game.voteTimer <= 3 ? ' urgent' : ''}`}>
                          <Clock3 className="w-4 h-4" />{game.voteTimer}s
                        </div>
                      )}
                      {game.speechTimer !== null && game.currentSpeaker?.id === MY_PLAYER_ID && (
                        <div className={`timer-pill${game.speechTimer <= 10 ? ' urgent' : ''}`}>
                          <Clock3 className="w-4 h-4" />{game.speechTimer}s
                        </div>
                      )}
                    </div>
                    <p className="mt-4 text-sm text-zinc-300 leading-relaxed min-h-[42px]">{game.phaseHint}</p>
                    <div key={`role-${game.phase}`} className="role-reveal mt-4 rounded border border-zinc-700 bg-black/35 p-3 text-xs text-zinc-300">
                      <div className="flex items-center gap-2 font-bold text-zinc-100">
                        <UserIcon className="w-4 h-4" />
                        你的身份：{game.me ? ROLE_LABELS[game.me.role] : '未知'}
                      </div>
                      <p className="mt-2 text-zinc-400">{game.me ? ROLE_DESCRIPTIONS[game.me.role] : ''}</p>
                      {game.selectedPlayer && <p className="mt-2 text-zinc-300">已选择：{game.selectedPlayer.id}号 {game.selectedPlayer.name}</p>}
                      {game.me?.role === Role.WITCH && game.nightState.wolfKillId && (
                        <p className="mt-2 text-amber-200 text-xs">
                          昨夜 {game.nightState.wolfKillId}号 被狼人袭击
                        </p>
                      )}
                    </div>
                    <ActionBar
                      phase={game.phase} me={game.me} selectedPlayer={game.selectedPlayer}
                      isProcessingAI={game.isProcessingAI} witchStatus={game.witchStatus}
                      nightState={game.nightState}
                      onAction={() => game.selectedPlayerId && game.handlePlayerAction(game.selectedPlayerId)}
                      onVoteSkip={() => game.finishVote(null)}
                      onWitchSave={game.handleWitchSave}
                      onWitchSkip={game.skipWitch}
                    />
                    <SpeechInput
                      value={game.userInput} onChange={game.setUserInput}
                      onSubmit={game.handleHumanSpeechSubmit}
                      visible={game.phase === GamePhase.DAY_DISCUSSION && game.currentSpeaker?.id === MY_PLAYER_ID}
                      selectedPlayer={game.selectedPlayer}
                    />
                  </>
                )}
              </div>
            </div>

            <WolfChannel
              wolfChat={game.wolfChat}
              isVisible={game.me?.role === Role.WEREWOLF && game.phase === GamePhase.NIGHT_WEREWOLVES}
            />
          </section>
        </main>

        {/* Log sidebar */}
        <aside className="bg-zinc-950/88 border-l border-zinc-800 flex flex-col min-h-0">
          <div className="h-16 px-4 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-bold"><ScrollText className="w-4 h-4" />对局日志</div>
            <button onClick={() => rec.setShowRecords(!rec.showRecords)} className="text-xs text-zinc-400 hover:text-white">战绩</button>
          </div>
          {rec.showRecords ? (
            <RecordsPanel records={rec.records} show error={rec.recordError} compact />
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {game.logs.map(log => (
                <div key={log.id} className={`log-entry-in ${log.isSystem ? 'text-center' : log.speakerId === MY_PLAYER_ID ? 'text-right' : 'text-left'}`}>
                  {log.isSystem ? (
                    <span className={`inline-block text-[11px] px-3 py-1 rounded-full border ${log.tone === 'wolf' ? 'border-red-900 bg-red-950/35 text-red-100' : 'border-zinc-800 bg-black/30 text-zinc-400'}`}>
                      <LogMessage log={log} language={displayLanguage} />
                    </span>
                  ) : (
                    <div className={`inline-block max-w-[270px] rounded-lg border p-2 text-xs leading-relaxed ${log.speakerId === MY_PLAYER_ID ? 'bg-zinc-100 text-black border-zinc-200' : 'bg-zinc-900 border-zinc-700 text-zinc-200'}`}>
                      <div className="text-[10px] font-bold opacity-70 mb-1">{log.speakerId === MY_PLAYER_ID ? 'YOU' : `${log.speakerId}号`}</div>
                      <LogMessage log={log} language={displayLanguage} />
                    </div>
                  )}
                </div>
              ))}
              {showVoteSummary && voteRound !== null && (
                <VoteSummary
                  voteRecords={game.voteRecords}
                  players={game.players}
                  round={voteRound}
                  eliminatedPlayerId={voteSummaryEliminatedId}
                />
              )}
              {game.isProcessingAI && (
                <div className="text-xs text-zinc-500 flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> AI正在思考局势...
                </div>
              )}
              <div ref={game.logsEndRef} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );

  // Determine which content view to show inside the shell
  const renderShellContent = () => {
    // GAME phase takes over the full shell content area
    if (game.phase !== GamePhase.LOBBY && game.phase !== GamePhase.LOGIN) {
      return renderGameView();
    }

    // Shell nav views (LOBBY is the default auth state)
    switch (activeView) {
      case 'home':
        return (
          <LobbyHome
            onBuildRoom={() => setActiveView('wolfvillage')}
            onJoinRoom={() => setActiveView('wolfvillage')}
            onSpectate={() => {}}
          />
        );
      case 'friends':
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '60vh', color: 'rgba(255,255,255,0.25)', fontSize: 14, fontWeight: 600,
          }}>
            好友功能即将开放
          </div>
        );
      case 'wolfvillage':
        return (
          <MatchSelection
            onBack={() => setActiveView('home')}
            onSelectBoard={(mode) => {
              game.startGame(mode, displayLanguage);
              rec.setShowRecords(false);
            }}
          />
        );
      case 'shop':
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: '60vh', color: 'rgba(255,255,255,0.25)', fontSize: 14, fontWeight: 600,
          }}>
            商店街即将开放
          </div>
        );
      case 'profile':
        return <ProfileView />;
      default:
        return null;
    }
  };

  return (
    <GlobalShell
      activeView={activeView}
      onNavigate={setActiveView}
      fullscreen={false}
    >
      {renderShellContent()}
    </GlobalShell>
  );
};

export default App;
