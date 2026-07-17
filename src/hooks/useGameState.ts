import React, { useEffect, useRef, useState } from 'react';
import {
  Difficulty,
  DIFFICULTY_CONFIGS,
  GameConfig,
  GameLog,
  GamePhase,
  GameRecord,
  NightState,
  Player,
  Role,
  SupabaseSession,
  UserProfile,
  VoteRecord,
  Winner,
  WolfChatMessage,
} from '../types';
import { AI_NAMES, AVATAR_SEEDS, ROLE_DESCRIPTIONS, ROLE_LABELS } from '../constants';
import { generateAIAction, generateAIDialogue, generateWolfChat, resetAIMemory, setAIDifficulty } from '../ai/aiOrchestrator';
import { CUSTOM_AI_STYLES } from '../services/aiStyles';
import {
  applyElimination,
  applyNightResolution,
  buildGameRecordSummary,
  createSuspicionMap,
  createVoteRecords,
  getRoleCamp,
  isTargetableAliveOther,
  normalizeHumanSpeech,
  resolveVoteResult,
} from '../gameEngine';
import { isSupabaseConfigured, saveGameRecord } from '../services/supabaseClient';
import { DEFAULT_DISPLAY_LANGUAGE, type DisplayLanguage } from '../i18n';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const AI_STYLE_KEYS = Object.keys(CUSTOM_AI_STYLES);
const MY_PLAYER_ID = 1;
const LOCAL_RECORD_KEY = 'werewolf_guest_records';

/**
 * P0 fix (dead-player-vote-autoresolve): during DAY_VOTING the phase driver
 * must auto-resolve the vote when the human has no vote (dead, or vote lost
 * e.g. revealed Idiot) — otherwise nothing ever calls finishVote and the game
 * soft-locks until the dead spectator clicks "NO VOTE". A living human who
 * can vote is still waited on indefinitely.
 */
export const shouldAutoResolveVote = (
  phase: GamePhase,
  me: Pick<Player, 'isAlive' | 'canVote'> | undefined
): boolean => phase === GamePhase.DAY_VOTING && !(me?.isAlive && me.canVote);

/**
 * P0 fix (night-pipeline-exception-safety): every isProcessingAI block must
 * reset the flag even when an AI call rejects (e.g. the dynamic geminiAdapter
 * chunk failing to load after a redeploy). Without this, the phase driver
 * early-returns on isProcessingAI forever and the game wedges on the
 * "AI正在思考局势..." spinner.
 *
 * Never rejects: errors are routed to onError so callers can log a system
 * line and apply a safe default action; the flag always resets in finally,
 * and the caller's phase advance after the await runs on both paths.
 */
