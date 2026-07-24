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
  { id: 'gpt', name: 'GPT Faction', introduction: 'Clear, structured reasoning with an organized approach.', Icon: Bot },
  { id: 'gemini', name: 'Gemini Faction', introduction: 'Combines multiple clues quickly and stays agile.', Icon: Sparkles },
  { id: 'claude', name: 'Claude Faction', introduction: 'Values context and cooperation with measured communication.', Icon: Feather },
  { id: 'deepseek', name: 'DeepSeek Faction', introduction: 'Examines contradictions and focuses on logical analysis.', Icon: Search },
] as const;

const SUPPORT_REWARDS = [
  { points: 5, label: 'Rookie Supporter Badge' },
  { points: 15, label: 'Faction Observer Title' },
  { points: 30, label: 'Voice of Deduction Frame Preview' },
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
          <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="Back" title="Back">
            <ArrowLeft aria-hidden="true" />
          </button>
        ) : <span className="lobby-feature-header-spacer" />}
        <div>
          <h1 id="faction-support-title">Faction Support</h1>
          <span className="lobby-feature-kicker">In-Browser Support</span>
        </div>
        <Heart className="lobby-feature-header-icon" aria-hidden="true" />
      </header>

      <div className="lobby-feature-status" role="status">
        <Heart aria-hidden="true" />
        <span>Support does not spend wallet funds or create server assets.</span>
      </div>

      <div className="lobby-feature-section-heading">
        <h2>Model Factions</h2>
        <span>Total local support: {total.toLocaleString('en-US')}</span>
      </div>

      <section className="lobby-faction-grid" aria-label="Model factions and local support">
        {factions.map(({ id, name, introduction, points, Icon }) => (
          <article className={`lobby-feature-card lobby-faction-card lobby-faction-card--${id}`} key={id}>
            <Icon aria-hidden="true" />
            <h3>{name}</h3>
            <p>{introduction}</p>
            <strong>{points.toLocaleString('en-US')}</strong>
            <span>Local Support Points</span>
            <button className="lobby-feature-action" type="button" onClick={() => onContribute(id)}>
              <Heart aria-hidden="true" />
              Local Support +1
            </button>
          </article>
        ))}
      </section>

      <section className="lobby-faction-reward-progress" aria-labelledby="contribution-reward-progress">
        <div className="lobby-feature-section-heading">
          <h2 id="contribution-reward-progress">Contribution Reward Progress</h2>
          <span>{rewardProgress} / {nextReward.points} local points</span>
        </div>
        <div className="lobby-pass-progress-track" aria-hidden="true">
          <span style={{ width: `${(rewardProgress / nextReward.points) * 100}%` }} />
        </div>
        <strong>Next: {nextReward.label}</strong>
        <small>Support rewards are local previews only.</small>
        <div className="lobby-support-reward-list" aria-label="Support reward previews">
          {SUPPORT_REWARDS.map(reward => (
            <span key={reward.points}><Medal aria-hidden="true" />{reward.points} points · {reward.label}</span>
          ))}
        </div>
      </section>

      <section className="lobby-faction-operations-grid">
        <div className="lobby-faction-operation" aria-labelledby="local-faction-leaderboard">
          <div className="lobby-feature-section-heading">
            <h2 id="local-faction-leaderboard"><Trophy aria-hidden="true" />Local Support Leaderboard</h2>
          </div>
          <ol>
            {leaderboard.map((faction, index) => (
              <li key={faction.id}><span>#{index + 1} {faction.name}</span><strong>{faction.points}</strong></li>
            ))}
          </ol>
        </div>

        <div className="lobby-faction-operation" aria-labelledby="faction-daily-tasks">
          <div className="lobby-feature-section-heading">
            <h2 id="faction-daily-tasks"><ListChecks aria-hidden="true" />Daily Tasks</h2>
          </div>
          <ul>
            <li><span>Complete your first local support</span><strong>{Math.min(total, 1)} / 1</strong></li>
            <li><span>Contribute local support 3 times</span><strong>{Math.min(total, 3)} / 3</strong></li>
            <li><span>Support 2 model factions</span><strong>{Math.min(supportedFactionCount, 2)} / 2</strong></li>
          </ul>
        </div>
      </section>

      <section className="lobby-feature-unavailable" aria-labelledby="faction-global-support">
        <Lock aria-hidden="true" />
        <div>
          <h2 id="faction-global-support">Global Leaderboard and Real Rewards</h2>
          <span>Unavailable · No wallet or server writes</span>
        </div>
        <button type="button" disabled>Cannot Contribute</button>
      </section>
    </main>
  );
};

export default FactionSupportView;
