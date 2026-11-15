import type { ISourceOptions, RecursivePartial } from '@tsparticles/engine';
import type { IInteractivityOptions } from '@tsparticles/plugin-interactivity';
import type { IRepulse } from '@tsparticles/interaction-external-repulse';
import type { ILinks } from '@tsparticles/interaction-particles-links';

export type ParticleProfile = {
  compact: boolean;
  coarsePointer: boolean;
  reducedMotion: boolean;
};

export const PARTICLE_COLORS = ['#7c3aed', '#e11d48', '#22d3ee'] as const;

export const buildParticleOptions = ({
  compact,
  coarsePointer,
  reducedMotion,
}: ParticleProfile) => {
  if (reducedMotion) return null;

  const lightweight = compact || coarsePointer;

  return {
    fullScreen: { enable: true, zIndex: 0 },
    fpsLimit: lightweight ? 45 : 60,
    detectRetina: !lightweight,
    pauseOnBlur: true,
    interactivity: {
      // Content sits above the canvas, so hover must be observed on window.
      detectsOn: 'window',
      events: {
        onHover: { enable: !coarsePointer, mode: 'repulse' },
        onClick: { enable: false },
      },
      modes: {
        repulse: {
          distance: lightweight ? 120 : 170,
          duration: lightweight ? 0.4 : 0.55,
          speed: lightweight ? 0.9 : 1.15,
          // Hover recovery is separate from the click-only duration option.
          restore: { enable: true, delay: 0, speed: 0.1, follow: true },
        } satisfies RecursivePartial<IRepulse>,
      },
    } satisfies RecursivePartial<NonNullable<IInteractivityOptions['interactivity']>>,
    particles: {
      // A small preview viewport must not silently shrink 36 particles to six.
      number: { value: lightweight ? 36 : 80, density: { enable: false } },
      paint: { color: { value: [...PARTICLE_COLORS] } },
      links: {
        enable: !lightweight,
        distance: 140,
        color: '#8b5cf6',
        opacity: 0.32,
        width: 1,
      } satisfies RecursivePartial<ILinks>,
      move: {
        enable: true,
        speed: lightweight ? 0.35 : 0.55,
        direction: 'none',
        random: true,
        straight: false,
        outModes: { default: 'out' },
      },
      opacity: { value: { min: 0.5, max: 0.9 } },
      size: { value: { min: 1.2, max: 3.2 } },
      shape: { type: 'circle' },
    },
  } satisfies ISourceOptions;
};
