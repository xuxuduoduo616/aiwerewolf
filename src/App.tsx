import React, { useState } from 'react';
import { GamePhase, Role } from './types';
import { getPhaseLabel } from './constants';
import useAuth from './hooks/useAuth';
import { useRecords } from './hooks/useRecords';
import { useGameState } from './hooks/useGameState';
import { purchaseUnavailable } from './hooks/useWallet';
import { PlayerCard } from './components/PlayerCard';
import ActionBar from './components/ActionBar';
import RecordsPanel from './components/RecordsPanel';
import WolfChannel from './components/WolfChannel';
import SpeechInput from './components/SpeechInput';
import GameRoom, { GamePlayerSeat } from './components/GameRoom';
import GameLogDialog, { GameLogFeed } from './components/GameLogDialog';
import GlobalShell from './components/GlobalShell';
import type { ShellView } from './components/GlobalShell';
import LobbyHome from './components/LobbyHome';
import ProfileView from './components/ProfileView';
import ShopView, { type ShopSection } from './components/ShopView';
import DailyCheckInView from './components/DailyCheckInView';
import EconomyHistoryView from './components/EconomyHistoryView';
import OnlineQualifierView from './components/OnlineQualifierView';
import OnboardingSpotlight from './components/OnboardingSpotlight';
import StartGameFlow from './components/StartGameFlow';
import UtilityMenu, { type UtilityDestination } from './components/UtilityMenu';
import UtilityView from './components/UtilityView';
import UnavailableNotice from './components/UnavailableNotice';
import LobbyActivityView from './components/LobbyActivityView';
import FactionSupportView from './components/FactionSupportView';
import BattlePassView from './components/BattlePassView';
import WolfVillagePreview from './components/WolfVillagePreview';
import TurnstileWidget from './components/TurnstileWidget';
import { useDisplayLanguage } from './i18n';
import { mapGameSetupToConfig, type GameSetup, type LobbySubview } from './lobbyFeatures';
import { useLobbyFeatures } from './hooks/useLobbyFeatures';
import { useEconomy, type EconomyViewState } from './hooks/useEconomy';
import { SKIN_CATALOG_BY_ID } from './economy/catalog';
import { navigateEconomyRoute, readEconomyRoute, type EconomyRoute } from './economy/routes';
import { getTerminalRewardRequest } from './economy/gameRewards';
import type { SkinStoreFilter } from './components/SkinStore';
import { resolveVoteResult } from './gameEngine';
import { playTick } from './services/speechAudio';
import './styles/game-responsive.css';
import './styles/economy.css';
import {
  Clock3, History, KeyRound, Languages, Loader2,
  LogOut, Mail, Moon, Power, RefreshCw, ScrollText, Shield,
  Skull, Trophy, User as UserIcon, Volume2, VolumeX,
} from 'lucide-react';

/** Cloudflare Turnstile site key, required by the guarded production build. */
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export type TurnstileGuestGateEvent =
  | { type: 'verified'; token: string }
  | { type: 'error' | 'expired' };

export const nextTurnstileToken = (event: TurnstileGuestGateEvent): string | null =>
  event.type === 'verified' ? event.token : null;

export const isTurnstileGuestGateOpen = (token: string | null): boolean => Boolean(token);

const MY_PLAYER_ID = 1;

export const resolveEquippedSkinName = (
  state: Pick<EconomyViewState, 'equippedSkinId' | 'accountCatalog'>,
  isGuest: boolean,
): string | null => {
  if (!state.equippedSkinId) return null;
  if (isGuest) return SKIN_CATALOG_BY_ID.get(state.equippedSkinId)?.name ?? null;
  return state.accountCatalog.find(item => item.id === state.equippedSkinId)?.name
    ?? 'Equipped cosmetic unavailable';
};

