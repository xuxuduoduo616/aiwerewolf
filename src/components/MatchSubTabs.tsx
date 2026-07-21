import React from 'react';
import TabBar from './TabBar';

type SubTab = 'home' | 'beginner' | 'entertainment' | 'advanced';

interface Props {
  active: SubTab;
  onSelect: (tab: SubTab) => void;
}

const TABS = [
  { key: 'home' as const, label: '首页' },
  { key: 'beginner' as const, label: '新手场' },
  { key: 'entertainment' as const, label: '娱乐场' },
  { key: 'advanced' as const, label: '进阶场' },
];

const MatchSubTabs: React.FC<Props> = ({ active, onSelect }) => (
  <TabBar tabs={TABS} active={active} onSelect={onSelect} />
);

export default MatchSubTabs;
