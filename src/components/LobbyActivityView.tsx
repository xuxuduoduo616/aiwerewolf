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
    title: 'Daily Roll Call',
    schedule: 'Available today',
    deadline: 'Refreshes daily at 23:59',
    countdown: '05:42:18 remaining',
    localRewardLabel: 'Villager Mark',
  },
  {
    id: 'seven-day-login',
    category: 'current',
    type: 'login',
    title: 'Seven-Day Login Reward',
    schedule: 'Login reward · Day 3',
    deadline: 'Ends Sunday at 23:59',
    countdown: '2 days 05:42 remaining',
    localRewardLabel: 'Traveler Check-In Badge',
  },
  {
    id: 'full-moon-festival',
    category: 'limited',
    type: 'holiday',
    title: 'Full Moon Festival',
    schedule: 'Festival event · Limited time',
    deadline: 'Ends July 31 at 23:59',
    countdown: '7 days 05:42 remaining',
    localRewardLabel: 'Full Moon Festival Badge',
  },
  {
    id: 'summer-deduction',
    category: 'limited',
    type: 'regular',
    title: 'Midsummer Deduction Cup',
    schedule: 'Limited-time event',
    deadline: 'Ends August 3 at 20:00',
    countdown: '10 days 01:43 remaining',
    localRewardLabel: 'Deduction Cup Badge',
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
        <button className="lobby-feature-icon-button" type="button" onClick={onBack} aria-label="Back" title="Back">
          <ArrowLeft aria-hidden="true" />
        </button>
      ) : <span className="lobby-feature-header-spacer" />}
      <div>
        <h1 id="lobby-activity-title">Activities</h1>
        <span className="lobby-feature-kicker">Local Activity Progress</span>
      </div>
      <CalendarDays className="lobby-feature-header-icon" aria-hidden="true" />
    </header>

    <div className="lobby-feature-status" role="status">
      <Gift aria-hidden="true" />
      <span>Claiming updates only this account's local preview.</span>
    </div>

    {(['current', 'limited'] as const).map(category => (
      <section className="lobby-activity-section" aria-labelledby={`activity-${category}`} key={category}>
        <div className="lobby-feature-section-heading">
          <h2 id={`activity-${category}`}>{category === 'current' ? 'Current Activities' : 'Limited Activities'}</h2>
          <span>{category === 'current' ? 'Available now' : 'Closes at expiration'}</span>
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
                    {activity.type === 'login' ? 'Login Reward' : activity.type === 'holiday' ? 'Festival Event' : 'Activity'}
                  </span>
                  <h3>{activity.title}</h3>
                  <span className="lobby-feature-meta"><Clock3 aria-hidden="true" />{activity.schedule}</span>
                  <span className="lobby-feature-meta"><CalendarDays aria-hidden="true" />{activity.deadline}</span>
                  <span className="lobby-activity-countdown"><Timer aria-hidden="true" />{activity.countdown}</span>
                  <span className="lobby-feature-local-reward">{activity.localRewardLabel} · Local preview</span>
                </div>
                <button
                  className="lobby-feature-action"
                  type="button"
                  disabled={claimed}
                  onClick={() => onClaimActivity(activity.id)}
                >
                  {claimed ? <Check aria-hidden="true" /> : <Gift aria-hidden="true" />}
                  {claimed ? 'Recorded Locally' : 'Mark as Claimed'}
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
        <h2 id="activity-real-rewards">Real-Value Rewards</h2>
        <span>Unavailable</span>
      </div>
      <button type="button" disabled>Cannot Claim</button>
    </section>
  </main>
);

export default LobbyActivityView;
