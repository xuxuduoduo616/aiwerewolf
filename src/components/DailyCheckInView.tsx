import React from 'react';
import { ArrowLeft, CalendarCheck, Check, Clock3, History } from 'lucide-react';
import EconomyBalances from './EconomyBalances';
import {
  CHECK_IN_MILESTONES,
  CHECK_IN_REWARDS,
  getNextCheckInStreak,
  localDayFromDate,
  type EconomyMutationResult,
  type GuestEconomyState,
} from '../economy/ledger';
import { ACCOUNT_ECONOMY_UNAVAILABLE } from '../hooks/useGuestEconomy';

interface Props {
  state: GuestEconomyState;
  coins: number;
  crystals: number;
  isGuest: boolean;
  ledgerCorrupt: boolean;
  feedback: string;
  onCheckIn: () => EconomyMutationResult;
  onOpenHistory: () => void;
  onBack: () => void;
}

const DailyCheckInView: React.FC<Props> = ({
  state,
  coins,
  crystals,
  isGuest,
  ledgerCorrupt,
  feedback,
  onCheckIn,
  onOpenHistory,
  onBack,
}) => {
  const [localToday, setLocalToday] = React.useState(() => localDayFromDate(new Date()));
  React.useEffect(() => {
    const timer = window.setInterval(() => setLocalToday(localDayFromDate(new Date())), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const checkedToday = state.lastCheckInDay === localToday;
  const nextStreak = getNextCheckInStreak(state.lastCheckInDay, state.checkInStreak, localToday);
  const nextTrackDay = ((nextStreak - 1) % CHECK_IN_REWARDS.length) + 1;
  const disabledReason = !isGuest
    ? ACCOUNT_ECONOMY_UNAVAILABLE
    : ledgerCorrupt
      ? 'Local economy data could not be verified. Check-in is disabled without changing the stored ledger.'
      : '';

  return (
    <section className="economy-page check-in-page" aria-labelledby="daily-check-in-title">
      <header className="economy-page-header">
        <button type="button" className="economy-icon-button" onClick={onBack} aria-label="Back to lobby">
          <ArrowLeft aria-hidden="true" />
        </button>
        <div>
          <p className="economy-eyebrow">Local guest rewards</p>
          <h1 id="daily-check-in-title">Daily Check-In</h1>
        </div>
        <button type="button" className="economy-icon-button" onClick={onOpenHistory} aria-label="Open economy history">
          <History aria-hidden="true" />
        </button>
      </header>

      <EconomyBalances coins={coins} crystals={crystals} />

      <div className="check-in-hero ink-panel">
        <CalendarCheck aria-hidden="true" />
        <div>
          <p className="economy-eyebrow">Current continuous streak</p>
          <strong>{state.checkInStreak} {state.checkInStreak === 1 ? 'day' : 'days'}</strong>
          <span>{checkedToday ? 'Today is safely recorded.' : `Next: Day ${nextTrackDay} of the 7-day cycle`}</span>
        </div>
        <button
          type="button"
          className="economy-primary-action"
          onClick={onCheckIn}
          disabled={!isGuest || ledgerCorrupt || checkedToday}
          aria-describedby={disabledReason ? 'check-in-disabled-reason' : undefined}
        >
          {checkedToday ? <><Check aria-hidden="true" /> Checked In Today</> : 'Check In'}
        </button>
      </div>

      {disabledReason && <p id="check-in-disabled-reason" className="economy-unavailable" role="status">{disabledReason}</p>}
      <p className="economy-live-feedback" role="status" aria-live="polite">{feedback}</p>

      <section aria-labelledby="seven-day-track-title">
        <div className="economy-section-heading">
          <div><p className="economy-eyebrow">Repeats after Day 7</p><h2 id="seven-day-track-title">7-Day Reward Track</h2></div>
          <Clock3 aria-hidden="true" />
        </div>
        <ol className="check-in-track">
          {CHECK_IN_REWARDS.map((reward, index) => {
            const day = index + 1;
            const isNext = day === nextTrackDay && !checkedToday;
            const isCurrent = day === ((Math.max(1, state.checkInStreak) - 1) % 7) + 1 && checkedToday;
            return (
              <li key={day} className={`${isNext ? 'is-next' : ''}${isCurrent ? ' is-current' : ''}`}>
                <span>Day {day}</span>
                <strong>{reward} Coins</strong>
                <small>{day === 7 ? 'Cycle finale' : 'Basic currency'}</small>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="milestone-title">
        <div className="economy-section-heading">
          <div><p className="economy-eyebrow">Claimed only once</p><h2 id="milestone-title">Streak Milestones</h2></div>
        </div>
        <div className="milestone-list">
          {CHECK_IN_MILESTONES.map(milestone => {
            const claimed = state.claimedMilestoneDays.includes(milestone.day);
            const progress = claimed ? milestone.day : Math.min(state.checkInStreak, milestone.day);
            return (
              <article key={milestone.day} className={`milestone-card${claimed ? ' is-claimed' : ''}`}>
                <div className="milestone-card-copy">
                  <span>Day {milestone.day}</span>
                  <strong>{milestone.label}</strong>
                  <small>{claimed ? 'Claimed' : `${progress} of ${milestone.day} continuous days`}</small>
                </div>
                <progress value={progress} max={milestone.day} aria-label={`Day ${milestone.day} milestone progress: ${progress} of ${milestone.day}`} />
                <span className="milestone-status">{claimed ? 'Claimed' : 'In progress'}</span>
              </article>
            );
          })}
        </div>
      </section>
    </section>
  );
};

export default DailyCheckInView;