export const runAIPhaseSafely = async (
  setProcessing: (value: boolean) => void,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> => {
  setProcessing(true);
  try {
    await task();
  } catch (error) {
    onError(error);
  } finally {
    setProcessing(false);
  }
};

/**
 * lobby-language-authority: the lobby selection is snapshotted once at
 * startGame as the fixed game language for all AI generation; a missing value
 * keeps today's zh behavior.
 */
export const resolveGameLanguage = (language?: DisplayLanguage): DisplayLanguage =>
  language ?? DEFAULT_DISPLAY_LANGUAGE;

/**
 * P0 fix (speech-timer-autoskip-fix): the speech-timer tick must land on 0 so
 * the auto-skip effect can fire. The old tick jumped 1 → null, and the
 * auto-skip guard (speechTimer !== 0) then early-returned forever — the human
 * speech phase permanently stalled. An inactive timer (null) stays null; an
 * active timer counts down to 0, never negative, and stays at 0 until the
 * timer effect resets it.
 */
export const tickSpeechTimer = (value: number | null): number | null => {
  if (value === null) return null;
  return Math.max(0, value - 1);
};

/**
 * Auto-skip guard: fires only when an active speech timer has reached 0 AND
 * the current speaker is the human. An inactive timer (null) or a non-human
 * speaker never triggers it.
 */
export const shouldAutoSkipSpeech = (
  speechTimer: number | null,
  currentSpeakerId: number | undefined
): boolean => speechTimer === 0 && currentSpeakerId === MY_PLAYER_ID;

export interface AuthContext {
  session: SupabaseSession | null;
  isGuest: boolean;
  profile: UserProfile | null;
  records: GameRecord[];
  setRecords: React.Dispatch<React.SetStateAction<GameRecord[]>>;
  recordError: string;
  setRecordError: React.Dispatch<React.SetStateAction<string>>;
  authEmail: string;
}

export function useGameState(authContext: AuthContext) {
  const { session, isGuest, profile, setRecords, setRecordError, authEmail } = authContext;

  const [config, setConfig] = useState<GameConfig | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [gameLanguage, setGameLanguage] = useState<DisplayLanguage>(DEFAULT_DISPLAY_LANGUAGE);
  const [players, setPlayers] = useState<Player[]>([]);
  const [phase, setPhase] = useState<GamePhase>(GamePhase.LOGIN);
  const [logs, setLogs] = useState<GameLog[]>([]);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [witchStatus, setWitchStatus] = useState({ hasSave: true, hasPoison: true });
  const [nightState, setNightState] = useState<NightState>({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
  const [roundCount, setRoundCount] = useState(0);
  const [winner, setWinner] = useState<Winner>(null);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [translateEnabled, setTranslateEnabled] = useState(true);
  const [userInput, setUserInput] = useState('');
  const [aiSeerLastCheck, setAiSeerLastCheck] = useState<{ targetId: number; isGood: boolean } | null>(null);
  const [speakingQueue, setSpeakingQueue] = useState<Player[]>([]);
  const [currentSpeaker, setCurrentSpeaker] = useState<Player | null>(null);
  const [deadThisRound, setDeadThisRound] = useState<number[]>([]);
  const [voteRecords, setVoteRecords] = useState<VoteRecord[]>([]);
  const [wolfChat, setWolfChat] = useState<WolfChatMessage[]>([]);
  const [wolfCountdown, setWolfCountdown] = useState<number | null>(null);
  const [pendingHunterId, setPendingHunterId] = useState<number | null>(null);
  const [hunterReturnPhase, setHunterReturnPhase] = useState<GamePhase.DAY_DISCUSSION | GamePhase.NIGHT_START>(GamePhase.DAY_DISCUSSION);
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null);
  // NetEase rule: speech timer (60s per player)
  const [speechTimer, setSpeechTimer] = useState<number | null>(null);
  // Track last eliminated player for clockwise speaking order
  const [lastEliminatedId, setLastEliminatedId] = useState<number | null>(null);

  const SPEECH_DURATION = 60; // seconds per player

  const logsEndRef = useRef<HTMLDivElement>(null);

  const me = players.find(player => player.id === MY_PLAYER_ID);

  // Scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs, currentSpeaker, wolfChat]);

  // Wolf countdown timer
  useEffect(() => {
    if (phase !== GamePhase.NIGHT_WEREWOLVES) {
      setWolfCountdown(null);
      return;
    }

    setWolfCountdown(20);
    const interval = window.setInterval(() => {
      setWolfCountdown(value => {
        if (value === null) return null;
        return Math.max(0, value - 1);
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [phase, roundCount]);

  // Wolf countdown auto-select fallback
  useEffect(() => {
    if (phase !== GamePhase.NIGHT_WEREWOLVES || wolfCountdown !== 0 || !me?.isAlive || me.role !== Role.WEREWOLF || nightState.wolfKillId) return;
    const fallbackTarget = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
    if (fallbackTarget) {
      addLog(`Wolf timer expired. Auto selected Player ${fallbackTarget.id}.`, true, undefined, `狼队倒计时结束，自动选择${fallbackTarget.id}号。`, 'wolf');
      setNightState(prev => ({ ...prev, wolfKillId: fallbackTarget.id }));
    }
    setPhase(GamePhase.NIGHT_SEER);
  }, [wolfCountdown, phase, me, nightState.wolfKillId, players]);

  // Speech timer — countdown for human player during discussion
  useEffect(() => {
    if (phase !== GamePhase.DAY_DISCUSSION || !currentSpeaker || currentSpeaker.id !== MY_PLAYER_ID) {
      setSpeechTimer(null);
      return;
    }
    setSpeechTimer(SPEECH_DURATION);
    const interval = window.setInterval(() => {
      setSpeechTimer(tickSpeechTimer);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [currentSpeaker, phase]);

  // Auto-skip human speech when timer reaches 0
  useEffect(() => {
    if (!shouldAutoSkipSpeech(speechTimer, currentSpeaker?.id)) return;
    addLog('Time expired.', true, undefined, '发言时间到，自动跳过。', 'system');
    setCurrentSpeaker(null);
  }, [speechTimer]);

  // Phase transition driver
  useEffect(() => {
    if (winner || !players.length || isProcessingAI) return;
    const timer = window.setTimeout(() => {
      if (phase === GamePhase.NIGHT_START) beginNight();
      else if (phase === GamePhase.NIGHT_WEREWOLVES) handleWerewolfPhase();
      else if (phase === GamePhase.NIGHT_SEER) handleSeerPhase();
      else if (phase === GamePhase.NIGHT_WITCH) handleWitchPhase();
      else if (phase === GamePhase.DAY_ANNOUNCE) handleDayAnnounce();
      else if (phase === GamePhase.DAY_HUNTER_CHECK) handleHunterCheck();
      else if (phase === GamePhase.DAY_DISCUSSION) handleDiscussion();
      else if (shouldAutoResolveVote(phase, me)) finishVote(null);
    }, 700);

    return () => window.clearTimeout(timer);
  }, [phase, players, isProcessingAI, winner, currentSpeaker, speakingQueue, deadThisRound, nightState]);

  // Game record saving
  useEffect(() => {
    if (!winner || !config || !me || savedRecordId) return;

    const userWon = (winner === 'WEREWOLVES' && me.role === Role.WEREWOLF) || (winner === 'VILLAGERS' && me.role !== Role.WEREWOLF);
    const summary = buildGameRecordSummary(config, me.role, winner, roundCount, logs);
    const baseRecord = {
      userId: session?.user.id || 'guest',
      boardId: config.id,
      role: me.role,
      result: userWon ? 'WIN' as const : 'LOSE' as const,
      rounds: Math.max(1, roundCount),
      summary,
    };

    if (session && !isGuest && isSupabaseConfigured()) {
      saveGameRecord(session, baseRecord)
        .then(record => {
          setRecords(prev => [record, ...prev]);
          setSavedRecordId(record.id);
        })
        .catch(error => {
          setRecordError(error.message || '战绩保存失败。');
          setSavedRecordId('failed');
        });
    } else {
      const record: GameRecord = {
        ...baseRecord,
        id: `local-${Date.now()}`,
        createdAt: new Date().toISOString(),
      };
      setRecords(prev => {
        const next = [record, ...prev].slice(0, 20);
        localStorage.setItem(LOCAL_RECORD_KEY, JSON.stringify(next));
        return next;
      });
      setSavedRecordId(record.id);
    }
  }, [winner, config, me, savedRecordId, roundCount, logs, session, isGuest]);

  const addLog = (
    message: string,
    isSystem: boolean,
    speakerId?: number,
    translation?: string,
    tone: GameLog['tone'] = isSystem ? 'system' : 'speech'
  ) => {
    setLogs(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random()}`,
        phase,
        message,
        translation,
        isSystem,
        speakerId,
        tone,
      },
    ]);
  };

  const startGame = (nextConfig: GameConfig, language?: DisplayLanguage) => {
    resetAIMemory();
    setGameLanguage(resolveGameLanguage(language));
    setAIDifficulty(DIFFICULTY_CONFIGS[difficulty].actionAccuracy);
    const shuffledRoles = [...nextConfig.roles].sort(() => Math.random() - 0.5);
    const wolfIndices: number[] = [];
    const basePlayers: Player[] = shuffledRoles.map((role, index) => {
      const isHuman = index === 0;
      const styleKey = AI_STYLE_KEYS[Math.floor(Math.random() * AI_STYLE_KEYS.length)];
      const styleConf = CUSTOM_AI_STYLES[styleKey];
      if (role === Role.WEREWOLF && !isHuman) wolfIndices.push(index);

      return {
        id: index + 1,
        name: isHuman ? (isGuest ? 'Guest' : profile?.displayName || authEmail.split('@')[0] || 'Player') : AI_NAMES[index % AI_NAMES.length],
        role,
        camp: getRoleCamp(role),
        isAlive: true,
        canVote: true,
        isRevealed: false,
        avatarUrl: `https://api.dicebear.com/7.x/notionists/svg?seed=${isHuman ? 'MySelf' : AVATAR_SEEDS[index % AVATAR_SEEDS.length]}&backgroundColor=transparent`,
        aiPersonality: isHuman ? 'Human' : styleConf.label,
        aiModelLabel: isHuman ? 'HUMAN' : styleKey,
        traits: isHuman ? [] : [styleKey],
        isHuman,
        isWolfHopper: false,
        publicClaims: [],
        privateKnowledge: [],
        suspicionMap: {},
      };
    });

    if (wolfIndices.length > 0) {
      basePlayers[wolfIndices[Math.floor(Math.random() * wolfIndices.length)]].isWolfHopper = true;
    }

    const nextPlayers = basePlayers.map(player => ({
      ...player,
      suspicionMap: createSuspicionMap(player.id, basePlayers),
      privateKnowledge: player.role === Role.WEREWOLF
        ? [`狼队友：${basePlayers.filter(p => p.role === Role.WEREWOLF && p.id !== player.id).map(p => `${p.id}号`).join('、') || '无'}`]
        : [],
    }));

    setConfig(nextConfig);
    setPlayers(nextPlayers);
    const localVitePorts = new Set(['5173', '4173', '4174', '4175']);
    const localProxyNotice = localVitePorts.has(window.location.port)
      ? [{
          id: `proxy-${Date.now()}`,
          phase: GamePhase.LOBBY,
          message: 'Local Vite preview does not run Netlify Functions. AI fallback speech is active.',
          translation: '本地 Vite 预览不会运行 Netlify Functions；当前使用本地AI fallback话术。部署到Netlify并配置 API_KEY 后会启用服务端Gemini。',
          isSystem: true,
          tone: 'warning' as const,
        }]
      : [];

    setLogs([
      {
        id: 'init',
        phase: GamePhase.LOBBY,
        message: `Game Start. You are ${nextPlayers[0].role}.`,
        translation: `游戏开始。你的身份是：${ROLE_LABELS[nextPlayers[0].role]}。${ROLE_DESCRIPTIONS[nextPlayers[0].role]}`,
        isSystem: true,
        tone: 'system',
      },
      ...localProxyNotice,
    ]);
    if (nextPlayers[0].role === Role.WEREWOLF) {
      const teammates = nextPlayers.filter(player => player.role === Role.WEREWOLF && player.id !== MY_PLAYER_ID).map(player => `${player.id}号`);
      setLogs(prev => [
        ...prev,
        {
          id: `wolves-${Date.now()}`,
          phase: GamePhase.LOBBY,
          message: `Wolf teammates: ${teammates.join(', ') || 'none'}.`,
          translation: `你的狼队友：${teammates.join('、') || '无'}。夜晚可查看狼队频道。`,
          isSystem: true,
          tone: 'wolf',
        },
      ]);
    }

    setPhase(GamePhase.NIGHT_START);
    setRoundCount(0);
    setWinner(null);
    setWitchStatus({ hasSave: true, hasPoison: true });
    setNightState({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
    setAiSeerLastCheck(null);
    setSpeakingQueue([]);
    setCurrentSpeaker(null);
    setDeadThisRound([]);
    setVoteRecords([]);
    setWolfChat([]);
    setSelectedPlayerId(null);
    setPendingHunterId(null);
    setSavedRecordId(null);
    setUserInput('');
    setRecordError('');
  };

  const beginNight = () => {
    setRoundCount(prev => prev + 1);
    setNightState({ wolfKillId: null, witchPoisonId: null, witchSaved: false });
    setDeadThisRound([]);
    setSelectedPlayerId(null);
    setWolfChat([]);
    addLog('Night falls.', true, undefined, '天黑请闭眼。', 'system');
    setPhase(GamePhase.NIGHT_WEREWOLVES);
  };

  const handleWerewolfPhase = async () => {
    const humanWolf = me?.role === Role.WEREWOLF && me.isAlive;
    const wolves = players.filter(player => player.role === Role.WEREWOLF && player.isAlive);
    if (wolfChat.length === 0 && wolves.length > 0) {
      try {
        const chat = await generateWolfChat(wolves, players, logs, Math.max(1, roundCount), voteRecords, gameLanguage);
        setWolfChat(chat);
      } catch {
        // Wolf chat is cosmetic — a failed AI call must never block the night.
      }
    }
    if (humanWolf) return;

    await runAIPhaseSafely(setIsProcessingAI, async () => {
      const leader = wolves[0];
      const action = leader ? await generateAIAction(leader, players, logs, 'KILL', voteRecords) : { targetId: null };
      const fallback = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
      const targetId = action.targetId || fallback?.id || null;
      if (targetId) setNightState(prev => ({ ...prev, wolfKillId: targetId }));
    }, () => {
      addLog('AI error. Default wolf target used.', true, undefined, 'AI出错，狼队采用保底刀口。', 'system');
      const fallback = players.find(player => player.isAlive && player.role !== Role.WEREWOLF);
      if (fallback) setNightState(prev => ({ ...prev, wolfKillId: fallback.id }));
    });
    setPhase(GamePhase.NIGHT_SEER);
  };

  const handleSeerPhase = async () => {
    if (me?.role === Role.SEER && me.isAlive) return;
    await runAIPhaseSafely(setIsProcessingAI, async () => {
      const seer = players.find(player => player.role === Role.SEER && player.isAlive);
      if (seer) {
        const action = await generateAIAction(seer, players, logs, 'CHECK', voteRecords);
        const target = players.find(player => player.id === action.targetId);
        if (target) setAiSeerLastCheck({ targetId: target.id, isGood: target.role !== Role.WEREWOLF });
      }
    }, () => {
      addLog('AI error. Seer check skipped.', true, undefined, 'AI出错，本晚查验跳过。', 'system');
    });
    setPhase(GamePhase.NIGHT_WITCH);
  };

  const handleWitchPhase = async () => {
    if (me?.role === Role.WITCH && me.isAlive) return;
    await runAIPhaseSafely(setIsProcessingAI, async () => {
      const witch = players.find(player => player.role === Role.WITCH && player.isAlive);
      if (witch) {
        let nextNight = { ...nightState };
        let nextWitch = { ...witchStatus };
        const killedPlayer = players.find(player => player.id === nightState.wolfKillId);
        if (nightState.wolfKillId && witchStatus.hasSave && killedPlayer?.role !== Role.WEREWOLF && Math.random() > 0.45) {
          nextNight = { ...nextNight, witchSaved: true };
          nextWitch = { ...nextWitch, hasSave: false };
        } else if (witchStatus.hasPoison && Math.random() > 0.72) {
          const action = await generateAIAction(witch, players, logs, 'POISON', voteRecords);
          if (action.targetId && action.targetId !== nightState.wolfKillId) {
            nextNight = { ...nextNight, witchPoisonId: action.targetId };
            nextWitch = { ...nextWitch, hasPoison: false };
          }
        }
        setNightState(nextNight);
        setWitchStatus(nextWitch);
      }
    }, () => {
      addLog('AI error. Witch action skipped.', true, undefined, 'AI出错，女巫本晚不用药。', 'system');
    });
    setPhase(GamePhase.DAY_ANNOUNCE);
  };

  /**
   * NetEase rule: clockwise speaking order starting from dead player's next seat.
   */
  const buildSpeakingQueue = (alivePlayers: Player[], lastDeadId: number | null): Player[] => {
    if (!lastDeadId) return alivePlayers;
    // Find the first alive player whose id is greater than lastDeadId
    const startIdx = alivePlayers.findIndex(p => p.id > lastDeadId);
    if (startIdx === -1) return alivePlayers; // wrap: all higher IDs dead
    return [...alivePlayers.slice(startIdx), ...alivePlayers.slice(0, startIdx)];
  };

  const handleDayAnnounce = () => {
    const outcome = applyNightResolution(players, nightState);
    setPlayers(outcome.players);
    setDeadThisRound(outcome.deadIds);
    const msg = outcome.deadIds.length ? `Deaths: ${outcome.deadIds.join(', ')}` : 'Peaceful night.';
    const trans = outcome.deadIds.length
      ? `昨晚倒牌：${outcome.deadIds.map(id => `${id}号`).join('、')}`
      : '昨晚平安夜。';
    addLog(msg, true, undefined, trans, 'system');

    if (outcome.winner) {
      setWinner(outcome.winner);
      setPhase(GamePhase.GAME_OVER);
      return;
    }

    // NetEase fix: ALL rounds — dead players get last words
    const lastWords = outcome.players.filter(p => outcome.deadIds.includes(p.id));
    setSpeakingQueue(lastWords);

    // Track first death for clockwise order
    if (outcome.deadIds.length > 0) {
      setLastEliminatedId(outcome.deadIds[0]);
    }

    setPhase(GamePhase.DAY_HUNTER_CHECK);
  };

  const enterDiscussion = (nextPlayers: Player[] = players) => {
    const alive = nextPlayers.filter(p => p.isAlive);
    // NetEase rule: start from dead player's clockwise neighbor
    const ordered = buildSpeakingQueue(alive, lastEliminatedId);
    setSpeakingQueue(prev => [...prev, ...ordered]);
    setPhase(GamePhase.DAY_DISCUSSION);
  };

  const handleHunterCheck = () => {
    const hunter = players.find(player => player.role === Role.HUNTER);
    if (hunter && deadThisRound.includes(hunter.id) && nightState.witchPoisonId !== hunter.id) {
      if (hunter.isHuman) {
        setPendingHunterId(hunter.id);
        setHunterReturnPhase(GamePhase.DAY_DISCUSSION);
        addLog('Hunter may shoot.', true, undefined, '猎人死亡，可以开枪带走一名玩家。', 'action');
        setPhase(GamePhase.DAY_HUNTER_SHOT);
        return;
      }
      const targets = players.filter(player => player.isAlive && player.id !== hunter.id);
      const target = targets[Math.floor(Math.random() * targets.length)];
      if (target) {
        addLog(`Hunter shoots Player ${target.id}.`, true, undefined, `猎人开枪带走${target.id}号。`, 'action');
        const outcome = applyElimination(players, target.id, 'HUNTER');
        setPlayers(outcome.players);
        if (outcome.winner) {
          setWinner(outcome.winner);
          setPhase(GamePhase.GAME_OVER);
          return;
        }
        enterDiscussion(outcome.players);
        return;
      }
    }
    enterDiscussion();
  };

  const handleDiscussion = async () => {
    if (currentSpeaker || isProcessingAI) return;
    if (speakingQueue.length === 0) {
      addLog('Discussion ended. Voting starts.', true, undefined, '发言结束，开始放逐投票。', 'system');
      setPhase(GamePhase.DAY_VOTING);
      return;
    }

    const nextSpeaker = speakingQueue[0];
    setSpeakingQueue(prev => prev.slice(1));
    setCurrentSpeaker(nextSpeaker);
    // Skip dead human players — they spoke their last words already
  if (!nextSpeaker.isAlive && nextSpeaker.isHuman) {
    addLog(`Dead player ${nextSpeaker.id} has no further speech.`, true, undefined, `${nextSpeaker.id}号已出局，跳过发言。`, 'system');
    setCurrentSpeaker(null);
    return;
  }
  // Human alive? Wait for them to type
  if (nextSpeaker.isHuman) return;

    await runAIPhaseSafely(setIsProcessingAI, async () => {
      const seerInfo = nextSpeaker.role === Role.SEER ? aiSeerLastCheck : null;
      const response = await generateAIDialogue(
        nextSpeaker,
        players,
        logs,
        GamePhase.DAY_DISCUSSION,
        deadThisRound,
        Math.max(1, roundCount),
        seerInfo,
        voteRecords,
        nightState,
        gameLanguage
      );
      addLog(response.en, false, nextSpeaker.id, response.zh, 'speech');
    }, () => {
      addLog(`Player ${nextSpeaker.id} speech skipped (AI error).`, true, undefined, `AI出错，${nextSpeaker.id}号发言跳过。`, 'system');
    });
    setCurrentSpeaker(null);
  };

  const finishVote = async (humanTargetId: number | null) => {
    await runAIPhaseSafely(setIsProcessingAI, async () => {
      const votes: Record<number, number> = {};
      const votesByVoter: Record<number, number | null> = {};
      const humanCanVote = Boolean(me?.isAlive && me.canVote);

      if (humanCanVote && humanTargetId) {
        votes[humanTargetId] = (votes[humanTargetId] || 0) + 1;
        votesByVoter[MY_PLAYER_ID] = humanTargetId;
        addLog(`You voted Player ${humanTargetId}.`, true, undefined, `你投给了${humanTargetId}号。`, 'vote');
      } else {
        votesByVoter[MY_PLAYER_ID] = null;
        addLog('You have no vote or abstained.', true, undefined, '你无票或弃票。', 'vote');
      }

      const aiVoters = players.filter(player => player.isAlive && !player.isHuman && player.canVote);
      for (const voter of aiVoters) {
        await delay(180);
        let targetId: number | null = null;
        try {
          targetId = (await generateAIAction(voter, players, logs, 'VOTE', voteRecords)).targetId;
        } catch {
          // Failed AI vote counts as abstain — keep the tally moving.
        }
        votesByVoter[voter.id] = targetId;
        if (targetId) votes[targetId] = (votes[targetId] || 0) + 1;
      }

      const newVoteRecords = createVoteRecords(Math.max(1, roundCount), votesByVoter);
      setVoteRecords(prev => [...prev, ...newVoteRecords]);
      addLog(
        `Vote record: ${newVoteRecords.map(v => `${v.voterId}->${v.targetId || 'skip'}`).join(', ')}`,
        true,
        undefined,
        `票型：${newVoteRecords.map(v => `${v.voterId}号→${v.targetId ? `${v.targetId}号` : '弃票'}`).join('，')}`,
        'vote'
      );

      const eliminatedPlayerId = resolveVoteResult(votes);
      if (!eliminatedPlayerId) {
        addLog('Tie vote. No one is exiled.', true, undefined, '平票，无人出局。', 'vote');
        setPhase(GamePhase.NIGHT_START);
        return;
      }

      const target = players.find(player => player.id === eliminatedPlayerId);
      const outcome = applyElimination(players, eliminatedPlayerId, 'VOTE');
      setPlayers(outcome.players);
      if (outcome.sparedByIdiot) {
        addLog(`Player ${eliminatedPlayerId} reveals Idiot and survives.`, true, undefined, `${eliminatedPlayerId}号白痴翻牌免死，但之后失去投票权。`, 'action');
        setPhase(GamePhase.NIGHT_START);
        return;
      }

      addLog(`Player ${eliminatedPlayerId} was exiled.`, true, undefined, `${eliminatedPlayerId}号被放逐出局。`, 'vote');
      if (outcome.winner) {
        setWinner(outcome.winner);
        setPhase(GamePhase.GAME_OVER);
        return;
      }

      if (target?.role === Role.HUNTER) {
        if (target.isHuman) {
          setPendingHunterId(target.id);
          setHunterReturnPhase(GamePhase.NIGHT_START);
          setPhase(GamePhase.DAY_HUNTER_SHOT);
          return;
        }
        const aliveTargets = outcome.players.filter(player => player.isAlive && player.id !== target.id);
        const shot = aliveTargets[Math.floor(Math.random() * aliveTargets.length)];
        if (shot) {
          const shotOutcome = applyElimination(outcome.players, shot.id, 'HUNTER');
          addLog(`Hunter shoots Player ${shot.id}.`, true, undefined, `猎人开枪带走${shot.id}号。`, 'action');
          setPlayers(shotOutcome.players);
          if (shotOutcome.winner) {
            setWinner(shotOutcome.winner);
            setPhase(GamePhase.GAME_OVER);
            return;
          }
        }
      }

      setPhase(GamePhase.NIGHT_START);
    }, () => {
      addLog('AI error during voting. Night begins.', true, undefined, 'AI投票处理出错，直接进入夜晚。', 'system');
      setPhase(GamePhase.NIGHT_START);
    });
  };

  const handleHumanSpeechSubmit = () => {
    if (currentSpeaker?.id !== MY_PLAYER_ID) return;
    const nextSpeech = normalizeHumanSpeech(userInput);
    if (!nextSpeech) return;
    addLog(nextSpeech, false, MY_PLAYER_ID, nextSpeech, 'speech');
    setUserInput('');
    setCurrentSpeaker(null);
  };

  const handleHunterShot = (targetId: number) => {
    if (!pendingHunterId || !isTargetableAliveOther(players, pendingHunterId, targetId)) return;
    const outcome = applyElimination(players, targetId, 'HUNTER');
    addLog(`Hunter shoots Player ${targetId}.`, true, undefined, `猎人开枪带走${targetId}号。`, 'action');
    setPlayers(outcome.players);
    setPendingHunterId(null);
    if (outcome.winner) {
      setWinner(outcome.winner);
      setPhase(GamePhase.GAME_OVER);
      return;
    }
    if (hunterReturnPhase === GamePhase.DAY_DISCUSSION) enterDiscussion(outcome.players);
    else setPhase(GamePhase.NIGHT_START);
  };

  const handlePlayerAction = (targetId: number) => {
    if (isProcessingAI) return;
    const target = players.find(player => player.id === targetId);
    if (!me?.isAlive || !target) return;

    if (phase === GamePhase.NIGHT_WEREWOLVES && me.role === Role.WEREWOLF) {
      if (!target.isAlive || target.role === Role.WEREWOLF) return;
      setNightState(prev => ({ ...prev, wolfKillId: targetId }));
      addLog(`Wolf target locked: Player ${targetId}.`, true, undefined, `狼队刀口已锁定：${targetId}号。`, 'wolf');
      setPhase(GamePhase.NIGHT_SEER);
    } else if (phase === GamePhase.NIGHT_SEER && me.role === Role.SEER) {
      if (!isTargetableAliveOther(players, MY_PLAYER_ID, targetId)) return;
      const isGood = target.role !== Role.WEREWOLF;
      addLog(`Check Player ${targetId}: ${isGood ? 'GOOD' : 'WOLF'}.`, true, undefined, `${targetId}号查验结果：${isGood ? '金水/好人' : '查杀/狼人'}。`, 'action');
      setAiSeerLastCheck({ targetId, isGood });
      setPhase(GamePhase.NIGHT_WITCH);
    } else if (phase === GamePhase.NIGHT_WITCH && me.role === Role.WITCH) {
      if (!isTargetableAliveOther(players, MY_PLAYER_ID, targetId) || !witchStatus.hasPoison) return;
      setNightState(prev => ({ ...prev, witchPoisonId: targetId }));
      setWitchStatus(prev => ({ ...prev, hasPoison: false }));
      addLog(`Poison Player ${targetId}.`, true, undefined, `你选择毒杀${targetId}号。`, 'action');
      setPhase(GamePhase.DAY_ANNOUNCE);
    } else if (phase === GamePhase.DAY_HUNTER_SHOT) {
      handleHunterShot(targetId);
    } else if (phase === GamePhase.DAY_VOTING) {
      if (!target.isAlive || target.id === MY_PLAYER_ID) return;
      finishVote(targetId);
    }
  };

  const handleWitchSave = () => {
    if (!witchStatus.hasSave || !nightState.wolfKillId) return;
    setNightState(prev => ({ ...prev, witchSaved: true }));
    setWitchStatus(prev => ({ ...prev, hasSave: false }));
    addLog('Witch used antidote.', true, undefined, `你使用解药救下${nightState.wolfKillId}号。`, 'action');
    setPhase(GamePhase.DAY_ANNOUNCE);
  };

  const skipWitch = () => {
    addLog('Witch passed.', true, undefined, '女巫选择不使用药。', 'action');
    setPhase(GamePhase.DAY_ANNOUNCE);
  };

  const selectedPlayer = players.find(p => p.id === selectedPlayerId);
  const visibleText = (log: GameLog) =>
    translateEnabled && log.translation ? log.translation : log.message;

  const phaseHint = (() => {
    if (!me) return '';
    if (phase === GamePhase.NIGHT_WEREWOLVES && me.role === Role.WEREWOLF) return '选择一名非狼人玩家作为刀口。';
    if (phase === GamePhase.NIGHT_SEER && me.role === Role.SEER) return '选择一名玩家查验身份。';
    if (phase === GamePhase.NIGHT_WITCH && me.role === Role.WITCH) return '选择救人、毒人或跳过。';
    if (phase === GamePhase.DAY_DISCUSSION && currentSpeaker?.id === MY_PLAYER_ID) return '轮到你公开发言。';
    if (phase === GamePhase.DAY_VOTING) return me.canVote ? '选择一名玩家进行放逐投票。' : '你已无票，只能旁观本轮投票。';
    if (phase === GamePhase.DAY_HUNTER_SHOT) return '猎人开枪阶段，选择一名存活玩家。';
    return '等待系统和AI玩家行动。';
  })();

  return {
    // state
    config, players, phase, setPhase, logs,
    difficulty, setDifficulty,
    selectedPlayerId, setSelectedPlayerId,
    witchStatus, nightState, roundCount, winner,
    isProcessingAI, isMuted, setIsMuted,
    translateEnabled, setTranslateEnabled,
    userInput, setUserInput,
    speakingQueue, currentSpeaker,
    deadThisRound, voteRecords, wolfChat, wolfCountdown,
    pendingHunterId, savedRecordId,
    speechTimer, aiSeerLastCheck,
    // derived
    me, selectedPlayer, visibleText, phaseHint,
    logsEndRef,
    // actions
    startGame, handlePlayerAction,
    handleWitchSave, skipWitch,
    finishVote, handleHumanSpeechSubmit,
  };
}
