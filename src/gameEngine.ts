import { GameConfig, GameLog, GamePhase, NightState, Player, Role, VoteRecord, Winner } from './types';

export type EliminationReason = 'VOTE' | 'NIGHT' | 'HUNTER' | 'POISON';

export const getRoleCamp = (role: Role) => (role === Role.WEREWOLF ? 'WEREWOLF' : 'VILLAGE');

export const createSuspicionMap = (selfId: number, players: Player[]) => {
  return players.reduce<Record<number, number>>((map, player) => {
    if (player.id !== selfId) map[player.id] = 0.5;
    return map;
  }, {});
};

export const computeWinner = (players: Player[]): Winner => {
  const aliveWerewolves = players.filter(player => player.isAlive && player.role === Role.WEREWOLF).length;
  const aliveVillagers = players.filter(player => player.isAlive && player.role === Role.VILLAGER).length;
  const aliveGods = players.filter(
    player => player.isAlive && player.role !== Role.WEREWOLF && player.role !== Role.VILLAGER
  ).length;

  if (aliveWerewolves === 0) return 'VILLAGERS';
  if (aliveVillagers === 0 || aliveGods === 0) return 'WEREWOLVES';
  return null;
};

export const applyElimination = (
  players: Player[],
  playerId: number,
  reason: EliminationReason = 'VOTE'
) => {
  let sparedByIdiot = false;
  let eliminated = false;

  const nextPlayers = players.map(player => {
    if (player.id !== playerId || !player.isAlive) return player;

    if (reason === 'VOTE' && player.role === Role.IDIOT && !player.isRevealed) {
      sparedByIdiot = true;
      return {
        ...player,
        canVote: false,
        isRevealed: true,
        publicClaims: [...player.publicClaims, '白痴翻牌免死'],
      };
    }

    eliminated = true;
    return {
      ...player,
      isAlive: false,
      canVote: false,
      isRevealed: true,
    };
  });

  return {
    players: nextPlayers,
    winner: computeWinner(nextPlayers),
    eliminated,
    sparedByIdiot,
  };
};

export const applyNightResolution = (players: Player[], nightState: NightState) => {
  const wolfDeath = nightState.witchSaved ? null : nightState.wolfKillId;
  const deadIds = [...new Set([wolfDeath, nightState.witchPoisonId].filter((id): id is number => id !== null))];
  const nextPlayers = players.map(player =>
    deadIds.includes(player.id)
      ? { ...player, isAlive: false, canVote: false, isRevealed: true }
      : player
  );

  return {
    deadIds,
    players: nextPlayers,
    winner: computeWinner(nextPlayers),
  };
};

export const resolveVoteResult = (votes: Record<number, number>) => {
  let maxVotes = 0;
  let eliminatedPlayerId: number | null = null;

  for (const [rawPlayerId, count] of Object.entries(votes)) {
    const playerId = Number(rawPlayerId);
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedPlayerId = playerId;
    } else if (count === maxVotes) {
      eliminatedPlayerId = null;
    }
  }

  return eliminatedPlayerId;
};

export const normalizeHumanSpeech = (value: string) => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const isTargetableAliveOther = (players: Player[], actorId: number, targetId: number) => {
  const target = players.find(player => player.id === targetId);
  return Boolean(target && target.isAlive && target.id !== actorId);
};

export const getActionableTargets = (
  players: Player[],
  actorId: number,
  options: { includeWerewolves?: boolean; onlyWerewolves?: boolean; requireCanVote?: boolean } = {}
) => {
  return players.filter(player => {
    if (!player.isAlive || player.id === actorId) return false;
    if (options.requireCanVote && !player.canVote) return false;
    if (options.onlyWerewolves && player.role !== Role.WEREWOLF) return false;
    if (options.includeWerewolves === false && player.role === Role.WEREWOLF) return false;
    return true;
  });
};

export const createVoteRecords = (
  round: number,
  votesByVoter: Record<number, number | null>
): VoteRecord[] => {
  return Object.entries(votesByVoter).map(([rawVoterId, targetId]) => ({
    round,
    voterId: Number(rawVoterId),
    targetId,
    phase: GamePhase.DAY_VOTING,
  }));
};

export const summarizePublicState = (
  players: Player[],
  logs: GameLog[],
  voteRecords: VoteRecord[],
  config: GameConfig | null,
  round: number
) => {
  const alive = players.filter(player => player.isAlive).map(player => `${player.id}号${player.isRevealed ? `(${player.role})` : ''}`);
  const dead = players.filter(player => !player.isAlive).map(player => `${player.id}号(${player.role})`);
  const lastVotes = voteRecords
    .filter(record => record.round === round)
    .map(record => `${record.voterId}->${record.targetId ?? '弃票'}`)
    .join(', ');
  const keyLogs = logs
    .slice(-8)
    .map(log => `${log.speakerId ? `${log.speakerId}号` : '系统'}:${log.translation || log.message}`)
    .join(' / ');

  return [
    `板子:${config?.displayName || '未知'}`,
    `轮次:${round}`,
    `存活:${alive.join(', ') || '无'}`,
    `死亡:${dead.join(', ') || '无'}`,
    `本轮票型:${lastVotes || '暂无'}`,
    `近期发言:${keyLogs || '暂无'}`,
  ].join('\n');
};

export const buildGameRecordSummary = (
  config: GameConfig | null,
  role: Role,
  winner: Exclude<Winner, null>,
  round: number,
  logs: GameLog[]
) => {
  const result = winner === 'WEREWOLVES' ? '狼人阵营胜利' : '好人阵营胜利';
  const highlights = logs
    .filter(log => log.isSystem || log.tone === 'vote')
    .slice(-5)
    .map(log => log.translation || log.message)
    .join(' / ');

  return `${config?.displayName || '未知板子'}，你的身份：${role}，${result}，共${round}轮。${highlights}`;
};