const ROLE_LABELS_EN: Record<Role, string> = {
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

const App: React.FC = () => {
  const auth = useAuth();
  const [displayLanguage, toggleDisplayLanguage] = useDisplayLanguage();
  const [activeView, setActiveView] = useState<ShellView>('home');
  const [lobbySubview, setLobbySubview] = useState<LobbySubview>('home');
  const [utilityView, setUtilityView] = useState<'menu' | UtilityDestination | null>(null);
  const [startRequestRevision, setStartRequestRevision] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [isGameInfoOpen, setIsGameInfoOpen] = useState(false);
  const [shopSection, setShopSection] = useState<ShopSection>('skins');
  const [skinStoreFilter, setSkinStoreFilter] = useState<SkinStoreFilter>('all');
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isRouteReady, setIsRouteReady] = useState(false);
  const historyReturnRef = React.useRef<EconomyRoute>({ page: 'lobby' });
  const autoTutorialAttemptedRef = React.useRef(false);
  const rewardedTerminalIdRef = React.useRef<string | null>(null);
  const gameInfoTriggerRef = React.useRef<HTMLButtonElement>(null);
  const utilityTriggerRef = React.useRef<HTMLButtonElement>(null);
  const rec = useRecords(auth.session);
  const economy = useEconomy(auth.session, auth.isGuest);
  const lobbyFeatures = useLobbyFeatures(auth.session?.user.id ?? null);
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
  const startRequestLockedRef = React.useRef(false);
  const pendingStartRef = React.useRef<{ setup: GameSetup; config: NonNullable<ReturnType<typeof mapGameSetupToConfig>> } | null>(null);

  const applyEconomyRoute = React.useCallback((route: EconomyRoute) => {
    setUtilityView(null);
    switch (route.page) {
      case 'lobby':
        setActiveView('home');
        setLobbySubview('home');
        break;
      case 'skin-store':
        setActiveView('shop');
        setShopSection(route.section);
        setSkinStoreFilter(route.season === 'tidal' ? 'tidal' : 'all');
        break;
      case 'online-qualifier':
        setActiveView('home');
        setLobbySubview('online-qualifier');
        break;
      case 'daily-check-in':
        setActiveView('home');
        setLobbySubview('daily-check-in');
        break;
      case 'economy-history':
        setActiveView('home');
        setLobbySubview('economy-history');
        break;
    }
  }, []);

  const navigateEconomy = React.useCallback((route: EconomyRoute) => {
    applyEconomyRoute(route);
    navigateEconomyRoute(route);
  }, [applyEconomyRoute]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const syncRoute = () => {
      applyEconomyRoute(readEconomyRoute());
      setIsRouteReady(true);
    };
    syncRoute();
    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, [applyEconomyRoute]);

  React.useEffect(() => {
    if (
      !auth.isGuest
      || !isRouteReady
      || autoTutorialAttemptedRef.current
      || activeView !== 'home'
      || lobbySubview !== 'home'
      || economy.mode !== 'guest'
      || economy.state.tutorialSeen
    ) return;
    autoTutorialAttemptedRef.current = true;
    setIsTutorialOpen(true);
  }, [activeView, auth.isGuest, economy.mode, economy.state.tutorialSeen, isRouteReady, lobbySubview]);

  React.useEffect(() => {
    const request = getTerminalRewardRequest({
      phase: game.phase,
      winner: game.winner,
      savedRecordId: game.savedRecordId,
      role: game.me?.role ?? null,
      hasConfig: Boolean(game.config),
    });
    if (!request || rewardedTerminalIdRef.current === request.gameId) return;
    rewardedTerminalIdRef.current = request.gameId;
    economy.rewardGame(request.gameId, request.won);
  }, [economy.rewardGame, game.config, game.me?.role, game.phase, game.savedRecordId, game.winner]);

  const displayedCoins = economy.state.coins;
  const displayedCrystals = economy.state.crystals;
  const equippedSkinName = resolveEquippedSkinName(economy.state, auth.isGuest);

  const finishStartRequest = React.useCallback((setup: GameSetup) => {
    const config = mapGameSetupToConfig(setup);
    if (!config || startRequestLockedRef.current) return;

    startRequestLockedRef.current = true;
    pendingStartRef.current = { setup, config };
    if (game.difficulty === setup.difficulty) {
      setStartRequestRevision(revision => revision + 1);
    } else {
      game.setDifficulty(setup.difficulty);
    }
  }, [game.difficulty, game.setDifficulty]);

  React.useEffect(() => {
    const pending = pendingStartRef.current;
    if (!pending || game.difficulty !== pending.setup.difficulty) return;

    pendingStartRef.current = null;
    game.startGame(pending.config, displayLanguage);
    rec.setShowRecords(false);
  }, [displayLanguage, game.difficulty, game.startGame, rec.setShowRecords, startRequestRevision]);

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

  // ── LOGIN ─────────────────────────────────────────────────────────────
  if (auth.isRestoringSession) {
    return (
      <div className="login-page sketch-scene flex font-sans text-zinc-200" aria-busy="true">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto animate-spin text-zinc-400" />
          <p className="mt-3 text-sm text-zinc-500">Restoring your session...</p>
        </div>
      </div>
    );
  }

  if (!auth.isAuthenticated) {
    return (
      <main className="login-page sketch-scene flex font-sans text-zinc-200">
        <div className="auth-panel parchment-border p-8 border border-zinc-600 bg-zinc-950/86 rounded-lg shadow-[0_0_45px_rgba(0,0,0,0.6)]">
          <div className="text-center mb-7">
            <Moon className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <h1 className="login-title text-4xl text-zinc-100 font-bold tracking-wide cinzel">AI WEREWOLF</h1>
            <p className="text-xs text-zinc-400 mt-2">Shadows of the Village</p>
          </div>
          <div className="space-y-3">
            <label className="block text-xs text-zinc-400" htmlFor="auth-email">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
              <input id="auth-email" className="w-full bg-black/70 border border-zinc-700 rounded px-10 py-3 text-white outline-none focus:border-zinc-300" placeholder="you@example.com" value={auth.authEmail} onChange={e => auth.setAuthEmail(e.target.value)} />
            </div>
            <label className="block text-xs text-zinc-400" htmlFor="auth-name">Display Name</label>
            <input id="auth-name" className="w-full bg-black/70 border border-zinc-700 rounded px-4 py-3 text-white outline-none focus:border-zinc-300" placeholder="optional" value={auth.authName} onChange={e => auth.setAuthName(e.target.value)} />
            {auth.authStep === 'VERIFY' && (
              <>
                <label className="block text-xs text-zinc-400" htmlFor="auth-code">Verification Code</label>
                <div className="relative">
                  <KeyRound className="absolute left-3 top-3.5 w-4 h-4 text-zinc-500" />
                  <input id="auth-code" className="w-full bg-black/70 border border-zinc-700 rounded px-10 py-3 text-white outline-none focus:border-zinc-300" placeholder="6-digit email code" value={auth.authCode} onChange={e => auth.setAuthCode(e.target.value)} />
                </div>
              </>
            )}
          </div>
          {auth.authError && <p className="mt-4 text-xs leading-relaxed text-amber-200 bg-amber-950/35 border border-amber-900 rounded p-3">{auth.authError}</p>}

          {/* Cloudflare Turnstile — human verification before login */}
          <div className="turnstile-container mt-4 flex justify-center">
            <TurnstileWidget
              siteKey={TURNSTILE_SITE_KEY}
              onVerify={token => setTurnstileToken(nextTurnstileToken({ type: 'verified', token }))}
              onError={() => setTurnstileToken(nextTurnstileToken({ type: 'error' }))}
              onExpired={() => setTurnstileToken(nextTurnstileToken({ type: 'expired' }))}
            />
          </div>

          <button
            onClick={() => auth.authStep === 'EMAIL'
              ? auth.handleSendOtp()
              : auth.handleVerifyOtp(records => { rec.setRecords(records); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); })}
            disabled={auth.isAuthLoading || !isTurnstileGuestGateOpen(turnstileToken)}
            className="mt-4 w-full bg-zinc-100 text-black py-3 font-bold rounded hover:bg-white transition flex items-center justify-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {auth.isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
            {auth.authStep === 'EMAIL' ? 'SEND EMAIL CODE' : 'VERIFY AND ENTER'}
          </button>
          <div className="flex justify-between mt-4 text-xs text-zinc-400">
            <button onClick={() => auth.setAuthStep(auth.authStep === 'EMAIL' ? 'VERIFY' : 'EMAIL')} className="hover:text-white">Switch Step</button>
            <button
              onClick={() => auth.handleGuest(() => { rec.loadLocalRecords(); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); })}
              disabled={!isTurnstileGuestGateOpen(turnstileToken)}
              className="hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
            >Guest Trial</button>
          </div>
          <p className="mt-5 text-[11px] leading-relaxed text-zinc-500 text-center border-t border-zinc-800 pt-4">
            New players can choose <span className="text-zinc-300">Guest Trial</span> and select Beginner difficulty.
            The AI will guide you through Seer checks, Witch potions, and werewolf night actions.
          </p>
          {!turnstileToken && (
            <p className="mt-2 text-[10px] text-zinc-600 text-center">
              Complete the verification above to start playing.
            </p>
          )}
        </div>
      </main>
    );
  }

  // ── After login, everything renders inside the mobile shell ──────────
  // IMPORTANT: Game view renders full-screen (outside the mobile shell)
  // so it can be responsive on both desktop and mobile. Lobby/shop/profile
  // views remain inside the responsive application shell.
  const isInGame = game.phase !== GamePhase.LOBBY && game.phase !== GamePhase.LOGIN;

  if (isInGame) {
    const returnToLobby = () => {
      startRequestLockedRef.current = false;
      pendingStartRef.current = null;
      setIsGameInfoOpen(false);
      setActiveView('home');
      setLobbySubview('home');
      game.setPhase(GamePhase.LOBBY);
      rec.setShowRecords(true);
      navigateEconomy({ page: 'lobby' });
    };

    const logFeedProps = {
      logs: game.logs,
      language: displayLanguage,
      showVoteSummary,
      voteRound,
      voteRecords: game.voteRecords,
      players: game.players,
      eliminatedPlayerId: voteSummaryEliminatedId,
      isProcessingAI: game.isProcessingAI,
    };

    const gameHeader = (
      <header className="game-room-header px-3 md:px-5 border-b border-zinc-800/80 bg-black/55 backdrop-blur flex items-center justify-between">
        <div className="game-room-phase-summary flex items-center gap-2 md:gap-3">
          <div className="game-round-indicator w-8 h-8 md:w-10 md:h-10 shrink-0 rounded-full bg-zinc-100 text-black flex items-center justify-center font-black text-sm">
            {Math.max(1, game.roundCount)}
          </div>
          <div className="min-w-0">
            <h2 className="text-xs md:text-sm font-bold tracking-wide">{game.config?.name}</h2>
            <p className="text-[10px] md:text-xs text-zinc-400">{getPhaseLabel(game.phase, 'en')}</p>
          </div>
        </div>
        <div className="game-room-audio-controls flex items-center gap-1 md:gap-2">
          <button
            onClick={() => game.setTtsEnabled(!game.ttsEnabled)}
            className="icon-button"
            aria-pressed={game.ttsEnabled}
            title="Toggle AI voice"
            aria-label="Toggle AI voice"
          >
            <Power className={`w-3.5 h-3.5 md:w-4 md:h-4${game.ttsEnabled ? ' text-emerald-300' : ''}`} />
          </button>
          <input
            type="range" min={0} max={1} step={0.05}
            value={game.audioVolume}
            onChange={e => game.setAudioVolume(Number(e.target.value))}
            className="game-audio-slider w-10 md:w-16 cursor-pointer accent-zinc-200"
            title="Volume"
            aria-label="Volume"
          />
          <input
            type="range" min={0.5} max={2} step={0.1}
            value={game.ttsRate}
            onChange={e => game.setTtsRate(Number(e.target.value))}
            className="game-audio-slider w-10 md:w-16 cursor-pointer accent-zinc-200"
            title="Speech rate"
            aria-label="Speech rate"
          />
          <button onClick={() => game.setIsMuted(!game.isMuted)} className="icon-button" title="Mute or unmute" aria-label="Mute or unmute">
            {game.isMuted ? <VolumeX className="w-3.5 h-3.5 md:w-4 md:h-4" /> : <Volume2 className="w-3.5 h-3.5 md:w-4 md:h-4" />}
          </button>
          <button
            ref={gameInfoTriggerRef}
            type="button"
            onClick={() => setIsGameInfoOpen(true)}
            className="game-log-trigger icon-button"
            title="Game log and records"
            aria-label="Open game log and records"
            aria-haspopup="dialog"
          >
            <ScrollText className="w-4 h-4" />
          </button>
          <button onClick={returnToLobby} className="icon-button" title="Return to lobby" aria-label="Return to lobby">
            <RefreshCw className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
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
          <RecordsPanel records={rec.records} show error={rec.recordError} compact />
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
        >
          <div className="seat-stage">
            {game.players.map((player, index) => {
              const isHumanWolf = game.me?.role === Role.WEREWOLF && game.me?.isAlive === true;
              const isWolfTeammate = isHumanWolf && player.id !== MY_PLAYER_ID && player.camp === 'WEREWOLF';
              return (
                <GamePlayerSeat key={player.id} desktopStyle={seatStyle(index, game.players.length)}>
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
                            ? <span className="bg-emerald-900/80 border border-emerald-500 text-emerald-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">Known Good</span>
                            : <span className="bg-red-950/80 border border-red-500 text-red-200 text-[10px] px-1.5 py-0.5 rounded-full font-bold">Confirmed Wolf</span>)
                          : undefined
                    }
                  />
                </GamePlayerSeat>
              );
            })}

            <div className={`center-console game-action-console${game.winner ? (game.winner === 'WEREWOLVES' ? ' victory-wolves' : ' victory-village') : ''}`}>
              {game.winner ? (
                <div className={`text-center ${game.winner === 'WEREWOLVES' ? 'game-over-wolves' : 'game-over-village'}`}>
                  <Trophy className="w-10 h-10 mx-auto mb-3 text-zinc-100" />
                  <h1 className="text-3xl font-black">{game.winner === 'WEREWOLVES' ? 'Werewolves Win' : 'Village Wins'}</h1>
                  <p className="text-sm text-zinc-300 mt-2">Round {Math.max(1, game.roundCount)} complete{game.me ? ` · ${ROLE_LABELS_EN[game.me.role]}` : ''}</p>
                  <p className="text-xs text-zinc-400 mt-2">{game.savedRecordId ? 'Record saved.' : 'Saving record...'}</p>
                  <button onClick={returnToLobby} className="mt-5 action-button game-return-button">Return to Lobby</button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs text-zinc-500">PHASE</div>
                      <div className="text-lg font-bold">{getPhaseLabel(game.phase, 'en')}</div>
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
                      Your role: {game.me ? ROLE_LABELS_EN[game.me.role] : 'Unknown'}
                    </div>
                    <p className="mt-2 text-zinc-400">{game.me ? ROLE_DESCRIPTIONS_EN[game.me.role] : ''}</p>
                    {game.selectedPlayer && <p className="mt-2 text-zinc-300">Selected: Player {game.selectedPlayer.id} <span data-ui-copy-category="USER_AUTHORED" data-ui-copy-allow="USER_APP_SELECTED_PLAYER">{game.selectedPlayer.name}</span></p>}
                    {game.me?.role === Role.WITCH && game.nightState.wolfKillId && (
                      <p className="mt-2 text-amber-200 text-xs">
                        Player {game.nightState.wolfKillId} was attacked by the werewolves last night.
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
        </GameRoom>

        <GameLogDialog
          open={isGameInfoOpen}
          onClose={() => setIsGameInfoOpen(false)}
          returnFocusRef={gameInfoTriggerRef}
          records={rec.records}
          recordError={rec.recordError}
          {...logFeedProps}
        />
        {economy.feedback && (
          <p className="economy-global-feedback economy-global-feedback--game" role="status" aria-live="polite">
            {economy.feedback}
          </p>
        )}
      </>
    );
  }

  // Determine which content view to show inside the shell
  const navigateShell = (view: ShellView) => {
    setUtilityView(null);
    if (view === 'home') {
      navigateEconomy({ page: 'lobby' });
      return;
    }
    if (view === 'shop') {
      navigateEconomy({ page: 'skin-store', season: 'all', section: 'skins' });
      return;
    }
    if (typeof window !== 'undefined' && window.location.hash) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    setActiveView(view);
  };

  const closeUtilityMenu = () => {
    setUtilityView(null);
    requestAnimationFrame(() => utilityTriggerRef.current?.focus());
  };

  const renderLobbyContent = () => {
    switch (lobbySubview) {
      case 'home':
        return (
          <LobbyHome
            onStartGame={() => setLobbySubview('mode-choice')}
            onOpenSubview={setLobbySubview}
            onOpenUtilityMenu={() => setUtilityView('menu')}
            onNavigate={navigateShell}
            onOpenTidalStore={() => navigateEconomy({ page: 'skin-store', season: 'tidal', section: 'skins' })}
            onOpenQualifier={() => navigateEconomy({ page: 'online-qualifier' })}
            onOpenDailyCheckIn={() => navigateEconomy({ page: 'daily-check-in' })}
            onOpenTutorial={() => setIsTutorialOpen(true)}
            equippedSkinName={equippedSkinName}
          />
        );
      case 'mode-choice':
      case 'match-setup':
        return (
          <StartGameFlow
            initialStep={lobbySubview}
            onSubviewChange={setLobbySubview}
            onBackToLobby={() => setLobbySubview('home')}
            onConfirm={finishStartRequest}
          />
        );
      case 'activity':
        return (
          <LobbyActivityView
            claimedActivityIds={lobbyFeatures.state.claimedActivityIds}
            onClaimActivity={lobbyFeatures.claimActivity}
            onBack={() => setLobbySubview('home')}
          />
        );
      case 'faction-support':
        return (
          <FactionSupportView
            contributions={lobbyFeatures.state.factionContributions}
            onContribute={lobbyFeatures.contributeToFaction}
            onBack={() => setLobbySubview('home')}
          />
        );
      case 'battle-pass':
        return (
          <BattlePassView
            claimedTierIds={lobbyFeatures.state.claimedBattlePassTierIds}
            onClaimTier={lobbyFeatures.claimBattlePassTier}
            onClaimEligibleTiers={lobbyFeatures.claimEligibleBattlePassTiers}
            onBack={() => setLobbySubview('home')}
          />
        );
      case 'online-qualifier':
        return <OnlineQualifierView onBack={() => navigateEconomy({ page: 'lobby' })} />;
      case 'daily-check-in':
        return (
          <DailyCheckInView
            state={economy.state}
            coins={displayedCoins}
            crystals={displayedCrystals}
            isGuest={auth.isGuest}
            ledgerCorrupt={economy.ledgerCorrupt}
            phase={economy.phase}
            pendingAction={economy.pendingAction}
            mutationsDisabled={economy.mutationsDisabled}
            statusMessage={economy.statusMessage}
            feedback={economy.feedback}
            onCheckIn={economy.checkIn}
            onRefresh={economy.refresh}
            onOpenHistory={() => {
              historyReturnRef.current = { page: 'daily-check-in' };
              navigateEconomy({ page: 'economy-history' });
            }}
            onBack={() => navigateEconomy({ page: 'lobby' })}
          />
        );
      case 'economy-history':
        return (
          <EconomyHistoryView
            events={economy.state.guestEvents}
            accountLedger={economy.state.accountLedger}
            isGuest={auth.isGuest}
            phase={economy.phase}
            statusMessage={economy.statusMessage}
            feedback={economy.feedback}
            nextCursor={economy.state.nextCursor}
            loadingMore={economy.loadingMore}
            onLoadMore={economy.loadMore}
            onRefresh={economy.refresh}
            onBack={() => navigateEconomy(historyReturnRef.current)}
          />
        );
      default:
        return null;
    }
  };

  const renderShellContent = () => {
    // Game views are rendered OUTSIDE the shell (full-screen) — see isInGame above.
    // Lobby/shop/profile views remain inside the application shell.

    if (utilityView === 'menu') {
      return <UtilityMenu onSelect={setUtilityView} onBack={closeUtilityMenu} />;
    }
    if (utilityView) {
      return (
        <UtilityView
          destination={utilityView}
          displayLanguage={displayLanguage}
          onToggleLanguage={toggleDisplayLanguage}
          onBack={() => setUtilityView('menu')}
        />
      );
    }

    switch (activeView) {
      case 'home':
        return renderLobbyContent();
      case 'friends':
        return (
          <UnavailableNotice
            title="Friends"
            description="Friends and messaging are a preview of the social roadmap. This page does not connect to live social services."
            onBack={() => navigateShell('home')}
          />
        );
      case 'wolfvillage':
        return <WolfVillagePreview onBack={() => navigateShell('home')} />;
      case 'shop':
        return (
          <ShopView
            section={shopSection}
            onSectionChange={section => navigateEconomy({
              page: 'skin-store',
              season: section === 'skins' && skinStoreFilter === 'tidal' ? 'tidal' : 'all',
              section,
            })}
            skinFilter={skinStoreFilter}
            onSkinFilterChange={filter => {
              setSkinStoreFilter(filter);
              navigateEconomyRoute({
                page: 'skin-store',
                season: filter === 'tidal' ? 'tidal' : 'all',
                section: 'skins',
              });
            }}
            economyState={economy.state}
            coins={displayedCoins}
            crystals={displayedCrystals}
            legacyCoupons={0}
            isGuest={auth.isGuest}
            ledgerCorrupt={economy.ledgerCorrupt}
            phase={economy.phase}
            statusMessage={economy.statusMessage}
            pendingAction={economy.pendingAction}
            mutationsDisabled={economy.mutationsDisabled}
            feedback={economy.feedback}
            onUnlock={economy.unlockSkin}
            onEquip={economy.equipSkin}
            onRefresh={economy.refresh}
            onOpenHistory={() => {
              historyReturnRef.current = {
                page: 'skin-store',
                season: skinStoreFilter === 'tidal' ? 'tidal' : 'all',
                section: shopSection,
              };
              navigateEconomy({ page: 'economy-history' });
            }}
            onPurchase={async (packId) => {
              const result = await purchaseUnavailable(packId);
              return { success: result.success, error: result.error };
            }}
          />
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
      onNavigate={navigateShell}
      onOpenUtilityMenu={() => setUtilityView('menu')}
      utilityTriggerRef={utilityTriggerRef}
      fullscreen={false}
      coins={displayedCoins}
      coupons={0}
      crystals={displayedCrystals}
    >
      {renderShellContent()}
      <OnboardingSpotlight
        open={isTutorialOpen}
        onSkip={() => {
          economy.skipTutorial();
          setIsTutorialOpen(false);
        }}
        onFinish={() => {
          economy.finishTutorial();
          setIsTutorialOpen(false);
        }}
      />
      {economy.feedback && activeView === 'home' && lobbySubview === 'home' && (
        <p className="economy-global-feedback" role="status" aria-live="polite">
          {economy.feedback}
        </p>
      )}
    </GlobalShell>
  );
};

export default App;
