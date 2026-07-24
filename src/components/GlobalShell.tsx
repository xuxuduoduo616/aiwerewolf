import React from 'react';
import BottomNav from './BottomNav';
import TopStatusBar from './TopStatusBar';
import '../styles/mobile-shell.css';
import '../styles/app-integration.css';

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
  onOpenUtilityMenu: () => void;
  utilityTriggerRef?: React.RefObject<HTMLButtonElement>;
}

const GlobalShell: React.FC<Props> = ({
  activeView,
  onNavigate,
  children,
  fullscreen,
  coins = 0,
  coupons = 0,
  crystals = 0,
  onOpenUtilityMenu,
  utilityTriggerRef,
}) => {
  if (fullscreen) return <>{children}</>;

  return (
    <div className="wol-shell">
      <TopStatusBar
        coins={coins}
        coupons={coupons}
        crystals={crystals}
        onNavigateToShop={() => onNavigate('shop')}
        onOpenUtilityMenu={onOpenUtilityMenu}
        utilityTriggerRef={utilityTriggerRef}
      />
      <main className="wol-shell-content" id="shell-content">
        {children}
      </main>
      <BottomNav activeView={activeView} onNavigate={onNavigate} />
    </div>
  );
};

export default GlobalShell;
