import type { AIExpressionModel } from './ai/modelCatalog';
import React, { Suspense, useState } from 'react';
import { GamePhase } from './types';
import useAuth from './hooks/useAuth';
import { useRecords } from './hooks/useRecords';
import { useGameState } from './hooks/useGameState';
import { purchaseUnavailable } from './hooks/useWallet';
import GlobalShell from './components/GlobalShell';
import type { ShellView } from './components/GlobalShell';
import LobbyHome from './components/LobbyHome';
import type { ShopSection } from './components/ShopView';
import StartGameFlow from './components/StartGameFlow';
import type { UtilityDestination } from './components/UtilityMenu';
import UnavailableNotice from './components/UnavailableNotice';
import LoginView from './components/LoginView';
import ScreenFallback, { ScreenCurtain } from './components/ScreenFallback';
import { useDisplayLanguage } from './i18n';
import { mapGameSetupToConfig, type GameSetup, type LobbySubview } from './lobbyFeatures';
import { useLobbyFeatures } from './hooks/useLobbyFeatures';
import { useEconomy, type EconomyViewState } from './hooks/useEconomy';
import { SKIN_CATALOG_BY_ID } from './economy/catalog';
import { useEquippedSkinProduct } from './economy/equippedSkin';
import { navigateEconomyRoute, readEconomyRoute, type EconomyRoute } from './economy/routes';
import { getTerminalRewardRequest } from './economy/gameRewards';
import type { SkinStoreFilter } from './components/SkinStore';
import { setAIExpressionModel } from './ai/aiOrchestrator';
import './styles/game-responsive.css';
import './styles/economy.css';
import './styles/transitions.css';
import { Loader2 } from 'lucide-react';

// Everything below is off the first-screen path (login / lobby home) and is
// fetched on demand. The game room is prefetched as soon as the player opens
// the start flow so the match ceremony never waits on it.
const loadGameScreen = () => import('./screens/GameScreen');
const GameScreen = React.lazy(loadGameScreen);
const ShopView = React.lazy(() => import('./components/ShopView'));
const ProfileView = React.lazy(() => import('./components/ProfileView'));
const DailyCheckInView = React.lazy(() => import('./components/DailyCheckInView'));
const EconomyHistoryView = React.lazy(() => import('./components/EconomyHistoryView'));
const OnlineQualifierView = React.lazy(() => import('./components/OnlineQualifierView'));
const LobbyActivityView = React.lazy(() => import('./components/LobbyActivityView'));
const FactionSupportView = React.lazy(() => import('./components/FactionSupportView'));
const BattlePassView = React.lazy(() => import('./components/BattlePassView'));
const WolfVillagePreview = React.lazy(() => import('./components/WolfVillagePreview'));
const UtilityMenu = React.lazy(() => import('./components/UtilityMenu'));
const UtilityView = React.lazy(() => import('./components/UtilityView'));
const OnboardingStageSpotlight = React.lazy(() => import('./components/OnboardingStageSpotlight'));

/** Keeps StartGameFlow mounted across its two internal steps. */
export const shellViewKey = (
  utilityView: string | null,
  activeView: string,
  lobbySubview: LobbySubview,
): string => {
  if (utilityView) return `utility:${utilityView}`;
  if (activeView !== 'home') return activeView;
  return lobbySubview === 'mode-choice' || lobbySubview === 'match-setup' ? 'home:start' : `home:${lobbySubview}`;
};

export type TurnstileGuestGateEvent =
  | { type: 'verified'; token: string }
  | { type: 'error' | 'expired' };

export const nextTurnstileToken = (event: TurnstileGuestGateEvent): string | null =>
  event.type === 'verified' ? event.token : null;

export const isTurnstileGuestGateOpen = (token: string | null): boolean => Boolean(token);

type AuthInputField = 'email' | 'username' | 'nickname' | 'code' | 'password';

export const authFieldDescribedBy = (
  field: AuthInputField,
  errorField: AuthInputField | null,
  helpId?: string,
): string | undefined => {
  const descriptionIds = [helpId, errorField === field ? 'auth-error' : undefined]
    .filter((value): value is string => Boolean(value));
  return descriptionIds.length > 0 ? descriptionIds.join(' ') : undefined;
};

export const resolveEquippedSkinName = (
  state: Pick<EconomyViewState, 'equippedSkinId' | 'accountCatalog'>,
  isGuest: boolean,
): string | null => {
  if (!state.equippedSkinId) return null;
  if (isGuest) return SKIN_CATALOG_BY_ID.get(state.equippedSkinId)?.name ?? null;
  return state.accountCatalog.find(item => item.id === state.equippedSkinId)?.name
    ?? 'Equipped cosmetic unavailable';
};

