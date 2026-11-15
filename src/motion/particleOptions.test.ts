import { describe, expect, it } from 'vitest';
import { buildParticleOptions, PARTICLE_COLORS } from './particleOptions';

const desktop = { compact: false, coarsePointer: false, reducedMotion: false };

describe('particle accessibility and interaction profiles', () => {
  it('omits the field for reduced motion regardless of screen and pointer', () => {
    for (const compact of [false, true]) {
      for (const coarsePointer of [false, true]) {
        expect(buildParticleOptions({ compact, coarsePointer, reducedMotion: true })).toBeNull();
      }
    }
  });

  it('repels on window without click actions and restores drifting particles', () => {
    const options = buildParticleOptions(desktop);
    expect(options?.interactivity?.detectsOn).toBe('window');
    expect(options?.interactivity?.events?.onHover).toEqual({ enable: true, mode: 'repulse' });
    expect(options?.interactivity?.events?.onClick).toEqual({ enable: false });
    expect(options?.interactivity?.modes?.repulse).toMatchObject({
      distance: 170, duration: 0.55, speed: 1.15,
      restore: { enable: true, follow: true },
    });
    expect(options?.fullScreen).toEqual({ enable: true, zIndex: 0 });
    expect(options?.fpsLimit).toBe(60);
    expect(options?.pauseOnBlur).toBe(true);
  });

  it('disables hover and links for coarse pointers even on wide screens', () => {
    const options = buildParticleOptions({ ...desktop, coarsePointer: true });
    expect(options?.interactivity?.events?.onHover?.enable).toBe(false);
    expect(options?.particles?.links?.enable).toBe(false);
    expect(options?.particles?.number?.value).toBe(36);
    expect(options?.fpsLimit).toBe(45);
    expect(options?.detectRetina).toBe(false);
  });

  it('limits compact rendering while keeping a fine mouse interactive', () => {
    const options = buildParticleOptions({ ...desktop, compact: true });
    expect(options?.particles?.number?.value).toBe(36);
    expect(options?.particles?.links?.enable).toBe(false);
    expect(options?.detectRetina).toBe(false);
    expect(options?.fpsLimit).toBe(45);
    expect(options?.interactivity?.modes?.repulse?.distance).toBe(120);
    expect(options?.interactivity?.events?.onHover?.enable).toBe(true);
  });

  it('uses exactly the purple, red and cyan particle palette', () => {
    expect(PARTICLE_COLORS).toEqual(['#7c3aed', '#e11d48', '#22d3ee']);
    expect(buildParticleOptions(desktop)?.particles.paint.color.value).toEqual([...PARTICLE_COLORS]);
  });

  it('keeps the particle budget visible instead of scaling it away in small previews', () => {
    for (const compact of [false, true]) {
      const options = buildParticleOptions({ ...desktop, compact });
      expect(options?.particles.number.density.enable).toBe(false);
      expect(options?.particles.opacity.value.min).toBeGreaterThanOrEqual(0.5);
      expect(options?.particles.size.value.min).toBeGreaterThanOrEqual(1);
    }
  });
});
