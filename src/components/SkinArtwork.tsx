import React, { useId } from 'react';
import type { SkinProduct } from '../economy/catalog';
import WuxiaCharacter from './WuxiaCharacter';

interface Props { product: SkinProduct; large?: boolean; }

const SkinArtwork: React.FC<Props> = ({ product, large = false }) => {
  const paperId = `skin-paper-${useId().replace(/:/g, '')}`;
  return (
    <svg className={`skin-artwork${large ? ' skin-artwork--large' : ''}`} viewBox="0 0 240 300" role="img" aria-label={`${product.name} original ink-wash cosmetic preview`}>
      <defs><linearGradient id={paperId} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e5e1d7" stopOpacity=".12" /><stop offset="1" stopColor="#070708" stopOpacity=".04" /></linearGradient></defs>
      <rect width="240" height="300" rx="18" fill={`url(#${paperId})`} />
      <g aria-hidden="true" fill="none" stroke={product.accent} strokeOpacity=".16">
        <circle cx="156" cy="87" r="66" strokeWidth="1" />
        <path d="m8 250 39-37 26 20 41-53 40 39 28-25 50 48M20 268q95-20 199 0" strokeWidth="2" />
        <path d="M29 95v65m-8-45 8 8 13-13m167 66-9 46m-5-23 8 5 12-10" strokeWidth="3" />
      </g>
      <ellipse cx="121" cy="276" rx="65" ry="6" fill={product.accent} opacity=".1" />
      <WuxiaCharacter product={product} />
    </svg>
  );
};
export default SkinArtwork;