const App: React.FC = () => {
  const auth = useAuth();
  const [displayLanguage, toggleDisplayLanguage] = useDisplayLanguage();
  const [activeView, setActiveView] = useState<ShellView>('home');
  const [lobbySubview, setLobbySubview] = useState<LobbySubview>('home');
  const [utilityView, setUtilityView] = useState<'menu' | UtilityDestination | null>(null);
  const [startRequestRevision, setStartRequestRevision] = useState(0);
  const [shopSection, setShopSection] = useState<ShopSection>('skins');
  const [skinStoreFilter, setSkinStoreFilter] = useState<SkinStoreFilter>('all');
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [tutorialStage, setTutorialStage] = useState<'lobby' | 'single-player' | 'match-setup'>('lobby');
  const fullGuideRef = React.useRef(false);
  const setupGuidePrincipalRef = React.useRef<string | null>(null);
  const startGuideSeenRef = React.useRef(new Set<string>());
  const gameControlsSeenRef = React.useRef(new Set<string>());
  const [isRouteReady, setIsRouteReady] = useState(false);
  const historyReturnRef = React.useRef<EconomyRoute>({ page: 'lobby' });
  const autoTutorialAttemptedRef = React.useRef(false);
  const rewardedTerminalIdRef = React.useRef<string | null>(null);
  const leaveRequestLockedRef = React.useRef(false);
  const utilityTriggerRef = React.useRef<HTMLButtonElement>(null);
  const guestPrincipalId = auth.guestIdentity?.id ?? null;
  const principalId = auth.isGuest ? guestPrincipalId : auth.session?.user.id ?? null;
  const publicName = auth.isGuest
    ? auth.guestIdentity?.label ?? ''
    : auth.profile?.nickname ?? auth.profile?.username ?? '';
  const publicHandle = auth.isGuest
    ? auth.guestIdentity
      ? `${auth.guestIdentity.id}${auth.guestIdentity.persistent ? '' : ' · This tab only'}`
      : ''
    : auth.profile ? `@${auth.profile.username}` : '';
  const rec = useRecords(auth.session, guestPrincipalId);
  const economy = useEconomy(auth.session, auth.isGuest, {}, guestPrincipalId);
  const lobbyFeatures = useLobbyFeatures(principalId);
  const game = useGameState({
    session: auth.session,
    isGuest: auth.isGuest,
    profile: auth.profile,
    authEmail: auth.authEmail,
    guestPrincipalId,
    publicName,
    records: rec.records,
    setRecords: rec.setRecords,
    recordError: rec.recordError,
    setRecordError: rec.setRecordError,
  });
  const startRequestLockedRef = React.useRef(false);
  const pendingStartRef = React.useRef<{ setup: GameSetup; models: readonly AIExpressionModel[]; config: NonNullable<ReturnType<typeof mapGameSetupToConfig>> } | null>(null);

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
    fullGuideRef.current = true;
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
  const equippedSkinProduct = useEquippedSkinProduct(economy, auth.isGuest ? guestPrincipalId : auth.session?.user.id ?? null);

  const openStartGame = () => {
    void loadGameScreen();
    setLobbySubview('mode-choice');
    if (!principalId) return;
    const key = `aiwerewolf:first-start-guide:v1:${principalId}`;
    let seen = startGuideSeenRef.current.has(principalId);
    try { seen ||= window.localStorage.getItem(key) === 'seen'; } catch { /* This tab still deduplicates. */ }
    if (seen && !fullGuideRef.current) return;
    startGuideSeenRef.current.add(principalId);
    try { window.localStorage.setItem(key, 'seen'); } catch { /* Storage is optional. */ }
    setupGuidePrincipalRef.current = principalId;
    setTutorialStage('single-player');
    setIsTutorialOpen(true);
  };

  const changeStartSubview = (subview: LobbySubview) => {
    setLobbySubview(subview);
    if (subview === 'match-setup' && setupGuidePrincipalRef.current === principalId && principalId) {
      setupGuidePrincipalRef.current = null;
      setTutorialStage('match-setup');
      setIsTutorialOpen(true);
    }
  };

  const finishStartRequest = React.useCallback((setup: GameSetup, models: readonly AIExpressionModel[] = []) => {
    const config = mapGameSetupToConfig(setup);
    if (!config || startRequestLockedRef.current) return;

    startRequestLockedRef.current = true;
    leaveRequestLockedRef.current = false;
    pendingStartRef.current = { setup, config, models: [...models] };
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
    setAIExpressionModel(pending.setup.expressionModel, pending.setup.difficulty);
    game.startGame(pending.config, displayLanguage, {
      selection: pending.setup.expressionModel,
      models: pending.models,
      holdForIntro: true,
    });
    rec.setShowRecords(false);
  }, [displayLanguage, game.difficulty, game.startGame, rec.setShowRecords, startRequestRevision]);

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
      <>
        <LoginView auth={auth}
          onReady={records => { rec.setRecords(records); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); }}
          onGuest={() => auth.handleGuest(identity => { rec.loadLocalRecords(identity.id); rec.setShowRecords(true); game.setPhase(GamePhase.LOBBY); })}
        />
        <ScreenCurtain />
      </>
    );
  }

  // ── After login, everything renders inside the mobile shell ──────────
  // IMPORTANT: Game view renders full-screen (outside the mobile shell)
  // so it can be responsive on both desktop and mobile. Lobby/shop/profile
  // views remain inside the responsive application shell.
  const isInGame = game.phase !== GamePhase.LOBBY && game.phase !== GamePhase.LOGIN;

  if (isInGame) {
    const returnToLobby = () => {
      if (leaveRequestLockedRef.current) return;
      leaveRequestLockedRef.current = true;
      startRequestLockedRef.current = false;
      pendingStartRef.current = null;
      setActiveView('home');
      setLobbySubview('home');
      game.leaveGame();
      rec.setShowRecords(true);
      navigateEconomy({ page: 'lobby' });
    };

    return (
      <Suspense fallback={<ScreenFallback label="Preparing the village..." />}>
        <GameScreen
          game={game}
          rec={rec}
          isGuest={auth.isGuest}
          principalId={principalId}
          displayLanguage={displayLanguage}
          equippedSkinProduct={equippedSkinProduct}
          economyFeedback={economy.feedback}
          gameControlsSeen={gameControlsSeenRef.current}
          onReturnToLobby={returnToLobby}
        />
      </Suspense>
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
            onStartGame={openStartGame}
            onOpenSubview={setLobbySubview}
            onOpenUtilityMenu={() => setUtilityView('menu')}
            onNavigate={navigateShell}
            onOpenTidalStore={() => navigateEconomy({ page: 'skin-store', season: 'tidal', section: 'skins' })}
            onOpenQualifier={() => navigateEconomy({ page: 'online-qualifier' })}
            onOpenDailyCheckIn={() => navigateEconomy({ page: 'daily-check-in' })}
            onOpenTutorial={() => { fullGuideRef.current = true; setTutorialStage('lobby'); setIsTutorialOpen(true); }}
            equippedSkinName={equippedSkinName}
            equippedSkin={equippedSkinProduct}
            identityName={publicName}
            identityHandle={publicHandle}
            isGuest={auth.isGuest}
            onSignIn={() => {
              auth.leaveGuestForAuth();
              game.setPhase(GamePhase.LOGIN);
            }}
          />
        );
      case 'mode-choice':
      case 'match-setup':
        return (
          <StartGameFlow
            initialStep={lobbySubview}
            onSubviewChange={changeStartSubview}
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
        return (
          <ProfileView
            economy={economy}
            onOpenStore={() => navigateEconomy({ page: 'skin-store', season: 'all', section: 'skins' })}
            identityName={publicName}
            identityHandle={publicHandle}
            isGuest={auth.isGuest}
            onSignIn={() => {
              auth.leaveGuestForAuth();
              game.setPhase(GamePhase.LOGIN);
              setActiveView('home');
              setLobbySubview('home');
            }}
            onSignOut={() => {
              auth.logoutAuth();
              rec.setRecords([]);
              game.setPhase(GamePhase.LOGIN);
              setActiveView('home');
              setLobbySubview('home');
            }}
          />
        );
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
      <Suspense fallback={<ScreenFallback inline />}>
        <div key={shellViewKey(utilityView, activeView, lobbySubview)} className="view-swap">
          {renderShellContent()}
        </div>
      </Suspense>
      {isTutorialOpen && (
        <Suspense fallback={null}>
          <OnboardingStageSpotlight
            key={`${principalId}:${tutorialStage}`}
            stage={tutorialStage}
            open={isTutorialOpen}
            onSkip={() => {
              if (fullGuideRef.current) economy.skipTutorial();
              fullGuideRef.current = false;
              setIsTutorialOpen(false);
            }}
            onFinish={() => {
              if (tutorialStage === 'match-setup' && fullGuideRef.current) {
                economy.finishTutorial();
                fullGuideRef.current = false;
              }
              setIsTutorialOpen(false);
            }}
          />
        </Suspense>
      )}
      <ScreenCurtain />
      {economy.feedback && activeView === 'home' && lobbySubview === 'home' && (
        <p className="economy-global-feedback" role="status" aria-live="polite">
          {economy.feedback}
        </p>
      )}
    </GlobalShell>
  );
};

export default App;
