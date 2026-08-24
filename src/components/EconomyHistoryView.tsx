import React from 'react';
import { ArrowLeft, CircleDollarSign, Gem, ScrollText } from 'lucide-react';
import { describeEconomyEvent, type GuestEconomyEvent } from '../economy/ledger';
import { ACCOUNT_ECONOMY_UNAVAILABLE } from '../hooks/useGuestEconomy';

interface Props {
  events: readonly GuestEconomyEvent[];
  isGuest: boolean;
  onBack: () => void;
}

const signed = (value: number): string => value > 0 ? `+${value}` : String(value);

const EconomyHistoryView: React.FC<Props> = ({ events, isGuest, onBack }) => (
  <section className="economy-page economy-history-page" aria-labelledby="economy-history-title">
    <header className="economy-page-header">
      <button type="button" className="economy-icon-button" onClick={onBack} aria-label="Back">
        <ArrowLeft aria-hidden="true" />
      </button>
      <div>
        <p className="economy-eyebrow">Verified local ledger</p>
        <h1 id="economy-history-title">Economy History</h1>
      </div>
      <ScrollText aria-hidden="true" />
    </header>

    {!isGuest ? (
      <p className="economy-unavailable" role="status">{ACCOUNT_ECONOMY_UNAVAILABLE} Account history is not replaced with guest data.</p>
    ) : events.length === 0 ? (
      <div className="economy-empty-state">
        <ScrollText aria-hidden="true" />
        <h2>No local events yet</h2>
        <p>Check-ins, guide rewards, completed-match rewards, unlocks, and equipped cosmetics will appear here.</p>
      </div>
    ) : (
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
    )}
  </section>
);

export default EconomyHistoryView;
