import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseSession } from '../types';
import {
  AccountEconomyRequestError,
  accountErrorPhase,
  accountScope,
  clearAccountIntent,
  createEmptyAccountEconomyState,
  DEFAULT_ACCOUNT_LEDGER_LIMIT,
  getAccountEconomyState,
  getOrCreateAccountIntent,
  intentFingerprint,
  mergeAccountLedgerPage,
  postAccountEconomyMutation,
  readAccountIntents,
  reconcileConfirmedAccountIntents,
  stateConfirmsIntent,
  type AccountEconomyPhase,
  type AccountEconomyState,
  type AccountIntent,
  type AccountMutationAction,
} from '../economy/accountEconomy';

const REQUEST_TIMEOUT_MS = 10_000;

interface Snapshot {
  marker: string;
  phase: AccountEconomyPhase;
  state: AccountEconomyState;
  feedback: string;
  pendingAction: AccountMutationAction | null;
  loadingMore: boolean;
  intentStatus: 'valid' | 'missing' | 'corrupt' | 'unavailable';
}

export interface UseAccountEconomyOptions {
  fetchImpl?: typeof fetch;
  storage?: Storage | null;
  timeoutMs?: number;
}

export interface UseAccountEconomyResult {
  phase: AccountEconomyPhase;
  state: AccountEconomyState;
  feedback: string;
  statusMessage: string;
  pendingAction: AccountMutationAction | null;
  loadingMore: boolean;
  mutationsDisabled: boolean;
  refresh: () => Promise<boolean>;
  loadMore: () => Promise<boolean>;
  checkIn: () => Promise<boolean>;
  skipTutorial: () => void;
  finishTutorial: () => Promise<boolean>;
  rewardGame: () => false;
  unlockSkin: (skinId: string) => Promise<boolean>;
  equipSkin: (skinId: string) => Promise<boolean>;
  clearFeedback: () => void;
}

const markerForSession = (session: SupabaseSession | null): string => {
  if (!session?.user.id || !session.accessToken) return '';
  // The marker is process-local and intentionally irreversible; token/user data
  // never enters storage, URLs, messages or DOM.
  return accountScope(`${session.user.id}:${session.accessToken}`);
};

const emptySnapshot = (marker: string, phase: AccountEconomyPhase): Snapshot => ({
  marker,
  phase,
  state: createEmptyAccountEconomyState(),
  feedback: '',
  pendingAction: null,
  loadingMore: false,
  intentStatus: 'missing',
});

const statusForPhase = (phase: AccountEconomyPhase): string => {
  switch (phase) {
    case 'inactive': return 'Sign in to load account economy.';
    case 'loading': return 'Loading verified account economy...';
    case 'ready': return '';
    case 'reauthenticate': return 'Your account session must be verified again.';
    case 'corrupt': return 'Account economy data could not be verified. A safe empty view is shown.';
    case 'unverified': return 'The latest account state is unverified. Refresh before another change.';
    case 'unavailable': return 'Account economy is currently unavailable. No account assets were changed.';
  }
};

const feedbackForError = (error: unknown): string => {
  if (!(error instanceof AccountEconomyRequestError)) {
    return 'Account economy request failed. No account assets were changed.';
  }
  const messages: Record<string, string> = {
    ALREADY_CLAIMED: 'This reward was already claimed. Refreshing verified account state.',
    INSUFFICIENT_BALANCE: 'Insufficient account balance. Nothing was changed.',
    ALREADY_OWNED: 'This cosmetic is already owned.',
    NOT_OWNED: 'This cosmetic is not owned. Nothing was changed.',
    NOT_FOUND: 'This account economy item was not found.',
    IDEMPOTENCY_CONFLICT: 'This saved request conflicts with another action. Nothing was changed.',
    DAILY_LIMIT_REACHED: 'The account daily reward limit was reached.',
    GAMEPLAY_REWARD_UNAVAILABLE: 'Account match rewards are unavailable until a trusted server eligibility writer exists.',
  };
  return messages[error.code] ?? statusForPhase(accountErrorPhase(error));
};

const isAbort = (error: unknown): boolean => (
  error instanceof DOMException ? error.name === 'AbortError' : (
    error instanceof Error && error.name === 'AbortError'
  )
);

