import React, { useState } from 'react';
import FilterChipBar from './FilterChipBar';

/* ─── Hardcoded test backpack data ───────────────────────────────────── */

interface BackpackItem {
  id: string;
  name: string;
  effect: string;
  count: number;
  icon: string; // emoji or label for placeholder icon
}

const ITEMS_BY_CATEGORY: Record<string, BackpackItem[]> = {
  gift: [
    { id: 'g1', name: '玫瑰花', effect: '亲密度+1', count: 9, icon: '🌹' },
    { id: 'g2', name: '小喇叭', effect: '全服喊话1次', count: 3, icon: '📢' },
    { id: 'g3', name: '精致礼盒', effect: '随机开出道具', count: 5, icon: '🎁' },
  ],
  chest: [
    { id: 'c1', name: '青铜宝箱', effect: '随机获得普通道具', count: 2, icon: '📦' },
    { id: 'c2', name: '赛季宝箱', effect: '获得赛季限定奖励', count: 1, icon: '✨' },
  ],
  item: [
    { id: 'i1', name: '改名卡', effect: '修改一次昵称', count: 1, icon: '🪪' },
    { id: 'i2', name: '经验药水', effect: '经验值+100', count: 12, icon: '🧪' },
    { id: 'i3', name: '体力恢复剂', effect: '恢复体力50点', count: 6, icon: '💊' },
  ],
  shard: [
    { id: 's1', name: '狼魂碎片', effect: '集齐50个兑换皮肤', count: 14, icon: '💎' },
    { id: 's2', name: '星光碎片', effect: '集齐30个兑换头像框', count: 8, icon: '⭐' },
  ],
  coupon: [
    { id: 'co1', name: '首充双倍券', effect: '首次充值金额翻倍', count: 1, icon: '🎫' },
    { id: 'co2', name: '8折优惠券', effect: '商城消费享8折', count: 2, icon: '🏷️' },
  ],
};

type Category = 'gift' | 'chest' | 'item' | 'shard' | 'coupon';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'gift', label: '礼物' },
  { key: 'chest', label: '宝箱' },
  { key: 'item', label: '道具' },
  { key: 'shard', label: '碎片' },
  { key: 'coupon', label: '优惠券' },
];

/* ─── Gift icon ───────────────────────────────────────────────────────── */

const GiftIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ width: 12, height: 12 }}>
    <rect x="2" y="4" width="12" height="10" rx="1" strokeLinecap="round"/>
    <path d="M8 4V14M4 4c0-2 2-3 4-1 2-2 4-1 4 1" strokeLinecap="round"/>
  </svg>
);

/* ─── Component ───────────────────────────────────────────────────────── */

const BackpackPanel: React.FC = () => {
  const [category, setCategory] = useState<Category>('gift');
  const items = ITEMS_BY_CATEGORY[category] || [];

  return (
    <div>
      {/* Filter bar */}
      <FilterChipBar chips={CATEGORIES} active={category} onSelect={setCategory} />

      {/* Items grid */}
      <div style={{ padding: '0 12px' }}>
        <div className="wol-grid-4">
          {items.length === 0 ? (
            <div style={{
              gridColumn: '1 / -1',
              textAlign: 'center',
              padding: '32px 16px',
              color: 'rgba(255,255,255,0.35)',
              fontSize: 12,
              fontWeight: 600,
            }}>
              该分类暂无道具
            </div>
          ) : (
            items.map(item => (
            <div
              key={item.id}
              style={{
                display: 'flex', flexDirection: 'column',
                background: 'rgba(22,22,28,0.94)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 10,
                padding: '10px 8px',
                position: 'relative',
              }}
            >
              {/* Item icon placeholder */}
              <div style={{
                width: '100%', aspectRatio: '1/1',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 24,
                marginBottom: 6,
              }}>
                {item.icon}
              </div>

              {/* Name */}
              <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 2 }}>
                {item.name}
              </div>

              {/* Effect description */}
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 6 }}>
                {item.effect}
              </div>

              {/* Send gift button */}
              <button
                type="button"
                className="wol-btn wol-btn--sm"
                style={{
                  width: '100%',
                  background: 'rgba(74,224,160,0.15)',
                  border: '1px solid rgba(74,224,160,0.3)',
                  color: '#4ae0a6',
                  fontSize: 9, fontWeight: 700,
                }}
              >
                <GiftIcon />
                送礼
              </button>

              {/* Count badge */}
              <div style={{
                position: 'absolute', bottom: 6, right: 6,
                fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.55)',
                background: 'rgba(0,0,0,0.6)', borderRadius: 4,
                padding: '1px 5px',
              }}>
                x{item.count}
              </div>
            </div>
          )))}
        </div>
      </div>
    </div>
  );
};

export default BackpackPanel;
