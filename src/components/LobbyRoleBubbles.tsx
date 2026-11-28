import React, { useEffect, useRef, useState } from 'react';
import { PawPrint, VenetianMask } from 'lucide-react';
import { Role } from '../types';
import { getRoleShowcaseSpec } from '../services/roleShowcaseConfig';
import RoleBadgeIcon from './RoleBadgeIcon';
import '../styles/lobby-role-bubbles.css';

const roles = [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER, Role.IDIOT];
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface Bloom {
  role: Role;
  closing?: boolean;
  id: number;
  style: React.CSSProperties;
}

export default function LobbyRoleBubbles() {
  const sky = useRef<HTMLDivElement>(null);
  const dwell = useRef<number>();
  const sequence = useRef(0);
  const [bloom, setBloom] = useState<Bloom | null>(null);
  const cancelDwell = () => window.clearTimeout(dwell.current);
  useEffect(() => cancelDwell, []);

  useEffect(() => {
    if (!bloom) return;
    const dismiss = () => setBloom(null);
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const timeout = window.setTimeout(() => {
      if (bloom.closing || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        dismiss();
      } else {
        setBloom({ ...bloom, closing: true });
      }
    }, bloom.closing ? 550 : 4650);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', dismiss);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', dismiss);
    };
  }, [bloom]);

  function reveal(role: Role, button: HTMLButtonElement) {
    cancelDwell();
    const bounds = sky.current?.getBoundingClientRect();
    if (!bounds) return;
    const badge = button.getBoundingClientRect();
    const x = badge.left + badge.width / 2;
    const y = badge.top + badge.height / 2;
    const width = Math.min(308, bounds.width * .8, window.innerHeight * .46);
    const height = width * 4 / 3;
    const centerX = bounds.left + bounds.width / 2;
    const centerY = window.innerHeight / 2;
    // Keep the ink's starting point at the actual moving seal, even near an edge.
    const left = clamp(x + (centerX - x) * .45 - width / 2, bounds.left, bounds.right - width);
    const top = clamp(y < centerY ? y + 8 : y - height - 8, 12, window.innerHeight - height - 12);
    setBloom({
      role, id: ++sequence.current,
      style: {
        left: left - bounds.left, top: top - bounds.top, width, height,
        transformOrigin: `${x - left}px ${y - top}px`,
      },
    });
  }

  return <div className="role-sky" ref={sky}>
    {roles.map(role => {
      const { slug, roleTitle } = getRoleShowcaseSpec(role);
      return <button key={role} type="button" className={`role-orb role-orb--${slug}`}
        aria-label={`Reveal ${roleTitle.en} portrait`}
        aria-pressed={bloom?.role === role && !bloom.closing}
        onPointerEnter={event => {
          if (event.pointerType === 'touch') return;
          cancelDwell();
          const button = event.currentTarget;
          dwell.current = window.setTimeout(() => reveal(role, button), 1000);
        }}
        onPointerLeave={cancelDwell} onPointerCancel={cancelDwell}
        onClick={event => {
          cancelDwell();
          if (bloom?.role === role && !bloom.closing) {
            setBloom(window.matchMedia('(prefers-reduced-motion: reduce)').matches
              ? null
              : { ...bloom, closing: true });
          } else {
            reveal(role, event.currentTarget);
          }
        }}>
        {role === Role.WEREWOLF ? (
          <PawPrint aria-hidden="true" />
        ) : role === Role.IDIOT ? (
          <VenetianMask aria-hidden="true" />
        ) : (
          <RoleBadgeIcon role={role} />
        )}
      </button>;
    })}
    {bloom && <figure key={bloom.id} className="role-ink-bloom" data-closing={bloom.closing} style={bloom.style}>
      <div className="role-ink-wash" />
      <img className="role-ink-portrait" src={getRoleShowcaseSpec(bloom.role).portraitSrc} alt={`${bloom.role} portrait`} />
      <figcaption className="cinzel">{getRoleShowcaseSpec(bloom.role).roleTitle.en}</figcaption>
    </figure>}
  </div>;
}
