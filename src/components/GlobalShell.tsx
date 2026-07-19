import React from 'react';
import BottomNav from './BottomNav';
import TopStatusBar from './TopStatusBar';
import '../styles/mobile-shell.css';

export type ShellView = 'home' | 'friends' | 'wolfvillage' | 'shop' | 'profile';

interface Props {
  activeView: ShellView;
  onNavigate: (view: ShellView) => void;
  children: React.ReactNode;
  /** When true, renders full-screen (no shell chrome). Used for LOGIN. */
  fullscreen?: boolean;
}

const GlobalShell: React.FC<Props> = ({ activeView, onNavigate, children, fullscreen }) => {
  if (fullscreen) return <>{children}</>;

  return (
    <div className="wol-shell">
      <TopStatusBar
        coins={12850}
        coupons={320}
        crystals={8}
      />
      <div className="wol-shell-content">
        {children}
      </div>
      <BottomNav activeView={activeView} onNavigate={onNavigate} />
    </div>
  );
};

export default GlobalShell;
