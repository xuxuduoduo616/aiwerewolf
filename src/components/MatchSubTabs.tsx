import React from 'react';
import TabBar from './TabBar';

type SubTab = 'home' | 'beginner' | 'entertainment' | 'advanced';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS = [
  { key: 'home' as const, label: 'Home' },
  { key: 'beginner' as const, label: 'Beginner' },
  { key: 'entertainment' as const, label: 'Entertainment' },
  { key: 'advanced' as const, label: 'Advanced' },
];

const MatchSubTabs: React.FC<Props> = ({ active, onSelect }) => (
  <TabBar id="match" label="Game categories" tabs={TABS} active={active} onSelect={onSelect} />
);

export default MatchSubTabs;
