import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import DeferredParticles from './motion/DeferredParticles';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DeferredParticles />
    <div className="app-layer">
      <App />
    </div>
  </React.StrictMode>
);
