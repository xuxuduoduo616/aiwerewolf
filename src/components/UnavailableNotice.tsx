import React from 'react';
import { ArrowLeft, LockKeyhole } from 'lucide-react';

export interface UnavailableNoticeProps {
  title: string;
  description: string;
  onBack: () => void;
  statusLabel?: string;
}

const UnavailableNotice: React.FC<UnavailableNoticeProps> = ({
  title,
  description,
  onBack,
  statusLabel = 'Unavailable',
}) => (
  <main className="app-unavailable" aria-labelledby="app-unavailable-title">
    <button className="app-page-back" type="button" onClick={onBack} aria-label="Back">
      <ArrowLeft aria-hidden="true" />
      <span>Back</span>
    </button>
    <div className="app-unavailable-symbol" aria-hidden="true">
      <LockKeyhole />
    </div>
    <p className="app-page-kicker">{statusLabel}</p>
    <h1 id="app-unavailable-title">{title}</h1>
    <p>{description}</p>
    <button className="app-secondary-button" type="button" disabled>
      {statusLabel}
    </button>
  </main>
);

export default UnavailableNotice;