export const useAccountEconomy = (
  session: SupabaseSession | null,
  options: UseAccountEconomyOptions = {},
): UseAccountEconomyResult => {
  const marker = markerForSession(session);
  const scope = session?.user.id ? accountScope(session.user.id) : '';
  const storage = options.storage === undefined
    ? (typeof localStorage === 'undefined' ? null : localStorage)
    : options.storage;
  const [snapshot, setSnapshot] = useState<Snapshot>(() => emptySnapshot(marker, marker ? 'loading' : 'inactive'));
  const generationRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const mutationRef = useRef<Promise<boolean> | null>(null);
  const seenCursorRef = useRef<{ marker: string; values: Set<string> }>({ marker, values: new Set() });

  const visible = snapshot.marker === marker
    ? snapshot
    : emptySnapshot(marker, marker ? 'loading' : 'inactive');

  const runGet = useCallback(async (
    currentSession: SupabaseSession,
    currentMarker: string,
    generation: number,
    cursor: string | null = null,
    priorState: AccountEconomyState | null = null,
    seenCursors: ReadonlySet<string> = new Set(),
  ): Promise<AccountEconomyState> => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
    try {
      const page = await getAccountEconomyState({
        accessToken: currentSession.accessToken,
        signal: controller.signal,
        fetchImpl: options.fetchImpl,
      }, DEFAULT_ACCOUNT_LEDGER_LIMIT, cursor);
      if (generationRef.current !== generation || markerForSession(currentSession) !== currentMarker) {
        throw new DOMException('Stale account economy response', 'AbortError');
      }
      if (cursor && priorState) {
        const merged = mergeAccountLedgerPage(priorState, page, cursor, seenCursors);
        if (!merged) throw new AccountEconomyRequestError(null, 'ECONOMY_RESPONSE_INVALID');
        return merged;
      }
      return page;
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [options.fetchImpl, options.timeoutMs]);

  const applyVerifiedState = useCallback((
    currentMarker: string,
    currentScope: string,
    state: AccountEconomyState,
    feedback = '',
    resetCursors = true,
  ): boolean => {
    const reconciled = reconcileConfirmedAccountIntents(currentScope, state, storage);
    if (!reconciled) {
      setSnapshot({
        ...emptySnapshot(currentMarker, 'corrupt'),
        feedback: 'Saved account request state could not be verified. Mutations are disabled.',
        intentStatus: 'corrupt',
      });
      return false;
    }
    const intentRead = readAccountIntents(storage);
    if (resetCursors || seenCursorRef.current.marker !== currentMarker) {
      seenCursorRef.current = {
        marker: currentMarker,
        values: new Set(state.nextCursor ? [state.nextCursor] : []),
      };
    } else if (state.nextCursor) {
      seenCursorRef.current.values.add(state.nextCursor);
    }
    setSnapshot({
      marker: currentMarker,
      phase: 'ready',
      state,
      feedback,
      pendingAction: null,
      loadingMore: false,
      intentStatus: storage === null ? 'unavailable' : intentRead.status,
    });
    return true;
  }, [storage]);

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!session || !marker || !scope) return false;
    const generation = generationRef.current;
    setSnapshot(current => current.marker === marker
      ? { ...current, phase: 'loading', state: createEmptyAccountEconomyState(), feedback: '' }
      : emptySnapshot(marker, 'loading'));
    try {
      const state = await runGet(session, marker, generation);
      return applyVerifiedState(marker, scope, state);
    } catch (error) {
      if (generationRef.current !== generation) return false;
      const phase = isAbort(error) ? 'unavailable' : accountErrorPhase(error);
      setSnapshot({ ...emptySnapshot(marker, phase), feedback: statusForPhase(phase) });
      return false;
    }
  }, [applyVerifiedState, marker, runGet, scope, session]);

  useEffect(() => {
    generationRef.current += 1;
    const generation = generationRef.current;
    requestRef.current?.abort();
    mutationRef.current = null;
    seenCursorRef.current = { marker, values: new Set() };
    if (!session || !marker || !scope) {
      setSnapshot(emptySnapshot('', 'inactive'));
      return undefined;
    }
    const intentRead = readAccountIntents(storage);
    if (intentRead.status === 'corrupt') {
      setSnapshot({
        ...emptySnapshot(marker, 'corrupt'),
        feedback: 'Saved account request state could not be verified. Mutations are disabled.',
        intentStatus: 'corrupt',
      });
      return undefined;
    }
    setSnapshot({ ...emptySnapshot(marker, 'loading'), intentStatus: storage ? intentRead.status : 'unavailable' });
    void runGet(session, marker, generation)
      .then(state => applyVerifiedState(marker, scope, state))
      .catch(error => {
        if (generationRef.current !== generation) return;
        const phase = isAbort(error) ? 'unavailable' : accountErrorPhase(error);
        setSnapshot({ ...emptySnapshot(marker, phase), feedback: statusForPhase(phase) });
      });
    return () => requestRef.current?.abort();
  }, [applyVerifiedState, marker, runGet, scope, session, storage]);

  const loadMore = useCallback(async (): Promise<boolean> => {
    if (!session || visible.phase !== 'ready' || !visible.state.nextCursor || visible.loadingMore) return false;
    const generation = generationRef.current;
    const cursor = visible.state.nextCursor;
    setSnapshot(current => current.marker === marker ? { ...current, loadingMore: true, feedback: '' } : current);
    try {
      const state = await runGet(
        session,
        marker,
        generation,
        cursor,
        visible.state,
        seenCursorRef.current.marker === marker ? seenCursorRef.current.values : new Set(),
      );
      return applyVerifiedState(marker, scope, state, '', false);
    } catch (error) {
      if (generationRef.current !== generation) return false;
      const phase = isAbort(error) ? 'unavailable' : accountErrorPhase(error);
      setSnapshot({ ...emptySnapshot(marker, phase), feedback: statusForPhase(phase) });
      return false;
    }
  }, [applyVerifiedState, marker, runGet, scope, session, visible]);

  const mutate = useCallback((
    action: AccountMutationAction,
    value: string,
    successFeedback: string,
  ): Promise<boolean> => {
    if (mutationRef.current) return mutationRef.current;
    if (!session || visible.phase !== 'ready' || visible.pendingAction || !scope || !storage) {
      setSnapshot(current => current.marker === marker ? {
        ...current,
        feedback: storage ? 'Refresh verified account economy before making another change.' : 'Account request storage is unavailable. Nothing was changed.',
      } : current);
      return Promise.resolve(false);
    }
    const fingerprint = intentFingerprint(action, value);
    const intentResult = getOrCreateAccountIntent(scope, action, fingerprint, storage);
    if (intentResult.status !== 'ready') {
      setSnapshot(current => current.marker === marker ? {
        ...emptySnapshot(marker, intentResult.status === 'corrupt' ? 'corrupt' : 'unavailable'),
        feedback: 'Saved account request state could not be verified. Nothing was changed.',
        intentStatus: intentResult.status,
      } : current);
      return Promise.resolve(false);
    }
    const intent = intentResult.intent;
    const generation = generationRef.current;
    const operation = (async () => {
      setSnapshot(current => current.marker === marker ? {
        ...current,
        pendingAction: action,
        feedback: 'Request sent. Waiting for verified account state...',
      } : current);
      const controller = new AbortController();
      requestRef.current?.abort();
      requestRef.current = controller;
      const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);
      try {
        try {
          await postAccountEconomyMutation({
            accessToken: session.accessToken,
            signal: controller.signal,
            fetchImpl: options.fetchImpl,
          }, action, intent.requestId,
          action === 'unlock_skin' || action === 'equip_skin' ? value : undefined);
        } catch (error) {
          if (!(error instanceof AccountEconomyRequestError) || error.code !== 'ALREADY_CLAIMED') throw error;
        } finally {
          window.clearTimeout(timeout);
          if (requestRef.current === controller) requestRef.current = null;
        }

        if (generationRef.current !== generation) return false;

        const state = await runGet(session, marker, generation);
        if (!stateConfirmsIntent(state, intent, value)) {
          setSnapshot({
            ...emptySnapshot(marker, 'unverified'),
            feedback: statusForPhase('unverified'),
            pendingAction: action,
          });
          return false;
        }
        if (!clearAccountIntent(intent, storage)) {
          setSnapshot({
            ...emptySnapshot(marker, 'corrupt'),
            feedback: 'Verified account state loaded, but saved request state could not be cleared.',
            intentStatus: 'corrupt',
          });
          return false;
        }
        return applyVerifiedState(marker, scope, state, successFeedback);
      } catch (error) {
        if (generationRef.current !== generation) return false;
        if (isAbort(error) || !(error instanceof AccountEconomyRequestError) || error.status === null || error.status >= 500) {
          setSnapshot({
            ...emptySnapshot(marker, 'unverified'),
            feedback: statusForPhase('unverified'),
            pendingAction: action,
          });
          return false;
        }
        const phase = accountErrorPhase(error);
        if (error instanceof AccountEconomyRequestError && error.status === 403) {
          setSnapshot({ ...emptySnapshot(marker, 'unavailable'), feedback: statusForPhase('unavailable'), pendingAction: action });
          return false;
        }
        if (phase !== 'unavailable') {
          setSnapshot({ ...emptySnapshot(marker, phase), feedback: feedbackForError(error), pendingAction: action });
          return false;
        }
        setSnapshot(current => current.marker === marker ? {
          ...current,
          phase: 'ready',
          pendingAction: null,
          feedback: feedbackForError(error),
        } : current);
        return false;
      } finally {
        mutationRef.current = null;
      }
    })();
    mutationRef.current = operation;
    return operation;
  }, [applyVerifiedState, marker, options.fetchImpl, options.timeoutMs, runGet, scope, session, storage, visible]);

  const checkIn = useCallback(() => {
    if (visible.phase !== 'ready' || !visible.state.checkIn.serverDate) return Promise.resolve(false);
    return mutate('claim_check_in', visible.state.checkIn.serverDate, 'Daily check-in confirmed by the account server.');
  }, [mutate, visible.phase, visible.state.checkIn.serverDate]);
  const finishTutorial = useCallback(() => {
    if (visible.phase !== 'ready' || visible.state.onboarding.completed) return Promise.resolve(false);
    return mutate('finish_onboarding', '', 'New-player guide completion confirmed by the account server.');
  }, [mutate, visible.phase, visible.state.onboarding.completed]);
  const unlockSkin = useCallback((skinId: string) => {
    const item = visible.state.catalog.find(candidate => candidate.id === skinId);
    if (visible.phase !== 'ready' || !item?.purchaseEnabled || item.itemKind !== 'skin') return Promise.resolve(false);
    return mutate('unlock_skin', skinId, 'Cosmetic unlock confirmed by the account server.');
  }, [mutate, visible.phase, visible.state.catalog]);
  const equipSkin = useCallback((skinId: string) => {
    if (visible.phase !== 'ready'
      || !visible.state.inventory.some(item => item.id === skinId && item.itemKind === 'skin')) return Promise.resolve(false);
    return mutate('equip_skin', skinId, 'Cosmetic equipment confirmed by the account server. Gameplay is unchanged.');
  }, [mutate, visible.phase, visible.state.inventory]);
  const skipTutorial = useCallback(() => {
    setSnapshot(current => current.marker === marker ? {
      ...current,
      feedback: 'Guide skipped. No account reward request was sent.',
    } : current);
  }, [marker]);
  const rewardGame = useCallback((): false => {
    setSnapshot(current => current.marker === marker ? {
      ...current,
      feedback: 'Account match rewards are unavailable until a trusted server eligibility writer exists.',
    } : current);
    return false;
  }, [marker]);

  return useMemo(() => ({
    phase: visible.phase,
    state: visible.state,
    feedback: visible.feedback,
    statusMessage: statusForPhase(visible.phase),
    pendingAction: visible.pendingAction,
    loadingMore: visible.loadingMore,
    mutationsDisabled: visible.phase !== 'ready' || visible.pendingAction !== null || visible.intentStatus === 'corrupt' || visible.intentStatus === 'unavailable',
    refresh,
    loadMore,
    checkIn,
    skipTutorial,
    finishTutorial,
    rewardGame,
    unlockSkin,
    equipSkin,
    clearFeedback: () => setSnapshot(current => current.marker === marker ? { ...current, feedback: '' } : current),
  }), [checkIn, equipSkin, finishTutorial, loadMore, marker, refresh, rewardGame, skipTutorial, unlockSkin, visible]);
};

export default useAccountEconomy;
