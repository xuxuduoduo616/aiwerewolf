import React from 'react';
import type { PhaseCue, TimeOfDay } from '../motion/phaseCues';

interface Props {
  timeOfDay: TimeOfDay;
  cue: (PhaseCue & { id: number }) | null;
}

/**
 * Day/night veil plus the transient phase banner. Both layers are fixed,
 * pointer-transparent, and animate opacity/transform only so they stay on
 * the compositor even above blurred panels.
 */
const PhaseAtmosphere: React.FC<Props> = ({ timeOfDay, cue }) => (
  <>
    <div className="phase-veil" data-time={timeOfDay} aria-hidden="true" />
    <div className="phase-banner-region" role="status" aria-live="polite">
      {cue && (
        <div key={cue.id} className={`phase-banner phase-banner--${cue.kind}`}>
          <strong>{cue.title}</strong>
          <span>{cue.subtitle}</span>
        </div>
      )}
    </div>
  </>
);

export default PhaseAtmosphere;
