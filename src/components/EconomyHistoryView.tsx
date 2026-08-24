import React from 'react';
import { ArrowLeft, CircleDollarSign, Gem, ScrollText } from 'lucide-react';
import { describeEconomyEvent, type GuestEconomyEvent } from '../economy/ledger';
import type { AccountEconomyPhase, AccountLedgerRow } from '../economy/accountEconomy';

interface Props {
  events: readonly GuestEconomyEvent[];
  accountLedger: readonly AccountLedgerRow[];
  isGuest: boolean;
  phase: AccountEconomyPhase | 'ready';
  statusMessage: string;
  feedback: string;
  nextCursor: string | null;
  loadingMore: boolean;
  onLoadMore: () => Promise<boolean>;
  onRefresh: () => void | Promise<boolean>;
  onBack: () => void;
}

const signed = (value: number): string => value > 0 ? `+${value}` : String(value);

const accountEventLabels: Record<string, string> = {
  check_in: 'Daily check-in',
  check_in_milestone: 'Check-in milestone',
  onboarding: 'New-player guide finished',
  gameplay_reward: 'Completed match reward',
  skin_unlock: 'Cosmetic unlocked',
};

const EconomyHistoryView: React.FC<Props> = ({
  events,
  accountLedger,
  isGuest,
  phase,
  statusMessage,
  feedback,
  nextCursor,
  loadingMore,
  onLoadMore,
  onRefresh,
  onBack,
}) => (
  <section className="economy-page economy-history-page" aria-labelledby="economy-history-title">
    <header className="economy-page-header">
      <button type="button" className="economy-icon-button" onClick={onBack} aria-label="Back">
        <ArrowLeft aria-hidden="true" />
      </button>
      <div>
        <p className="economy-eyebrow">{isGuest ? 'Verified local ledger' : 'Verified account ledger'}</p>
        <h1 id="economy-history-title">Economy History</h1>
      </div>
      <ScrollText aria-hidden="true" />
    </header>

    {!isGuest && phase !== 'ready' ? (
      <div className="economy-empty-state" role="status">
        <ScrollText aria-hidden="true" />
        <h2>Account history unavailable</h2>
        <p>{statusMessage} Guest history is never used as an account fallback.</p>
        <button type="button" className="economy-secondary-action" onClick={() => { void onRefresh(); }}>Refresh Account State</button>
      </div>
    ) : (isGuest ? events.length === 0 : accountLedger.length === 0) ? (
      <div className="economy-empty-state">
        <ScrollText aria-hidden="true" />
        <h2>{isGuest ? 'No local events yet' : 'No account ledger events yet'}</h2>
        <p>Check-ins, guide rewards, completed-match rewards, unlocks, and equipped cosmetics will appear here.</p>
      </div>
    ) : isGuest ? (
      <ol className="economy-history-list" aria-label="Newest economy events first">
        {[...events].reverse().map(event => (
          <li key={event.id}>
            <div className="economy-history-copy">
              <strong>{describeEconomyEvent(event)}</strong>
              <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
            </div>
            <dl className="economy-history-deltas">
              <div aria-label={`Coins ${signed(event.delta.coins)}`}><CircleDollarSign aria-hidden="true" /><dt>Coins</dt><dd>{signed(event.delta.coins)}</dd></div>
              <div aria-label={`Crystals ${signed(event.delta.crystals)}`}><Gem aria-hidden="true" /><dt>Crystals</dt><dd>{signed(event.delta.crystals)}</dd></div>
            </dl>
          </li>
        ))}
      </ol>
    ) : (
      <>
        <ol className="economy-history-list" aria-label="Newest account economy events first">
          {accountLedger.map(row => (
            <li key={row.id}>
              <div className="economy-history-copy">
                <strong>{accountEventLabels[row.eventType] ?? 'Account economy event'}</strong>
                <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
              </div>
              <dl className="economy-history-deltas">
                <div aria-label={`Coins ${row.currency === 'coins' ? signed(row.amount) : '0'}`}><CircleDollarSign aria-hidden="true" /><dt>Coins</dt><dd>{row.currency === 'coins' ? signed(row.amount) : '0'}</dd></div>
                <div aria-label={`Crystals ${row.currency === 'crystals' ? signed(row.amount) : '0'}`}><Gem aria-hidden="true" /><dt>Crystals</dt><dd>{row.currency === 'crystals' ? signed(row.amount) : '0'}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
        {nextCursor && (
          <button type="button" className="economy-secondary-action" disabled={loadingMore} onClick={() => { void onLoadMore(); }}>
            {loadingMore ? 'Loading History...' : 'Load More'}
          </button>
        )}
        <p className="economy-live-feedback" role="status" aria-live="polite">{feedback}</p>
      </>
    )}
  </section>
);

export default EconomyHistoryView;
