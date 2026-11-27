import React, { useEffect, useRef } from 'react';
import type { InkParticleProfile } from './inkSceneConfig';

type ParticleKind = 'leaf' | 'petal' | 'ember' | 'mote';

interface InkParticle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  rotSpeed: number;
  phase: number;
  phaseSpeed: number;
  alpha: number;
  depth: number;
}

interface Props {
  profile: InkParticleProfile;
  disabled?: boolean;
}

const createParticle = (kind: ParticleKind, width: number, height: number, profile: InkParticleProfile): InkParticle => {
  const depth = 0.45 + Math.random() * 0.75;
  const x = Math.random() * width;
  const y = Math.random() * height;
  const phase = Math.random() * Math.PI * 2;

  if (kind === 'leaf') {
    return {
      kind,
      x,
      y,
      vx: (profile.windX * 26 - 10 + Math.random() * 14) * depth,
      vy: (profile.windY * 22 + 12 + Math.random() * 14) * depth,
      size: (5.5 + Math.random() * 5.5) * depth,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 1.1,
      phase,
      phaseSpeed: 1.1 + Math.random() * 0.9,
      alpha: 0.34 + Math.random() * 0.34,
      depth,
    };
  }
  if (kind === 'petal') {
    return {
      kind,
      x,
      y,
      vx: (profile.windX * 20 - 6 + Math.random() * 12) * depth,
      vy: (profile.windY * 18 + 9 + Math.random() * 11) * depth,
      size: (3.4 + Math.random() * 3.4) * depth,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 1.4,
      phase,
      phaseSpeed: 1.3 + Math.random() * 1.0,
      alpha: 0.42 + Math.random() * 0.36,
      depth,
    };
  }
  if (kind === 'ember') {
    return {
      kind,
      x,
      y,
      vx: (profile.windX * 8 + (Math.random() - 0.5) * 10) * depth,
      vy: -(7 + Math.random() * 13) * depth,
      size: (1.2 + Math.random() * 1.9) * depth,
      rotation: 0,
      rotSpeed: 0,
      phase,
      phaseSpeed: 1.8 + Math.random() * 1.6,
      alpha: 0.25 + Math.random() * 0.45,
      depth,
    };
  }
  return {
    kind: 'mote',
    x,
    y,
    vx: (profile.windX * 12 + (Math.random() - 0.5) * 9) * depth,
    vy: (profile.windY * 8 + (Math.random() - 0.5) * 8) * depth,
    size: (0.9 + Math.random() * 1.8) * depth,
    rotation: 0,
    rotSpeed: 0,
    phase,
    phaseSpeed: 0.7 + Math.random() * 0.9,
    alpha: 0.16 + Math.random() * 0.28,
    depth,
  };
};

