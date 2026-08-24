import React from 'react';
import type { SkinProduct } from '../economy/catalog';

interface Props {
  product: SkinProduct;
  large?: boolean;
}

const SkinArtwork: React.FC<Props> = ({ product, large = false }) => (
  <svg
    className={`skin-artwork${large ? ' skin-artwork--large' : ''}`}
    viewBox="0 0 240 300"
    role="img"
    aria-label={`${product.name} original ink-wash cosmetic preview`}
  >
    <defs>
      <linearGradient id={`paper-${product.id}`} x1="0" y1="0" x2="1" y2="1">
        <stop stopColor="#e5e1d7" stopOpacity="0.12" />
        <stop offset="1" stopColor="#070708" stopOpacity="0.04" />
      </linearGradient>
      <filter id={`rough-${product.id}`} x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence baseFrequency="0.04" numOctaves="2" seed={product.price} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="2" />
      </filter>
    </defs>
    <rect width="240" height="300" rx="18" fill={`url(#paper-${product.id})`} />
    <path d="M18 236C52 196 74 212 102 173c29-42 61-33 120-89" fill="none" stroke="#f4f1e8" strokeOpacity=".11" strokeWidth="22" strokeLinecap="round" filter={`url(#rough-${product.id})`} />
    <circle cx="120" cy="63" r="29" fill="#111114" stroke="#e6e2d8" strokeOpacity=".42" />
    <path d="M103 91c-27 20-41 62-51 137 25 15 49 21 68 21s44-6 70-21c-10-77-25-118-52-137z" fill="#111114" stroke="#e6e2d8" strokeOpacity=".42" strokeWidth="2" />
    <path d="M104 98c-5 52-17 95-39 132M138 98c7 52 20 94 39 132" fill="none" stroke="#eee9df" strokeOpacity=".16" strokeWidth="4" />
    <path d="M80 139l-50 45M161 139l49 44" fill="none" stroke="#111114" strokeWidth="18" strokeLinecap="round" />
    {product.mark === 'mountain' && <path d="M18 244l42-45 27 25 42-62 44 52 48-35" fill="none" stroke={product.accent} strokeOpacity=".9" strokeWidth="5" />}
    {product.mark === 'bamboo' && <g stroke={product.accent} strokeWidth="5" strokeLinecap="round"><path d="M42 258L72 93M67 224l-23-24M64 192l24-23M58 158l-17-22"/><path d="M187 255L165 108M170 191l22-20M173 218l-19-18"/></g>}
    {product.mark === 'wave' && <path d="M8 238c31-34 58 18 91-11 30-27 52-17 74 5 18 19 37 13 60-5" fill="none" stroke={product.accent} strokeWidth="8" strokeLinecap="round" />}
    {product.mark === 'moon' && <circle cx="177" cy="66" r="34" fill="none" stroke={product.accent} strokeWidth="7" strokeDasharray="170 52" />}
    {product.mark === 'crane' && <path d="M151 74c17-18 36-15 48-5-19 0-25 9-28 23-6-12-13-17-28-16 9-6 14-7 8-2z" fill="none" stroke={product.accent} strokeWidth="4" strokeLinejoin="round" />}
    {product.mark === 'sword' && <g stroke={product.accent} strokeLinecap="round"><path d="M49 240L192 67" strokeWidth="7"/><path d="M55 211l31 26" strokeWidth="5"/></g>}
    {product.mark === 'lotus' && <g fill="none" stroke={product.accent} strokeWidth="4"><path d="M120 221c-21-8-31-28-25-45 16 4 24 13 25 30 1-17 9-26 25-30 6 17-4 37-25 45z"/><path d="M120 206c-17-18-18-33 0-48 18 15 17 30 0 48z"/></g>}
    <g fill={product.accent} opacity=".75"><circle cx="31" cy="55" r="2"/><circle cx="203" cy="112" r="3"/><circle cx="24" cy="154" r="1.5"/></g>
  </svg>
);

export default SkinArtwork;
