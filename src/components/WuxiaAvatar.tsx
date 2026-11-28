import React, { useState } from 'react';
import type { SkinProduct } from '../economy/catalog';
import { DEFAULT_OUTFIT_SPEC, getSkinAvatarUrl } from '../economy/skinAssets';
import '../styles/wuxia-avatar.css';

export type WuxiaAvatarFrame = 'ink-ring' | 'crimson-moon';
export type WuxiaAvatarSize = 'sm' | 'md' | 'lg' | 'seat-compact' | 'seat';

export interface WuxiaAvatarProps {
  skin?: SkinProduct | null;
  src?: string;
  frame?: WuxiaAvatarFrame | null;
  size?: WuxiaAvatarSize;
  alt: string;
  className?: string;
  lazy?: boolean;
  userAuthoredAlt?: boolean;
}

const SIZE_CLASSES: Record<WuxiaAvatarSize, string> = {
  sm: 'w-10 h-10 wuxia-avatar--sm',
  md: 'w-12 h-12 wuxia-avatar--md',
  lg: 'w-14 h-14 wuxia-avatar--lg',
  'seat-compact': 'w-14 h-14 wuxia-avatar--seat-compact',
  seat: 'w-16 h-16 wuxia-avatar--seat',
};

const SumiTravelerSilhouette = ({
  alt,
  userAuthoredAlt,
}: {
  alt: string;
  userAuthoredAlt: boolean;
}) => {
  const isDecorative = alt === '';
  const uiCopyProps = userAuthoredAlt && !isDecorative
    ? {
        'data-ui-copy-category': 'USER_AUTHORED',
        'data-ui-copy-allow': 'USER_PLAYER_NAME',
      }
    : {};

  return (
    <svg
      viewBox="0 0 64 64"
      className="wuxia-avatar-fallback"
      role={isDecorative ? undefined : 'img'}
      aria-hidden={isDecorative ? true : undefined}
      aria-label={isDecorative ? undefined : alt}
      {...uiCopyProps}
    >
      <path
        d="M10 27c7-6 15-9 22-9s15 3 22 9c-6 1.5-14 2.5-22 2.5S16 28.5 10 27Z"
        fill="currentColor"
        opacity="0.92"
      />
      <path
        d="M23 23c2.5-5.2 5.5-8 9-8s6.5 2.8 9 8H23Z"
        fill="currentColor"
      />
      <circle cx="32" cy="34" r="6.5" fill="currentColor" opacity="0.88" />
      <path
        d="M17 55c1.8-9.5 7.2-14.5 15-14.5S45.2 45.5 47 55H17Z"
        fill="currentColor"
        opacity="0.9"
      />
    </svg>
  );
};

export const WuxiaAvatar: React.FC<WuxiaAvatarProps> = ({
  skin,
  src,
  frame = null,
  size = 'md',
  alt,
  className = '',
  lazy = false,
  userAuthoredAlt = false,
}) => {
  const isFolkMode = Boolean(src);
  const resolvedSrc = src ?? getSkinAvatarUrl(skin?.id);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const hasError = failedSrc === resolvedSrc;

  const tierClass = isFolkMode
    ? 'wuxia-avatar--folk'
    : skin?.tier === 'Premium'
      ? 'wuxia-avatar--premium'
      : 'wuxia-avatar--basic';

  const accent = isFolkMode ? undefined : (skin?.accent ?? DEFAULT_OUTFIT_SPEC.accent);
  const rootStyle = accent
    ? ({ '--wuxia-avatar-accent': accent } as React.CSSProperties)
    : undefined;

  const uiCopyProps = userAuthoredAlt
    ? {
        'data-ui-copy-category': 'USER_AUTHORED',
        'data-ui-copy-allow': 'USER_PLAYER_NAME',
      }
    : {};

  return (
    <span
      className={`wuxia-avatar rounded-full ${SIZE_CLASSES[size]} ${tierClass} ${className}`.trim()}
      style={rootStyle}
      data-avatar-frame={frame ?? undefined}
    >
      <span className="wuxia-avatar-media rounded-full">
        {hasError ? (
          <SumiTravelerSilhouette alt={alt} userAuthoredAlt={userAuthoredAlt} />
        ) : (
          <img
            src={resolvedSrc}
            alt={alt}
            loading={lazy ? 'lazy' : undefined}
            decoding="async"
            className="wuxia-avatar-img rounded-full"
            onError={() => setFailedSrc(resolvedSrc)}
            {...uiCopyProps}
          />
        )}
      </span>
      {frame && (
        <span
          className={`wuxia-avatar-frame wuxia-avatar-frame--${frame}`}
          aria-hidden="true"
        />
      )}
    </span>
  );
};

export default WuxiaAvatar;