const InkParticlesCanvas: React.FC<Props> = ({ profile, disabled = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (disabled) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const scaleCount = width < 768 ? 0.55 : 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, Math.floor(rect.width || window.innerWidth));
      height = Math.max(1, Math.floor(rect.height || window.innerHeight));
      dpr = Math.min(window.devicePixelRatio || 1, width < 768 ? 1.25 : 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const particles: InkParticle[] = [];
    const pushMany = (kind: ParticleKind, count: number) => {
      const total = Math.max(0, Math.round(count * scaleCount));
      for (let i = 0; i < total; i += 1) {
        particles.push(createParticle(kind, width, height, profile));
      }
    };
    pushMany('leaf', profile.leaves);
    pushMany('petal', profile.petals);
    pushMany('ember', profile.embers);
    pushMany('mote', profile.inkMotes);

    let pointerX = -9999;
    let pointerY = -9999;
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pointerX = event.clientX;
      pointerY = event.clientY;
    };
    const onPointerLeave = () => {
      pointerX = -9999;
      pointerY = -9999;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('resize', resize, { passive: true });

    let rafId = 0;
    let lastTime = performance.now();
    let elapsed = 0;
    let frameAcc = 0;
    const minFrameInterval = width < 768 ? 1 / 24 : 1 / 32;

    // Pre-render soft amber ember sprite once so draw calls never allocate gradients per frame.
    const emberSprite = document.createElement('canvas');
    emberSprite.width = 24;
    emberSprite.height = 24;
    const eCtx = emberSprite.getContext('2d');
    if (eCtx) {
      const grad = eCtx.createRadialGradient(12, 12, 0, 12, 12, 12);
      grad.addColorStop(0, 'rgba(248, 212, 140, 1)');
      grad.addColorStop(0.42, 'rgba(220, 148, 66, 0.48)');
      grad.addColorStop(1, 'rgba(220, 148, 66, 0)');
      eCtx.fillStyle = grad;
      eCtx.fillRect(0, 0, 24, 24);
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      if (!document.hidden) {
        elapsed += dt;
        frameAcc += dt;
        if (frameAcc < minFrameInterval) {
          rafId = window.requestAnimationFrame(tick);
          return;
        }
        const step = frameAcc;
        frameAcc = 0;
        ctx.clearRect(0, 0, width, height);
        const globalGust = Math.sin(elapsed * 0.42) * 8 + Math.cos(elapsed * 0.71) * 4;

        for (const p of particles) {
          p.phase += p.phaseSpeed * step;
          p.rotation += p.rotSpeed * step;

          // Subtle breeze deflection around desktop cursor.
          let pushX = 0;
          let pushY = 0;
          if (pointerX > -500) {
            const dx = p.x - pointerX;
            const dy = p.y - pointerY;
            const distSq = dx * dx + dy * dy;
            if (distSq < 19600 && distSq > 4) {
              const dist = Math.sqrt(distSq);
              const force = (1 - dist / 140) * 34 * p.depth;
              pushX = (dx / dist) * force;
              pushY = (dy / dist) * force;
            }
          }

          p.x += (p.vx + globalGust * p.depth * 0.45 + Math.sin(p.phase) * 7 + pushX) * step;
          p.y += (p.vy + Math.cos(p.phase * 0.8) * 4 + pushY) * step;

          const pad = 28;
          if (p.x < -pad) p.x = width + pad;
          else if (p.x > width + pad) p.x = -pad;
          if (p.y < -pad) p.y = height + pad;
          else if (p.y > height + pad) p.y = -pad;

          const pulse = 0.65 + 0.35 * Math.sin(p.phase);

          if (p.kind === 'leaf') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(p.phase * 0.7)));
            ctx.fillStyle = `rgba(28, 32, 38, ${p.alpha})`;
            ctx.strokeStyle = `rgba(186, 194, 202, ${p.alpha * 0.42})`;
            ctx.lineWidth = 0.6;
            ctx.beginPath();
            ctx.moveTo(-p.size * 1.4, 0);
            ctx.quadraticCurveTo(0, -p.size * 0.48, p.size * 1.4, 0);
            ctx.quadraticCurveTo(0, p.size * 0.42, -p.size * 1.4, 0);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          } else if (p.kind === 'petal') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rotation);
            ctx.scale(1, 0.52 + 0.48 * Math.abs(Math.sin(p.phase)));
            ctx.fillStyle = `rgba(176, 62, 58, ${p.alpha * pulse})`;
            ctx.beginPath();
            ctx.ellipse(0, 0, p.size * 1.05, p.size * 0.58, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          } else if (p.kind === 'ember') {
            const radius = p.size * 3.4;
            ctx.save();
            ctx.globalAlpha = p.alpha * pulse;
            ctx.drawImage(emberSprite, p.x - radius, p.y - radius, radius * 2, radius * 2);
            ctx.restore();
          } else {
            ctx.fillStyle = `rgba(206, 212, 220, ${p.alpha * pulse})`;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', resize);
    };
  }, [disabled, profile]);

  if (disabled) return null;

  return <canvas ref={canvasRef} className="ink-world-particles" aria-hidden="true" />;
};

export default InkParticlesCanvas;
