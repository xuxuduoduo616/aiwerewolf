import React, { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize } from 'lucide-react';

export default function MatchFullscreenButton() {
  const [fullscreen, setFullscreen] = useState(false);
  const ownsFullscreen = useRef(false);

  useEffect(() => {
    const update = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      if (!active) ownsFullscreen.current = false;
    };
    update();
    document.addEventListener('fullscreenchange', update);
    return () => {
      document.removeEventListener('fullscreenchange', update);
      if (ownsFullscreen.current && document.fullscreenElement === document.documentElement) {
        void document.exitFullscreen().catch(() => {});
      }
    };
  }, []);

  if (typeof document === 'undefined' || !document.fullscreenEnabled) return null;

  const toggle = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else {
        // The root includes portaled guides, dialogs, and match results.
        await document.documentElement.requestFullscreen();
        ownsFullscreen.current = true;
      }
    } catch {
      // The room continues to work in desktop mode if the browser declines.
    }
  };

  return (
    <button type="button" className="game-fullscreen-button icon-button" onClick={toggle}
      aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}>
      {fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />}
      <span>{fullscreen ? 'Window' : 'Fullscreen'}</span>
    </button>
  );
}
