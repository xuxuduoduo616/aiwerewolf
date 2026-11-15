import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { ParticlesProvider } from '@tsparticles/react';
import ParticleField from './motion/ParticleField';
import { initParticles } from './motion/particleEngine';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ParticlesProvider init={initParticles}>
      <ParticleField />
    </ParticlesProvider>
    <div className="app-layer">
      <App />
    </div>
  </React.StrictMode>
);
