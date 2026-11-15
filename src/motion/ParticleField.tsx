import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Particles from '@tsparticles/react';
import type { Container } from '@tsparticles/engine';
import { buildParticleOptions } from './particleOptions';

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

const ParticleField = () => {
  const compact = useMediaQuery('(max-width: 767px)');
  const coarsePointer = useMediaQuery('(pointer: coarse)');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const containerRef = useRef<Container>();
  const options = useMemo(
    () => buildParticleOptions({ compact, coarsePointer, reducedMotion }),
    [compact, coarsePointer, reducedMotion],
  );

  const onLoaded = useCallback(async (container?: Container) => {
    containerRef.current = container;
    // Initialization may finish while the tab is already in the background.
    if (document.hidden) container?.pause();
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      const container = containerRef.current;
      if (!container || container.destroyed) return;
      if (document.hidden) container.pause();
      else container.play();
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  if (!options) return null;

  return (
    <Particles
      id="tsparticles"
      options={options}
      particlesLoaded={onLoaded}
      style={{ pointerEvents: 'none' }}
    />
  );
};

export default ParticleField;
