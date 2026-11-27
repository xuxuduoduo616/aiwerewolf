import React from 'react';
import BottomNav from './BottomNav';
import TopStatusBar from './TopStatusBar';
import InkWorldBackdrop from '../scene/InkWorldBackdrop';
import type { InkSceneId } from '../scene/inkSceneConfig';
import '../styles/mobile-shell.css';
import '../styles/app-integration.css';
import '../styles/lobby-refinement.css';
import { UI_PRESENTATION } from '../uiPresentation';

export type ShellView = 'home' | 'friends' | 'wolfvillage' | 'shop' | 'profile';

interface Props {
  activeView: ShellView;
  onNavigate: (view: ShellView) => void;
  children: React.ReactNode;
  /** When true, renders full-screen (no shell chrome). Used for LOGIN. */
  fullscreen?: boolean;
  /** Active ink-wash world backdrop scene for the current page. */
  sceneId?: InkSceneId;
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
  sceneId = 'lobby',
  coins = 0,
  coupons = 0,
  crystals = 0,
  onOpenUtilityMenu,
  utilityTriggerRef,
}) => {
  if (fullscreen) return <>{children}</>;

  return (
    <div className={`wol-shell${UI_PRESENTATION.showLegacyLobby ? '' : ' wol-shell--refined'}`}>
      <InkWorldBackdrop sceneId={sceneId} />
      <TopStatusBar
        quiet={!UI_PRESENTATION.showLegacyLobby}
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
