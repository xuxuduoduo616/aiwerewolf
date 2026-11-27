import React, { useCallback, useEffect, useRef, useState } from 'react';
import { GripVertical, Music2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { LobbyBgmController } from '../hooks/useLobbyBgm';
import { LOBBY_BGM_TRACKS } from '../services/lobbyBgmTracks';

interface Props {
  bgm?: LobbyBgmController;
}

interface DragPosition {
  left: number;
  top: number;
}

const EDGE_MARGIN = 8;
const DRAG_THRESHOLD_PX = 5;

let persistedSessionPosition: DragPosition | null = null;

const clampPosition = (left: number, top: number, width: number, height: number): DragPosition => {
  if (typeof window === 'undefined') return { left, top };
  const maxLeft = Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN);
  const maxTop = Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN);
  return {
    left: Math.min(Math.max(EDGE_MARGIN, Math.round(left)), Math.round(maxLeft)),
    top: Math.min(Math.max(EDGE_MARGIN, Math.round(top)), Math.round(maxTop)),
  };
};

const FALLBACK_CONTROLLER: LobbyBgmController = {
  track: LOBBY_BGM_TRACKS[0],
  trackIndex: 0,
  trackCount: LOBBY_BGM_TRACKS.length,
  enabled: true,
  isPlaying: false,
  toggle: () => undefined,
  next: () => undefined,
  prev: () => undefined,
};

const LobbyBgmPlayer: React.FC<Props> = ({ bgm = FALLBACK_CONTROLLER }) => {
  const { track, isPlaying, toggle, prev, next } = bgm;
  const rootRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<DragPosition | null>(() => persistedSessionPosition);
  const [dragging, setDragging] = useState(false);
  const suppressClickRef = useRef(false);

  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origLeft: number;
    origTop: number;
    width: number;
    height: number;
    moved: boolean;
  } | null>(null);

  // Re-clamp custom dragged position when viewport resizes
  useEffect(() => {
    if (!position || typeof window === 'undefined') return undefined;
    const onResize = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      const width = rect?.width ?? 232;
      const height = rect?.height ?? 46;
      setPosition(prevPos => {
        if (!prevPos) return null;
        const nextPos = clampPosition(prevPos.left, prevPos.top, width, height);
        persistedSessionPosition = nextPos;
        return nextPos;
      });
    };
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const el = rootRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origLeft: rect.left,
      origTop: rect.top,
      width: rect.width,
      height: rect.height,
      moved: false,
    };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    const el = rootRef.current;
    if (!state || !el || event.pointerId !== state.pointerId) return;

    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;

    if (!state.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      state.moved = true;
      suppressClickRef.current = true;
      setDragging(true);
      try { el.setPointerCapture(event.pointerId); } catch { /* synthetic events */ }
    }

    event.preventDefault();
    const nextPos = clampPosition(state.origLeft + dx, state.origTop + dy, state.width, state.height);
    persistedSessionPosition = nextPos;
    setPosition(nextPos);
  }, []);

  const finishPointerDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const state = dragStateRef.current;
    if (!state || event.pointerId !== state.pointerId) return;
    dragStateRef.current = null;
    if (state.moved) {
      setDragging(false);
      try { rootRef.current?.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
    }
  }, []);

  const resetDefaultPosition = useCallback(() => {
    persistedSessionPosition = null;
    setPosition(null);
  }, []);

  const customStyle: React.CSSProperties | undefined = position
    ? { left: `${position.left}px`, top: `${position.top}px`, right: 'auto' }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={`night-bgm-player${dragging ? ' is-dragging' : ''}${position ? ' is-repositioned' : ''}`}
      data-tour-target="bgm-player"
      data-bgm-playing={isPlaying ? 'true' : 'false'}
      data-bgm-draggable="true"
      role="region"
      aria-label="Background music player"
      style={customStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerDrag}
      onPointerCancel={finishPointerDrag}
      onClickCapture={handleClickCapture}
    >
      <span
        className="night-bgm-grip"
        aria-hidden="true"
        title="Drag to move player · Double-click to reset"
        onDoubleClick={resetDefaultPosition}
      >
        <GripVertical size={13} />
      </span>

      <div className="night-bgm-meta" onDoubleClick={resetDefaultPosition}>
        <span className="night-bgm-icon" aria-hidden="true">
          <Music2 size={14} />
        </span>
        <div className="night-bgm-copy">
          <span className="night-bgm-eyebrow">BGM</span>
          <span className="night-bgm-title" title={`${track.title} · ${track.subtitle}`}>
            {track.title}
          </span>
        </div>
      </div>

      <div className="night-bgm-controls">
        <button
          type="button"
          className="night-bgm-btn"
          onClick={prev}
          aria-label="Previous track"
          title="Previous track"
        >
          <SkipBack size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="night-bgm-btn night-bgm-btn--toggle"
          onClick={toggle}
          aria-label={isPlaying ? 'Pause background music' : 'Play background music'}
          aria-pressed={isPlaying}
          title={isPlaying ? 'Turn off background music' : 'Play background music'}
        >
          {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
        </button>
        <button
          type="button"
          className="night-bgm-btn"
          onClick={next}
          aria-label="Next track"
          title="Next track"
        >
          <SkipForward size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default LobbyBgmPlayer;
