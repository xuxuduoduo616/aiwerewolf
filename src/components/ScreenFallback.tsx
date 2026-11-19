import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';

interface Props {
  label?: string;
  /** Inside the shell: keep the shell chrome and only fill the content area. */
  inline?: boolean;
}

/** On-theme placeholder for lazy screens (never a white flash). */
const ScreenFallback: React.FC<Props> = ({ label = 'Loading...', inline = false }) => (
  <div className={inline ? 'screen-fallback screen-fallback--inline' : 'screen-fallback'} role="status" aria-live="polite">
    <Loader2 className="screen-fallback-spinner animate-spin" aria-hidden="true" />
    <span>{label}</span>
  </div>
);

/**
 * Mount-only dark unveil: covers the first frames of a freshly mounted
 * screen and fades out (opacity only), then removes itself. Purely
 * decorative and pointer-transparent; skipped under reduced motion via CSS.
 */
export const ScreenCurtain: React.FC = () => {
  const [done, setDone] = useState(false);
  if (done) return null;
  return <div className="screen-curtain" aria-hidden="true" onAnimationEnd={() => setDone(true)} />;
};

export default ScreenFallback;
