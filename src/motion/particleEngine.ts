import type { Engine } from '@tsparticles/engine';
import { loadSlim } from '@tsparticles/slim';

// The provider shares initialization across mounts, including StrictMode.
export const initParticles = async (engine: Engine): Promise<void> => {
  await loadSlim(engine);
};
