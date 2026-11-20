import React, { Suspense, useEffect, useState } from 'react';

const ParticleLayer = React.lazy(() => import('./ParticleLayer'));

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/** Upper bound so the field still appears on busy pages without idle time. */
export const PARTICLE_IDLE_TIMEOUT_MS = 1500;

/**
 * Decorative background only: wait until the first screen is interactive,
 * then fetch and start the particle engine so it never competes with the
 * login form or lobby for the main thread or the network.
 */
export const scheduleWhenIdle = (callback: () => void, win: IdleWindow = window): (() => void) => {
  if (typeof win.requestIdleCallback === 'function') {
    const handle = win.requestIdleCallback(callback, { timeout: PARTICLE_IDLE_TIMEOUT_MS });
    return () => win.cancelIdleCallback?.(handle);
  }
  const handle = win.setTimeout(callback, 400);
  return () => win.clearTimeout(handle);
};

const DeferredParticles = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    // Wait for load so the field never delays first paint of the app.
    let cancelIdle: (() => void) | null = null;
    const start = () => { cancelIdle = scheduleWhenIdle(() => setReady(true)); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    return () => {
      window.removeEventListener('load', start);
      cancelIdle?.();
    };
  }, []);

  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <ParticleLayer />
    </Suspense>
  );
};

export default DeferredParticles;
