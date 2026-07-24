import React from 'react';
import {
  ArrowLeft,
  Bot,
  Feather,
  Heart,
  ListChecks,
  Lock,
  Medal,
  Search,
  Sparkles,
  Trophy,
  type LucideIcon,
} from 'lucide-react';
import { MAX_LOCAL_FACTION_CONTRIBUTION, type LobbyFaction } from '../lobbyFeatures';
import '../styles/lobby-features.css';

export interface FactionSupportViewProps {
  contributions: Record<LobbyFaction, number>;
  onContribute: (faction: LobbyFaction) => void;
  onBack?: () => void;
}

interface ModelFactionProfile {
  id: LobbyFaction;
  name: string;
  introduction: string;
  Icon: LucideIcon;
}

const MODEL_FACTIONS: readonly ModelFactionProfile[] = [
  { id: 'gpt', name: 'GPT 阵营', introduction: '条理清晰，擅长结构化推理。', Icon: Bot },
  { id: 'gemini', name: 'Gemini 阵营', introduction: '快速整合多线索，保持敏捷判断。', Icon: Sparkles },
  { id: 'claude', name: 'Claude 阵营', introduction: '重视语境与协作，表达稳健。', Icon: Feather },
  { id: 'deepseek', name: 'DeepSeek 阵营', introduction: '深挖发言矛盾，专注逻辑分析。', Icon: Search },
] as const;

const SUPPORT_REWARDS = [
  { points: 5, label: '应援新秀徽记' },
  { points: 15, label: '阵营观察员称号' },
  { points: 30, label: '推理之声边框预览' },
] as const;

const FactionSupportView: React.FC<FactionSupportViewProps> = ({
  contributions,
  onContribute,
  onBack,
}) => {
  const normalizeContribution = (value: number) => Number.isFinite(value)
    ? Math.min(MAX_LOCAL_FACTION_CONTRIBUTION, Math.max(0, Math.floor(value)))
    : 0;
  const factions = MODEL_FACTIONS.map(profile => ({
    ...profile,
    points: normalizeContribution(contributions[profile.id]),
  }));
  const total = factions.reduce((sum, faction) => sum + faction.points, 0);
  const supportedFactionCount = factions.filter(faction => faction.points > 0).length;
  const leaderboard = [...factions].sort((left, right) => (
    right.points - left.points
    || MODEL_FACTIONS.findIndex(item => item.id === left.id) - MODEL_FACTIONS.findIndex(item => item.id === right.id)
  ));
  const nextReward = SUPPORT_REWARDS.find(reward => total < reward.points)
    ?? SUPPORT_REWARDS[SUPPORT_REWARDS.length - 1];
  const rewardProgress = Math.min(total, nextReward.points);

  return (
    <main className="lobby-feature-page" aria-labelledby="faction-support-title">
      <header className="lobby-feature-header">
        {onBack ? (
          <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="返回" title="返回">
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : <span className="lobby-feature-header-spacer" />}
        <div>
          <h1 id="faction-support-title">阵营应援</h1>
          <span className="lobby-feature-kicker">浏览器内应援</span>
        </div>
        <Heart className="lobby-feature-header-icon" aria-hidden="true" />
      </header>

      <div className="lobby-feature-status" role="status">
        <Heart aria-hidden="true" />
        <span>应援不消耗钱包，也不会生成服务器资产</span>
      </div>

      <div className="lobby-feature-section-heading">
        <h2>模型阵营介绍</h2>
        <span>本地应援总计 {total.toLocaleString('zh-CN')}</span>
      </div>

      <section className="lobby-faction-grid" aria-label="模型阵营介绍与本地应援">
        {factions.map(({ id, name, introduction, points, Icon }) => (
          <article className={`lobby-feature-card lobby-faction-card lobby-faction-card--${id}`} key={id}>
            <Icon aria-hidden="true" />
            <h3>{name}</h3>
            <p>{introduction}</p>
            <strong>{points.toLocaleString('zh-CN')}</strong>
            <span>本地应援点</span>
            <button className="lobby-feature-action" type="button" onClick={() => onContribute(id)}>
              <Heart aria-hidden="true" />
              本地应援 +1
            </button>
          </article>
        ))}
      </section>

      <section className="lobby-faction-reward-progress" aria-labelledby="contribution-reward-progress">
        <div className="lobby-feature-section-heading">
          <h2 id="contribution-reward-progress">贡献奖励进度</h2>
          <span>{rewardProgress} / {nextReward.points} 本地点</span>
        </div>
        <div className="lobby-pass-progress-track" aria-hidden="true">
          <span style={{ width: `${(rewardProgress / nextReward.points) * 100}%` }} />
        </div>
        <strong>下一项：{nextReward.label}</strong>
        <small>应援奖励仅作本地预览</small>
        <div className="lobby-support-reward-list" aria-label="应援奖励预览">
          {SUPPORT_REWARDS.map(reward => (
            <span key={reward.points}><Medal aria-hidden="true" />{reward.points} 点 · {reward.label}</span>
          ))}
        </div>
      </section>

      <section className="lobby-faction-operations-grid">
        <div className="lobby-faction-operation" aria-labelledby="local-faction-leaderboard">
          <div className="lobby-feature-section-heading">
            <h2 id="local-faction-leaderboard"><Trophy aria-hidden="true" />本地应援排行榜</h2>
          </div>
          <ol>
            {leaderboard.map((faction, index) => (
              <li key={faction.id}><span>#{index + 1} {faction.name}</span><strong>{faction.points}</strong></li>
            ))}
          </ol>
        </div>

        <div className="lobby-faction-operation" aria-labelledby="faction-daily-tasks">
          <div className="lobby-feature-section-heading">
            <h2 id="faction-daily-tasks"><ListChecks aria-hidden="true" />每日任务</h2>
          </div>
          <ul>
            <li><span>完成首次本地应援</span><strong>{Math.min(total, 1)} / 1</strong></li>
            <li><span>累计本地应援 3 次</span><strong>{Math.min(total, 3)} / 3</strong></li>
            <li><span>支持 2 个模型阵营</span><strong>{Math.min(supportedFactionCount, 2)} / 2</strong></li>
          </ul>
        </div>
      </section>

      <section className="lobby-feature-unavailable" aria-labelledby="faction-global-support">
        <Lock aria-hidden="true" />
        <div>
          <h2 id="faction-global-support">全服排行榜与真实应援奖励</h2>
          <span>未开放 · 不写入钱包或服务器</span>
        </div>
        <button type="button" disabled>不可贡献</button>
      </section>
    </main>
  );
};

export default FactionSupportView;
