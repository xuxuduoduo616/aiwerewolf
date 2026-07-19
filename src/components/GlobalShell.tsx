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
  /** Live wallet balances from useWallet hook. */
  coins?: number;
  coupons?: number;
  crystals?: number;
}

const GlobalShell: React.FC<Props> = ({
  activeView,
  onNavigate,
  children,
  fullscreen,
  coins = 0,
  coupons = 0,
  crystals = 0,
}) => {
  if (fullscreen) return <>{children}</>;

  return (
    <div className="wol-shell">
      <TopStatusBar
        coins={coins}
        coupons={coupons}
        crystals={crystals}
        onNavigateToShop={() => onNavigate('shop')}
      />
      <div className="wol-shell-content">
        {children}
      </div>
      <BottomNav activeView={activeView} onNavigate={onNavigate} />
    </div>
  );
};

export default GlobalShell;
