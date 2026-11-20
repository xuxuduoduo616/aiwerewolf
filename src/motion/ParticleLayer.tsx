import { ParticlesProvider } from '@tsparticles/react';
import ParticleField from './ParticleField';
import { initParticles } from './particleEngine';

/** tsparticles engine + field; loaded as its own chunk by DeferredParticles. */
const ParticleLayer = () => (
  <ParticlesProvider init={initParticles}>
    <ParticleField />
  </ParticlesProvider>
);

export default ParticleLayer;
