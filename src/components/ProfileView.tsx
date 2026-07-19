import React, { useState } from 'react';
import OutfitsPanel from './OutfitsPanel';
import BackpackPanel from './BackpackPanel';
import SkinCollectionPanel from './SkinCollectionPanel';
import ProfileSubTabs from './ProfileSubTabs';

type SubTab = 'outfits' | 'decorations' | 'runwolf' | 'scenes' | 'skins' | 'backpack';

interface Props {
  onBack?: () => void;
}

const ProfileView: React.FC<Props> = () => {
  const [subTab, setSubTab] = useState<SubTab>('outfits');

  const renderPanel = () => {
    switch (subTab) {
      case 'outfits':
        return <OutfitsPanel />;
      case 'backpack':
        return <BackpackPanel />;
      case 'skins':
        return <SkinCollectionPanel />;
      default:
        return (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            minHeight: 200, color: 'rgba(255,255,255,0.25)', fontSize: 13,
          }}>
            即将开放
          </div>
        );
    }
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      {/* Profile header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '16px 12px 12px',
      }}>
        {/* Avatar */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
            border: '2px solid rgba(255,255,255,0.12)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" style={{ width: 28, height: 28 }}>
              <circle cx="12" cy="8" r="4" strokeLinecap="round"/>
              <path d="M4 21v-2a4 4 0 014-4h8a4 4 0 014 4v2" strokeLinecap="round"/>
            </svg>
          </div>
          {/* Level badge */}
          <div style={{
            position: 'absolute', bottom: -2, left: -2,
            width: 22, height: 22, borderRadius: '50%',
            background: 'linear-gradient(135deg, #c9a44b, #8b6914)',
            border: '2px solid #0d0d10',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 8, fontWeight: 900, color: '#fff',
          }}>
            10
          </div>
        </div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>狼村旅人</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>
            ID: 1000242 · Lv.10
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <ProfileSubTabs active={subTab} onSelect={setSubTab} />

      {/* Panel content */}
      <div style={{ padding: '0 0 16px' }}>
        {renderPanel()}
      </div>
    </div>
  );
};

export default ProfileView;
