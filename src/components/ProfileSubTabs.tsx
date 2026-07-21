import React from 'react';
import TabBar from './TabBar';

type SubTab = 'outfits' | 'decorations' | 'runwolf' | 'scenes' | 'skins' | 'backpack';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS = [
  { key: 'outfits' as const,     label: '时装' },
  { key: 'decorations' as const, label: '装饰' },
  { key: 'runwolf' as const,     label: '跑跑狼' },
  { key: 'scenes' as const,      label: '场景' },
  { key: 'skins' as const,       label: '皮肤' },
  { key: 'backpack' as const,    label: '背包' },
];

const ProfileSubTabs: React.FC<Props> = ({ active, onSelect }) => (
  <TabBar tabs={TABS} active={active} onSelect={onSelect} />
);

export default ProfileSubTabs;
