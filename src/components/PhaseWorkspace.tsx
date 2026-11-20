import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { GripHorizontal, RotateCcw } from 'lucide-react';

type Dock = 'left' | 'right' | 'bottom';
type Handle = 'n' | 'e' | 's' | 'w' | 'ne' | 'se' | 'sw' | 'nw';
interface Rect { x: number; y: number; width: number; height: number }
type Placement = { mode: 'floating'; rect: Rect } | { mode: Dock; size: number; restore: Rect };
interface Gesture {
  id: number;
  x: number;
  y: number;
  rect: Rect;
  offsetX: number;
  offsetY: number;
  nextDock?: Extract<Placement, { mode: Dock }>;
  handle?: Handle;
  before: Placement | null;
  moved: boolean;
}

const SNAP_DISTANCE = 36;
const MIN_WIDTH = 276;
const MIN_HEIGHT = 176;
const handles: Handle[] = ['n', 'e', 's', 'w', 'ne', 'se', 'sw', 'nw'];
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const isDocked = (placement: Placement | null): placement is Extract<Placement, { mode: Dock }> =>
  placement !== null && placement.mode !== 'floating';

function fit(rect: Rect, width: number, height: number): Rect {
  const w = clamp(rect.width, Math.min(MIN_WIDTH, width), width);
  const h = clamp(rect.height, Math.min(MIN_HEIGHT, height), height);
  return { x: clamp(rect.x, 0, width - w), y: clamp(rect.y, 0, height - h), width: w, height: h };
}

function resize(rect: Rect, edge: Handle, dx: number, dy: number, width: number, height: number): Rect {
  const minWidth = Math.min(MIN_WIDTH, rect.width);
  const minHeight = Math.min(MIN_HEIGHT, rect.height);
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const x = edge.includes('w') ? clamp(rect.x + dx, 0, right - minWidth) : rect.x;
  const y = edge.includes('n') ? clamp(rect.y + dy, 0, bottom - minHeight) : rect.y;
  return {
    x, y,
    width: (edge.includes('e') ? clamp(right + dx, rect.x + minWidth, width) : right) - x,
    height: (edge.includes('s') ? clamp(bottom + dy, rect.y + minHeight, height) : bottom) - y,
  };
}

interface Props {
  seats: React.ReactNode;
  className: string;
  children: React.ReactNode;
}

