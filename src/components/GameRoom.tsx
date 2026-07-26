import React, { useEffect, useRef } from 'react';

interface GameRoomProps {
  header: React.ReactNode;
  children: React.ReactNode;
  sidebar: React.ReactNode;
  boardLabel: string;
}

interface GamePlayerSeatProps {
  children: React.ReactNode;
  desktopStyle: React.CSSProperties;
}

interface ResponsiveMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
}

export const bindResponsiveRoomScrollReset = (
  room: Pick<HTMLElement, 'scrollTop'>,
  mediaQuery: ResponsiveMediaQuery,
  requestFrame: (callback: FrameRequestCallback) => number,
  cancelFrame: (handle: number) => void,
) => {
  let wasResponsive = mediaQuery.matches;
  let pendingFrame: number | null = null;

  const handleChange = ({ matches: isResponsive }: { matches: boolean }) => {
    if (!isResponsive && pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }

    if (!wasResponsive && isResponsive) {
      pendingFrame = requestFrame(() => {
        pendingFrame = null;
        room.scrollTop = 0;
      });
    }

    wasResponsive = isResponsive;
  };

  mediaQuery.addEventListener('change', handleChange);

  return () => {
    mediaQuery.removeEventListener('change', handleChange);
    if (pendingFrame !== null) {
      cancelFrame(pendingFrame);
      pendingFrame = null;
    }
  };
};

/**
 * Presentation-only game shell. Responsive behavior lives in
 * game-responsive.css so game state and callbacks remain owned by App.
 */
const GameRoom: React.FC<GameRoomProps> = ({ header, children, sidebar, boardLabel }) => {
  const roomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const room = roomRef.current;
    if (!room || typeof window.matchMedia !== 'function') return;

    return bindResponsiveRoomScrollReset(
      room,
      window.matchMedia('(max-width: 1023px)'),
      window.requestAnimationFrame.bind(window),
      window.cancelAnimationFrame.bind(window),
    );
  }, []);

  return (
    <div ref={roomRef} className="game-room sketch-scene text-zinc-200 font-sans">
      <div className="game-room-layout">
        <main className="game-room-main">
          {header}
          <section className="game-room-board" aria-label={boardLabel}>
            {children}
          </section>
        </main>
        {sidebar}
      </div>
    </div>
  );
};

export const GamePlayerSeat: React.FC<GamePlayerSeatProps> = ({ children, desktopStyle }) => (
  <div className="game-player-seat" style={desktopStyle}>
    {children}
  </div>
);

export default GameRoom;
