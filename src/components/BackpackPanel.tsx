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
    { id: 'g1', name: 'Rose', effect: 'Affinity +1', count: 9, icon: '🌹' },
    { id: 'g2', name: 'Village Horn', effect: 'Send 1 village announcement', count: 3, icon: '📢' },
    { id: 'g3', name: 'Deluxe Gift Box', effect: 'Contains a random item', count: 5, icon: '🎁' },
  ],
  chest: [
    { id: 'c1', name: 'Bronze Chest', effect: 'Contains a random common item', count: 2, icon: '📦' },
    { id: 'c2', name: 'Season Chest', effect: 'Contains a season reward', count: 1, icon: '✨' },
  ],
  item: [
    { id: 'i1', name: 'Rename Card', effect: 'Change your display name once', count: 1, icon: '🪪' },
    { id: 'i2', name: 'Experience Potion', effect: 'Experience +100', count: 12, icon: '🧪' },
    { id: 'i3', name: 'Energy Tonic', effect: 'Restore 50 energy', count: 6, icon: '💊' },
  ],
  shard: [
    { id: 's1', name: 'Wolf Soul Shard', effect: 'Collect 50 to redeem a skin', count: 14, icon: '💎' },
    { id: 's2', name: 'Starlight Shard', effect: 'Collect 30 to redeem an avatar frame', count: 8, icon: '⭐' },
  ],
  coupon: [
    { id: 'co1', name: 'First Purchase Voucher', effect: 'Double the first purchase amount', count: 1, icon: '🎫' },
    { id: 'co2', name: '20% Off Coupon', effect: 'Save 20% in the shop', count: 2, icon: '🏷️' },
  ],
};

type Category = 'gift' | 'chest' | 'item' | 'shard' | 'coupon';

const CATEGORIES: { key: Category; label: string }[] = [
  { key: 'gift', label: 'Gifts' },
  { key: 'chest', label: 'Chests' },
  { key: 'item', label: 'Items' },
  { key: 'shard', label: 'Shards' },
  { key: 'coupon', label: 'Coupons' },
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
    <section className="wol-backpack" aria-label="Backpack">
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
              No items in this category
            </div>
          ) : (
            items.map(item => (
            <div
              key={item.id}
              className="wol-backpack-card"
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
              <div className="wol-break-text" style={{ fontSize: 10, fontWeight: 700, color: '#fff', textAlign: 'center', marginBottom: 2 }}>
                {item.name}
              </div>

              {/* Effect description */}
              <div className="wol-break-text" style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginBottom: 6 }}>
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
                Send Gift
              </button>

              {/* Count badge */}
              <div style={{
                position: 'absolute', top: 6, right: 6,
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
    </section>
  );
};

export default BackpackPanel;