export default function PhaseWorkspace({ seats, className, children }: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [snap, setSnap] = useState<Dock | null>(null);
  const [active, setActive] = useState(false);
  const [opacity, setOpacity] = useState(90);
  const [opacityOpen, setOpacityOpen] = useState(false);
  const opacityControlId = useId();
  const opacityButton = useRef<HTMLButtonElement>(null);

  // Measure against the stage, but detect docking against the visible board.
  // The latter stays in the same place while a tall board is scrolled.
  const measure = () => {
    const s = stage.current!;
    const bounds = s.getBoundingClientRect();
    const current = panel.current!.getBoundingClientRect();
    return {
      stage: s,
      left: bounds.left + s.clientLeft - s.scrollLeft,
      top: bounds.top + s.clientTop - s.scrollTop,
      panel: current,
    };
  };

  useLayoutEffect(() => {
    const s = stage.current;
    if (!s || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (gesture.current || s.clientWidth === 0 || s.clientHeight === 0) return;
      setPlacement(previous => {
        if (previous?.mode !== 'floating') return previous;
        const before = previous.rect;
        const rect = fit(before, s.clientWidth, s.clientHeight);
        return before.x === rect.x && before.y === rect.y &&
          before.width === rect.width && before.height === rect.height ? previous : { mode: 'floating', rect };
      });
    });
    observer.observe(s);
    return () => observer.disconnect();
  }, []);

  const move = (event: React.PointerEvent<HTMLElement>) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    const measured = measure();
    const { clientWidth, clientHeight } = measured.stage;
    if (isDocked(drag.before) && drag.handle) {
      const dock = drag.before.mode;
      const size = dock === 'bottom' ? drag.rect.height - dy : drag.rect.width + (dock === 'left' ? dx : -dx);
      setPlacement({ ...drag.before, size: Math.max(dock === 'bottom' ? MIN_HEIGHT : MIN_WIDTH, size) });
      return;
    }
    if (drag.handle) {
      const rect = resize(drag.rect, drag.handle, dx, dy, clientWidth, clientHeight);
      setPlacement({ mode: 'floating', rect });
      return;
    }
    const fromDock = isDocked(drag.before) ? drag.before.restore : null;
    const rect = fit({
      width: fromDock?.width ?? drag.rect.width,
      height: fromDock?.height ?? drag.rect.height,
      x: event.clientX - measured.left - (fromDock ? Math.min(fromDock.width / 2, 90) : drag.offsetX),
      y: event.clientY - measured.top - (fromDock ? 16 : drag.offsetY),
    }, clientWidth, clientHeight);
    setPlacement({ mode: 'floating', rect });
    const visible = measured.stage.closest('.game-room-board')!.getBoundingClientRect();
    const target = event.clientY >= visible.bottom - SNAP_DISTANCE ? 'bottom'
      : event.clientX <= visible.left + SNAP_DISTANCE ? 'left'
      : event.clientX >= visible.right - SNAP_DISTANCE ? 'right' : null;
    setSnap(target);
    drag.nextDock = target ? { mode: target, size: 0, restore: rect } : undefined;
  };

  const start = (event: React.PointerEvent<HTMLElement>, handle?: Handle) => {
    if (event.button !== 0 || !event.isPrimary || gesture.current || !stage.current || !panel.current) return;
    const { left, top, panel: bounds } = measure();
    gesture.current = {
      id: event.pointerId, x: event.clientX, y: event.clientY, before: placement, handle, moved: false,
      offsetX: event.clientX - bounds.left, offsetY: event.clientY - bounds.top,
      rect: { x: bounds.left - left, y: bounds.top - top, width: bounds.width, height: bounds.height },
    };
    event.preventDefault();
    if (!handle) event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    setActive(true);
  };

  const end = (event: React.PointerEvent<HTMLElement>, cancel = false) => {
    const drag = gesture.current;
    if (!drag || drag.id !== event.pointerId) return;
    gesture.current = null;
    if (cancel) setPlacement(drag.before);
    else if (drag.nextDock) setPlacement(drag.nextDock);
    setSnap(null);
    setActive(false);
  };

  const keyboardMove = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'Home' || event.key === 'Escape') {
      event.preventDefault();
      setPlacement(null);
      return;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!direction) return;
    event.preventDefault();
    const { stage: s, left, top, panel: bounds } = measure();
    const [dx, dy] = direction;
    const rect = fit({
      x: bounds.left - left + (event.shiftKey ? 0 : dx * 24),
      y: bounds.top - top + (event.shiftKey ? 0 : dy * 24),
      width: bounds.width + (event.shiftKey ? dx * 24 : 0),
      height: bounds.height + (event.shiftKey ? dy * 24 : 0),
    }, s.clientWidth, s.clientHeight);
    if (event.altKey && event.key !== 'ArrowUp') {
      const edge = dx < 0 ? 'left' : dx > 0 ? 'right' : 'bottom';
      setPlacement({ mode: edge, size: 0, restore: rect });
    } else setPlacement({ mode: 'floating', rect });
  };

  const finishers = {
    onPointerMove: move,
    onPointerUp: end,
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => end(event, true),
    onLostPointerCapture: (event: React.PointerEvent<HTMLElement>) => end(event, true),
  };
  const style = {
    '--phase-panel-opacity': `${opacity}%`,
    ...(placement?.mode === 'floating' && {
      left: placement.rect.x, top: placement.rect.y, width: placement.rect.width, height: placement.rect.height,
    }),
  } as React.CSSProperties;
  const dockStyle = isDocked(placement) && placement.size > 0
    ? { '--phase-dock-size': `${placement.size}px` } as React.CSSProperties : undefined;

  return (
    <div ref={stage} className="seat-stage phase-stage" data-phase-layout={placement?.mode ?? 'center'} style={dockStyle}>
      {seats}
      {snap && <div className="phase-dock-preview" data-edge={snap} aria-hidden="true" />}
      <div ref={panel} className={`${className} phase-panel`} data-interacting={active || undefined} style={style}>
        <div className="phase-panel-toolbar">
          <button
            type="button" className="phase-panel-grip" aria-label="Move phase panel" data-tour-target="game-phase-layout"
            title="Drag to move or dock. Arrow keys move, Shift + arrows resize, Alt + left/right/down docks, Home resets."
            onPointerDown={start} onKeyDown={keyboardMove} {...finishers}
          >
            <GripHorizontal size={17} aria-hidden="true" />
          </button>
          <div className="phase-panel-tools">
            <div
              className="phase-panel-opacity"
              onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) setOpacityOpen(false);
              }}
              onKeyDown={event => {
                if (event.key !== 'Escape' || !opacityOpen) return;
                event.preventDefault();
                event.stopPropagation();
                setOpacityOpen(false);
                opacityButton.current?.focus();
              }}
            >
              <button
                ref={opacityButton} type="button" className="phase-panel-opacity-button" data-tour-target="game-phase-opacity"
                aria-label={`Phase panel opacity: ${opacity}%`} aria-expanded={opacityOpen}
                aria-controls={opacityControlId} title="Adjust phase panel opacity"
                onClick={() => setOpacityOpen(open => !open)}
              >
                {opacity}%
              </button>
              <div id={opacityControlId} className="phase-panel-opacity-controls" hidden={!opacityOpen}>
                <label htmlFor={`${opacityControlId}-range`}>Panel opacity</label>
                <input
                  id={`${opacityControlId}-range`} type="range" min={50} max={100}
                  value={opacity} aria-valuetext={`${opacity}%`}
                  onChange={event => setOpacity(event.currentTarget.valueAsNumber)}
                />
              </div>
            </div>
            <button
              type="button" className="phase-panel-reset" onClick={() => setPlacement(null)}
              aria-label="Reset phase panel layout" title="Reset phase panel layout" disabled={!placement || active}
            >
              <RotateCcw size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="phase-panel-content">{children}</div>
        {handles.map(handle => (
          <div key={handle} className="phase-panel-resize" data-edge={handle} aria-hidden="true"
            onPointerDown={event => start(event, handle)} {...finishers} />
        ))}
      </div>
    </div>
  );
}
