import React from 'react';
import { ArrowLeft, CalendarDays, Check, Clock3, Gift, Lock, LogIn, PartyPopper, Timer } from 'lucide-react';
import '../styles/lobby-features.css';

export interface LobbyActivity {
  id: string;
  category: 'current' | 'limited';
  type: 'login' | 'regular' | 'holiday';
  title: string;
  schedule: string;
  deadline: string;
  countdown: string;
  localRewardLabel: string;
}

export const LOBBY_ACTIVITIES: readonly LobbyActivity[] = [
  {
    id: 'daily-roll-call',
    category: 'current',
    type: 'regular',
    title: '每日点名',
    schedule: '今日有效',
    deadline: '每日 23:59 刷新',
    countdown: '倒计时 05:42:18',
    localRewardLabel: '村民印记',
  },
  {
    id: 'seven-day-login',
    category: 'current',
    type: 'login',
    title: '七日登录奖励',
    schedule: '登录奖励 · 第 3 天',
    deadline: '本周日 23:59 截止',
    countdown: '剩余 2天 05:42',
    localRewardLabel: '旅人签到章',
  },
  {
    id: 'full-moon-festival',
    category: 'limited',
    type: 'holiday',
    title: '满月节庆典',
    schedule: '节日活动 · 限时开放',
    deadline: '7月31日 23:59 截止',
    countdown: '剩余 7天 05:42',
    localRewardLabel: '满月庆典徽记',
  },
  {
    id: 'summer-deduction',
    category: 'limited',
    type: 'regular',
    title: '盛夏推理赛',
    schedule: '限时活动',
    deadline: '8月3日 20:00 截止',
    countdown: '剩余 10天 01:43',
    localRewardLabel: '推理家纪念章',
  },
] as const;

export interface LobbyActivityViewProps {
  claimedActivityIds: readonly string[];
  onClaimActivity: (activityId: string) => void;
  onBack?: () => void;
}

const LobbyActivityView: React.FC<LobbyActivityViewProps> = ({
  claimedActivityIds,
  onClaimActivity,
  onBack,
}) => (
  <main className="lobby-feature-page" aria-labelledby="lobby-activity-title">
    <header className="lobby-feature-header">
      {onBack ? (
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="返回" title="返回">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="lobby-activity-title">活动</h1>
        <span className="lobby-feature-kicker">本地活动记录</span>
      </div>
      <CalendarDays className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <div className="lobby-feature-status" role="status">
      <Gift aria-hidden="true" />
      <span>领取仅更新当前账号的本地展示</span>
    </div>

    {(['current', 'limited'] as const).map(category => (
      <section className="lobby-activity-section" aria-labelledby={`activity-${category}`} key={category}>
        <div className="lobby-feature-section-heading">
          <h2 id={`activity-${category}`}>{category === 'current' ? '当前活动' : '限时活动'}</h2>
          <span>{category === 'current' ? '本期可参与' : '到期后关闭'}</span>
        </div>
        <div className="lobby-feature-list">
          {LOBBY_ACTIVITIES.filter(activity => activity.category === category).map(activity => {
            const claimed = claimedActivityIds.includes(activity.id);
            const ActivityIcon = activity.type === 'login'
              ? LogIn
              : activity.type === 'holiday' ? PartyPopper : CalendarDays;
            return (
              <article className="lobby-feature-card lobby-feature-activity-card" key={activity.id}>
                <div className="lobby-feature-card-icon"><ActivityIcon aria-hidden="true" /></div>
                <div className="lobby-feature-card-body">
                  <span className="lobby-feature-tag">
                    {activity.type === 'login' ? '登录奖励' : activity.type === 'holiday' ? '节日活动' : '活动'}
                  </span>
                  <h3>{activity.title}</h3>
                  <span className="lobby-feature-meta"><Clock3 aria-hidden="true" />{activity.schedule}</span>
                  <span className="lobby-feature-meta"><CalendarDays aria-hidden="true" />{activity.deadline}</span>
                  <span className="lobby-activity-countdown"><Timer aria-hidden="true" />{activity.countdown}</span>
                  <span className="lobby-feature-local-reward">{activity.localRewardLabel} · 本地展示</span>
                </div>
                <button
                  className="lobby-feature-action"
                  type="button"
                  disabled={claimed}
                  onClick={() => onClaimActivity(activity.id)}
                >
                  {claimed ? <Check aria-hidden="true" /> : <Gift aria-hidden="true" />}
                  {claimed ? '本地已记录' : '标记领取'}
                </button>
              </article>
            );
          })}
        </div>
      </section>
    ))}

    <section className="lobby-feature-unavailable" aria-labelledby="activity-real-rewards">
      <Lock aria-hidden="true" />
      <div>
        <h2 id="activity-real-rewards">真实经济奖励</h2>
        <span>未开放</span>
      </div>
      <button type="button" disabled>不可领取</button>
    </section>
  </main>
);

export default LobbyActivityView;
