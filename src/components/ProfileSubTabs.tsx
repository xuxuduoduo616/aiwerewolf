import React from 'react';
import TabBar from './TabBar';

type SubTab = 'outfits' | 'decorations' | 'runwolf' | 'scenes' | 'skins' | 'backpack';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS = [
  { key: 'outfits' as const,     label: 'Outfits' },
  { key: 'decorations' as const, label: 'Decor' },
  { key: 'runwolf' as const,     label: 'Run Wolf' },
  { key: 'scenes' as const,      label: 'Scenes' },
  { key: 'skins' as const,       label: 'Skins' },
  { key: 'backpack' as const,    label: 'Backpack' },
];

const ProfileSubTabs: React.FC<Props> = ({ active, onSelect }) => (
  <TabBar id="profile" label="Profile categories" tabs={TABS} active={active} onSelect={onSelect} />
);

export default ProfileSubTabs;
