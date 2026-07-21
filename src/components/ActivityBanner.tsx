import React, { useState, useEffect, useRef } from 'react';

const BANNERS = [
  { id: 1, title: '逐浪季限定', subtitle: '夏日海滩主题皮肤限时上架', color: '#3b82f6' },
  { id: 2, title: '线上海选赛', subtitle: '月度狼人杀锦标赛报名中', color: '#f59e0b' },
  { id: 3, title: '每日签到', subtitle: '连续签到7天送限定头像框', color: '#8b5cf6' },
];

const ActivityBanner: React.FC = () => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const idx = Math.round(el.scrollLeft / el.clientWidth);
      setActiveIndex(idx);
    };
    el.addEventListener('scroll', update, { passive: true });
    update();
    return () => el.removeEventListener('scroll', update);
  }, []);

  return (
    <div>
      <div
        ref={scrollRef}
        className="wol-scrollbar-hide"
        style={{
          display: 'flex', gap: 10, overflowX: 'auto',
          padding: '4px 0',
          scrollSnapType: 'x mandatory',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {BANNERS.map(banner => (
          <div
            key={banner.id}
            style={{
              flexShrink: 0,
              width: '75%',
              maxWidth: 300,
              height: 72,
              borderRadius: 12,
              background: `linear-gradient(135deg, ${banner.color}22, ${banner.color}08)`,
              border: `1px solid ${banner.color}22`,
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center',
              padding: '12px 16px',
              scrollSnapAlign: 'start',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            {/* Decorative accent */}
            <div style={{
              position: 'absolute', right: -8, top: -8,
              width: 48, height: 48, borderRadius: '50%',
              background: `${banner.color}18`,
            }} />
            <div style={{
              fontSize: 13, fontWeight: 700, color: '#fff',
              position: 'relative', zIndex: 1,
            }}>
              {banner.title}
            </div>
            <div style={{
              fontSize: 10, color: 'rgba(255,255,255,0.5)',
              marginTop: 3, position: 'relative', zIndex: 1,
            }}>
              {banner.subtitle}
            </div>
          </div>
        ))}
      </div>

      {/* Scroll-snap indicator dots */}
      <div style={{
        display: 'flex', justifyContent: 'center', gap: 4,
        padding: '6px 0 2px',
      }}>
        {BANNERS.map((banner, i) => (
          <div
            key={banner.id}
            style={{
              width: activeIndex === i ? 14 : 4,
              height: 4,
              borderRadius: 2,
              background: activeIndex === i ? banner.color : 'rgba(255,255,255,0.15)',
              transition: 'all 200ms ease',
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default ActivityBanner;
