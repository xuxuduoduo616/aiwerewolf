import React from 'react';

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

/**
 * Presentation-only game shell. Responsive behavior lives in
 * game-responsive.css so game state and callbacks remain owned by App.
 */
const GameRoom: React.FC<GameRoomProps> = ({ header, children, sidebar, boardLabel }) => (
  <div className="game-room sketch-scene text-zinc-200 font-sans">
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

export const GamePlayerSeat: React.FC<GamePlayerSeatProps> = ({ children, desktopStyle }) => (
  <div className="game-player-seat" style={desktopStyle}>
    {children}
  </div>
);

export default GameRoom;
