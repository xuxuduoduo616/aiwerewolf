import React, { useEffect, useRef, useState } from 'react';
import {
  INK_FOREGROUND_LAYERS,
  INK_SCENES,
  type InkSceneId,
} from './inkSceneConfig';
import { InkWebGLRenderer } from './inkSceneShader';
import InkParticlesCanvas from './InkParticlesCanvas';
import '../styles/ink-world.css';

interface Props {
  sceneId: InkSceneId;
  className?: string;
}

const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return reduced;
};

const prefetchedUrls = new Set<string>();

const prefetchUrl = (url: string) => {
  if (typeof window === 'undefined' || prefetchedUrls.has(url)) return;
  prefetchedUrls.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
};

/**
 * Reusable dynamic Oriental ink-wash world backdrop.
 * Combines 2K concept art, WebGL localized wind/water/mist/moonlight shaders,
 * independent foreground botanical layers, and living ambient ink/petal particles.
 */
const InkWorldBackdrop: React.FC<Props> = ({ sceneId, className }) => {
  const spec = INK_SCENES[sceneId];
  const reducedMotion = useReducedMotion();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<InkWebGLRenderer | null>(null);
  const [webglReady, setWebglReady] = useState(false);

  // Initialize WebGL renderer once when motion is allowed.
  useEffect(() => {
    if (reducedMotion || typeof window === 'undefined') {
      setWebglReady(false);
      return undefined;
    }
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const renderer = InkWebGLRenderer.create(canvas, INK_SCENES[sceneId]);
    if (!renderer) {
      setWebglReady(false);
      return undefined;
    }

    rendererRef.current = renderer;
    renderer.resize();
    renderer.setScene(INK_SCENES[sceneId], () => setWebglReady(true));
    renderer.start();

    const onResize = () => renderer.resize();
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const nx = (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2;
      const ny = (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2;
      renderer.setParallax(nx, ny);
    };
    const onContextLost = (event: Event) => {
      event.preventDefault();
      setWebglReady(false);
    };

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('webglcontextlost', onContextLost);

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      renderer.dispose();
      rendererRef.current = null;
      setWebglReady(false);
    };
    // Intentionally initialize once per reducedMotion toggle; scene swaps happen below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion]);

  // Smoothly crossfade scenes without tearing down the WebGL context.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    renderer.setScene(spec, () => setWebglReady(true));
  }, [spec]);

  // Lazily warm adjacent scenes during idle time so page switches feel instant.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const targets: InkSceneId[] = sceneId === 'sign-in'
      ? ['lobby']
      : sceneId === 'lobby'
        ? ['match-setup', 'shop', 'profile', 'village']
        : sceneId === 'match-setup'
          ? ['game-night', 'game-day']
          : [];
    if (targets.length === 0) return undefined;

    const warm = () => {
      for (const id of targets) prefetchUrl(INK_SCENES[id].imageSrc);
    };
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === 'function') {
      const handle = win.requestIdleCallback(warm, { timeout: 2200 });
      return () => win.cancelIdleCallback?.(handle);
    }
    const timer = window.setTimeout(warm, 900);
    return () => window.clearTimeout(timer);
  }, [sceneId]);

  const objectPositionDesktop = `${Math.round(spec.desktopFocal[0] * 100)}% ${Math.round(spec.desktopFocal[1] * 100)}%`;
  const objectPositionMobile = `${Math.round(spec.mobileFocal[0] * 100)}% ${Math.round(spec.mobileFocal[1] * 100)}%`;

  return (
    <div
      className={className ? `ink-world ${className}` : 'ink-world'}
      data-ink-scene={sceneId}
      data-webgl-active={webglReady ? 'true' : 'false'}
      aria-hidden="true"
      style={{
        '--ink-fallback': spec.fallbackGradient,
        '--ink-scrim-opacity': String(spec.scrimOpacity),
        '--ink-focal-desktop': objectPositionDesktop,
        '--ink-focal-mobile': objectPositionMobile,
        '--ink-fg-opacity': String(spec.foreground.opacity),
      } as React.CSSProperties}
    >
      {/* Shared zero-footprint SVG dry-brush (feibai) edge filter for hero ink-wash typography */}
      <svg
        aria-hidden="true"
        width="0"
        height="0"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
      >
        <defs>
          <filter id="ink-brush-edge" x="-6%" y="-6%" width="112%" height="112%">
            <feTurbulence type="fractalNoise" baseFrequency="0.042" numOctaves="3" seed="7" result="inkNoise" />
            <feDisplacementMap in="SourceGraphic" in2="inkNoise" scale="1.35" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
      </svg>

      {/* Instant-paint raster base & crisp reduced-motion / non-WebGL fallback */}
      <img
        className="ink-world-still"
        src={spec.imageSrc}
        alt=""
        decoding="async"
      />

      {/* GPU living shader layer (wind sway, cloth flutter, water ripples, FBM mist, moonlight) */}
      {!reducedMotion && (
        <canvas
          ref={canvasRef}
          className={`ink-world-webgl${webglReady ? ' is-ready' : ''}`}
        />
      )}

      {/* Subtle ambient drifting CSS mist veil (enhances depth & supports non-WebGL fallback) */}
      <div className="ink-world-mist ink-world-mist--far" />
      <div className="ink-world-mist ink-world-mist--near" />

      {/* Independent transparent foreground botanical layers */}
      {spec.foreground.pineTop && (
        <img
          className="ink-world-layer ink-world-layer--pine"
          src={INK_FOREGROUND_LAYERS.pineTop}
          alt=""
          decoding="async"
        />
      )}
      {spec.foreground.bambooRight && (
        <img
          className="ink-world-layer ink-world-layer--bamboo"
          src={INK_FOREGROUND_LAYERS.bambooRight}
          alt=""
          decoding="async"
        />
      )}

      {/* Living ambient ink motes, bamboo leaves, plum petals, and lantern embers */}
      <InkParticlesCanvas profile={spec.particles} disabled={reducedMotion} />

      {/* Atmospheric Xuan-paper vignette & readability scrim */}
      <div className="ink-world-scrim" />
    </div>
  );
};

export default InkWorldBackdrop;
