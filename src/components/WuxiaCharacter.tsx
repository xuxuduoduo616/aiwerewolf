import React, { useId } from 'react';
import type { SkinProduct } from '../economy/catalog';

/** Single geometry source for store cards, dialogs and the human player's seat. */
export const WUXIA_SKIN_IDS = ['mist-wanderer', 'bamboo-vigil', 'tidal-swordsman', 'moonlit-crane', 'jade-moon-oath', 'tidebreaker-vow', 'crimson-lotus-shadow'] as const;
export const isWuxiaSkinId = (id: string): boolean => WUXIA_SKIN_IDS.some(skinId => skinId === id);
const ink = '#171b1d';
const paper = '#d9d6ca';

const SeatedLegs = ({ accent, wrapped }: { accent: string; wrapped: boolean }) => (
  <g data-part="seated-legs" fill="none" strokeLinecap="round" strokeLinejoin="round">
    {/* The viewer-left leg relaxes forward; the other knee keeps its raised angle. */}
    <path d="M108 268 71 262 56 291M132 268 158 245 159 285" stroke={ink} strokeWidth="11" />
    <path d="M108 268 71 262M132 268 158 245" stroke={accent} strokeWidth="7" />
    <path d="M71 262 56 291M158 245 159 285" stroke={paper} strokeWidth="5" />
    {wrapped && <path d="M65 274 58 287M158 261 159 278" stroke="#9f9290" strokeWidth="8" strokeDasharray="3 3" />}
    <g fill={paper} stroke={ink} strokeWidth="1.8">
      <circle cx="71" cy="262" r="5" /><circle cx="158" cy="245" r="5" />
      <path d="M51 289q5-3 10 1l-3 22q-11 4-22-2Z" />
      <path d="M154 283q5-3 10 0l5 17q-11 6-21 0Z" />
    </g>
  </g>
);

const SeatedWeapon = ({ product, steel }: { product: SkinProduct; steel: string }) => {
  const sheathed = product.id === 'bamboo-vigil' || product.id === 'moonlit-crane';
  const broad = product.id === 'mist-wanderer' || product.id === 'tidebreaker-vow';
  const equipment = {
    'mist-wanderer': 'traveler-dao', 'bamboo-vigil': 'sword-scabbard',
    'tidal-swordsman': 'long-jian', 'moonlit-crane': 'silver-scabbard',
    'jade-moon-oath': 'ornamental-sword', 'tidebreaker-vow': 'long-broad-dao',
    'crimson-lotus-shadow': 'slender-assassin-blade',
  }[product.id];
  return (
    <g data-equipment={equipment} data-part="grounded-sword" transform="translate(-18 0)">
      <path d={broad ? 'm191 226 1 42q0 9 6 13l9-12-3-43Z' : 'm194 226 1 45 3 10 4-10 1-45Z'}
        fill={sheathed ? '#343a3b' : `url(#${steel})`} stroke="#b2bab4" strokeWidth="1.5" />
      <path d="M186 222q12-5 24 0l-2 5h-20Z" fill={product.accent} stroke={ink} strokeWidth="1.5" />
      <path d="M194 207h8v14h-8Z" fill="#55534a" stroke="#c0baa5" strokeWidth="2" />
      <path d="m194 211 8 2m-8 2 8 2" stroke={product.accent} strokeWidth="2" />
      <path d="M192 205h12v4h-12Z" fill="#d3ccb4" stroke={ink} />
    </g>
  );
};

const SeatedArms = ({ crane, ranger }: { crane: boolean; ranger: boolean }) => (
  <g data-part="resting-arms" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M101 192 78 233 81 264M139 192 180 207 158 236" stroke={ink} strokeWidth="11" />
    <path d="M101 192 78 233 81 264M139 192 180 207 158 236" stroke={paper} strokeWidth="5" />
    {crane && <g data-equipment="crane-sleeves" fill={paper} stroke="#9098a1" strokeWidth="2">
      <path d="m99 183-21 31-5 22 17 10 12-30 18-15Zm40 0 28 7 15 13-17 21-19-18-12-7Z" />
      <path d="m79 217-2 16 10 6m74-42 15 7-14 14" fill="none" stroke="#757f89" />
    </g>}
    {ranger && <g fill="#665744" stroke="#b7a686" strokeWidth="1.5">
      <path d="m76 254 8 0 1 8-8 0Zm81-23 7-8 6 5-7 8Z" />
    </g>}
    <circle cx="81" cy="264" r="4" fill={paper} stroke={ink} strokeWidth="1.5" />
    <circle cx="158" cy="236" r="4" fill={paper} stroke={ink} strokeWidth="1.5" />
  </g>
);

const StickLimbs = () => (
  <g data-part="stick-limbs" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M101 112 78 145 62 172M139 112 160 143 177 158M109 182 102 225 91 267M131 182 138 225 153 266" stroke={ink} strokeWidth="11" />
    <path d="M101 112 78 145 62 172M139 112 160 143 177 158M109 182 102 225 91 267M131 182 138 225 153 266" stroke={paper} strokeWidth="5" />
    <g fill={paper} stroke={ink} strokeWidth="2">
      <circle cx="78" cy="145" r="4" /><circle cx="160" cy="143" r="4" />
      <circle cx="102" cy="225" r="4" /><circle cx="138" cy="225" r="4" />
      <circle cx="62" cy="172" r="5" /><circle cx="177" cy="158" r="5" />
    </g>
    <path d="m91 267-11 4m73-5 12 4" stroke={paper} strokeWidth="7" />
  </g>
);

const WuxiaCharacter = ({ product, pose = 'standing' }: { product: SkinProduct; pose?: 'standing' | 'seated' }) => {
  const instance = useId().replace(/:/g, '');
  const silk = `wuxia-silk-${instance}`;
  const steel = `wuxia-steel-${instance}`;
  const seatedBody = `wuxia-seated-body-${instance}`;
  const seated = pose === 'seated';
  const a = product.accent;
  if (!isWuxiaSkinId(product.id)) return null;
  return (
    <g className="wuxia-character" data-skin-id={product.id} data-pose={pose} strokeLinejoin="round" strokeLinecap="round">
      <defs>
        <linearGradient id={silk} x1="0" y1="0" x2="1" y2=".8"><stop stopColor="#717777" /><stop offset=".43" stopColor="#292f32" /><stop offset="1" stopColor="#101416" /></linearGradient>
        <linearGradient id={steel} x1="0" y1="0" x2="1" y2=".2"><stop stopColor="#6e7c81" /><stop offset=".46" stopColor="#f4f1e6" /><stop offset=".52" stopColor="#a4b4b9" /><stop offset="1" stopColor="#e4e5dc" /></linearGradient>
        {seated && <clipPath id={seatedBody}><rect width="240" height="218" /></clipPath>}
      </defs>
      {!seated && <StickLimbs />}
      <g transform={seated ? 'translate(0 100) scale(1 .82)' : undefined} clipPath={seated ? `url(#${seatedBody})` : undefined}>
      {seated && <g className="night-wind-cloth" data-equipment="wind-cape" fill="#343a3c" stroke={a} strokeWidth="1.5">
        <path d="M103 96Q79 117 64 151q-15 32-39 45 26 23 55 10l22-26 18-49 18 47 22 20-6-56-17-46Z" />
        <path d="M96 115q-21 66-49 83m42-39-19 36m64-79 13 54" fill="none" strokeOpacity=".5" />
      </g>}
      {/* Rear equipment leaves the thin limbs and their joints visible. */}
      {product.id === 'mist-wanderer' && <g className={seated ? 'night-wind-cloth' : undefined} data-equipment="straw-rain-cape" stroke="#a0a18d" strokeWidth="1.2">
        <path d="M100 93 82 105 67 157 83 150 76 177 95 167 88 194 110 180 121 191 135 180 155 194 148 164 168 176 158 145 173 152 154 105 137 93Z" fill="#4e5547" />
        {[0, 1, 2, 3].map(row => <path key={row} d={`M${87 - row * 3} ${110 + row * 17}q32 20 ${65 + row * 5} 0l-5 16-8-7-7 9-8-8-9 7-8-9-9 5Z`} fill={row % 2 ? '#70745d' : '#85866b'} />)}
        {[88, 100, 112, 124, 136, 148].map(x => <path key={x} d={`M${x} 110l-7 48m9-31-5 43`} opacity=".7" />)}
      </g>}
      {!seated && product.id === 'bamboo-vigil' && <g data-equipment="sword-scabbard" transform="rotate(22 140 165)">
        <path d="M145 95h10v140l-5 12-5-12Z" fill="#393f34" stroke="#9b9d82" strokeWidth="2" />
        <path d="M142 119h16v8h-16Zm3 105h10v8h-10Z" fill={a} />
        <path d="M146 76h8v38h-8Z" fill="#b1a88c" stroke={ink} strokeWidth="2" /><path d="m147 83 6 4m-6 4 6 4m-6 4 6 4m-6 4 6 4" fill="none" stroke={ink} strokeWidth="2" />
      </g>}
      {product.id === 'moonlit-crane' && <g className={seated ? 'night-wind-cloth' : undefined} data-equipment="crane-cape">
        <path d="M104 95Q71 119 45 219l42-12 17 21 20-51 20 50 20-22 35 11q-22-95-61-121Z" fill="#5c626b" stroke="#b4bac0" strokeWidth="2" />
        <path d="m103 111-44 95 29-15m48-81 49 91-26-12" fill="none" stroke="#969ca3" strokeWidth="3" />
        <path d="m157 139 12 14-8 17 14-5 6-14-8-8 9-8-14 2-10-7Z" fill={paper} />
        {!seated && <path data-equipment="silver-scabbard" d="m151 118 27 117 7-2-27-118Z" fill="#292e35" stroke="#c0c3c8" strokeWidth="2" />}
      </g>}
      {product.id === 'jade-moon-oath' && <g className={seated ? 'night-wind-cloth' : undefined} data-equipment="ceremonial-silk">
        <path d="m103 94-16 15-12 113 25-11 20 27 19-27 28 10-15-112-16-15Z" fill={`url(#${silk})`} stroke="#879e95" strokeWidth="2" />
        <path d="m100 115-9 95 14-10 15 25 14-25 17 10-12-95" fill="none" stroke={a} strokeWidth="3" /><path d="m108 133-4 52 16 18 15-18-7-52Z" fill="#314b42" stroke="#adc2ae" />
      </g>}
      {product.id === 'tidebreaker-vow' && <g data-equipment="layered-armor">
        <path d="m98 94-18 19 15 14-10 77 24-9 11 15 12-15 26 9-13-77 16-14-21-19Z" fill="#303d4a" stroke="#9daeb8" strokeWidth="2" />
        <path d="m92 108 28-9 28 9-5 14-23-7-22 7Zm7 17 21-8 21 8-3 18-18-5-18 5Zm3 23 18-6 18 6-2 18-16-5-16 5Zm-3 28 21-10 23 10 7 16-22-5-8 11-9-11-20 5Z" fill="#657786" stroke="#c0c8ca" strokeWidth="1.5" />
        <g fill={paper}>{[104, 136].map(x => <g key={x}><circle cx={x} cy="112" r="2" /><circle cx={x + (x < 120 ? 4 : -4)} cy="132" r="2" /></g>)}</g>
      </g>}
      {product.id === 'crimson-lotus-shadow' && <g className={seated ? 'night-wind-cloth' : undefined} data-equipment="short-split-cape">
        <path d="m103 91-19 10-23 43 26-7 8 29 24-17 29 24-2-40 35 9-31-39-16-12Z" fill="#393137" stroke="#ad9292" strokeWidth="2" />
        <path d="m91 109-16 26 22-11m41-19 25 26-25-10" fill="#5c3a40" stroke={a} /><path d="m104 106-12 74 15 22 13-18 15 18 14-22-15-74Z" fill="#20272b" stroke="#7b7979" strokeWidth="2" />
      </g>}
      {['mist-wanderer', 'bamboo-vigil', 'tidal-swordsman', 'moonlit-crane'].includes(product.id) && <g className={seated ? 'night-wind-cloth' : undefined} data-equipment="tailored-robe">
        <path d={product.id === 'bamboo-vigil' ? 'M104 93 95 103 96 157 89 192 108 187 120 202 132 187 151 192 142 157 143 103 135 93Z' : 'M104 93 93 107 101 153 85 209 107 198 120 217 135 198 155 208 139 153 147 107 136 93Z'} fill={`url(#${silk})`} stroke="#a7ada6" strokeWidth="1.8" />
        <path d="m104 95 17 25 15-25-5 41-16 22-8-5 17-29Z" fill={product.id === 'moonlit-crane' ? paper : '#87938a'} stroke={ink} strokeWidth="1.5" />
        <path d="m112 165-10 29m23-28 13 29" fill="none" stroke={a} strokeWidth="3" />
        {product.id === 'tidal-swordsman' && <path data-equipment="layered-tide-hem" d="m100 157-15 49 22-9 13 17 14-17 21 9-7-22-15-4-13 13-11-13-17 5 8-28Z" fill="#537484" stroke="#a6bbc2" strokeWidth="2" />}
      </g>}
      {product.id === 'bamboo-vigil' && <g data-equipment="leather-collar-cuffs">
        <path d="m103 94 17 19-9 15-16-23Zm34 0-17 19 10 15 15-23Z" fill="#84745a" stroke="#c6b596" strokeWidth="1.5" />{!seated && <path d="m79 139-8 13 9 7 9-13Zm78-3 11 13-8 8-11-14Z" fill="#665744" stroke="#b7a686" strokeWidth="2" />}
        <path d="m99 134 5 16m33-16-5 16m-26-10h27" fill="none" stroke="#c0b18e" strokeWidth="1.5" strokeDasharray="2 4" />
      </g>}
      {product.id === 'mist-wanderer' && <g data-equipment="layered-straw-shoulders" stroke="#c0b68c" strokeWidth="1.1">
        <path d="m102 96 13 13-7 20-8-6-6 9-6-6-10 5 9-25Z" fill="#87866b" />
        <path d="m138 96-14 13 6 20 8-6 7 9 6-6 11 5-9-25Z" fill="#87866b" />
        <path d="m92 116 11 7 8-7-5 20-8-6-7 12-8-6-11 6 9-25Zm43 2 8 6 11-8 8 16 10 10-12-5-8 8-8-13-8 6Z" fill="#6f745b" />
        <path d="m93 104-6 22m12-15-6 20m13-15-6 18m40-29 7 23m-13-17 8 23m8-24 9 24" fill="none" />
      </g>}
      {!seated && product.id === 'moonlit-crane' && <g data-equipment="crane-sleeves" fill={paper} stroke="#9098a1" strokeWidth="2">
        <path d="m95 104-22 27-20 26 28 23 7-34 20-25Z" /><path d="m145 104 23 23 24 21-21 29-13-32-24-23Z" /><path d="m75 150-12 12 13 7m89-20 16 5-9 13" fill="none" stroke="#757f89" />
        <path d="m67 176-5 11m115-19 8 12" fill="none" stroke={paper} strokeWidth="5" />
        <circle cx="62" cy="187" r="5" fill={paper} stroke={ink} /><circle cx="185" cy="180" r="5" fill={paper} stroke={ink} />
      </g>}
      <g data-part="belt" stroke={ink} strokeWidth="2"><path d="M99 150q21 5 42 0l2 11q-23 5-46 0Z" fill={product.id === 'bamboo-vigil' ? '#9d8760' : a} /><rect x="114" y="151" width="13" height="10" rx="2" fill="#c4c4b3" />
        {product.id === 'jade-moon-oath' && <path data-equipment="jade-moon-clasp" d="M128 154a11 11 0 1 1-10-12 8 8 0 0 0 10 12Z" fill="#99d0af" stroke="#d0dbc4" strokeWidth="1.5" />}
      </g>
      </g>
      {seated && <>
        <path data-part="grounded-hips" d="m101 234-12 25q-3 15 14 20h34q17-5 14-20l-12-25Z" fill={`url(#${silk})`} stroke="#a7ada6" strokeWidth="1.8" />
        <path d="m103 247 7 23 10 4 10-4 7-23" fill="none" stroke={a} strokeWidth="2" />
        <SeatedLegs accent={a} wrapped={product.id === 'crimson-lotus-shadow'} />
        <SeatedWeapon product={product} steel={steel} />
        <SeatedArms crane={product.id === 'moonlit-crane'} ranger={product.id === 'bamboo-vigil'} />
      </>}
      <g transform={seated ? 'translate(0 87)' : undefined}>
      <path data-part="neck" d={seated ? 'M120 91.5v5.5' : 'M120 86v11'} fill="none" stroke={paper} strokeWidth="6" />
      <g transform={seated ? 'translate(0 3.5)' : undefined}>
      <circle data-part="round-head" cx="120" cy="69" r="21" fill={paper} stroke={ink} strokeWidth="3" /><path d="M102 65q6-22 31-12l7 13-10-8-16 1Z" fill="#20272a" /><path d="m110 72 3 1m15-1 3-1" fill="none" stroke={ink} strokeWidth="2" />
      {product.id === 'mist-wanderer' && <g data-equipment="woven-douli" stroke="#d0c19a" strokeWidth="1.2">
        <path d="m76 58 43-32 44 32-8 8q-36 10-72 0Z" fill="#7e795b" /><path d="m80 57 38-26 41 26-4 4H85Z" fill="#a29770" />
        {[88, 98, 108, 130, 140, 150].map(x => <path key={x} d={`m119 31 ${x - 119} 28`} />)}<path d="m101 44 36 0m-47 8h59m-64 9h70" fill="none" stroke="#4d513e" /><path d="m98 68 7 23m36-23-7 23" fill="none" stroke="#b6a77e" strokeWidth="2" />
      </g>}
      {product.id === 'bamboo-vigil' && <g data-equipment="ranger-hat" stroke="#beb59b" strokeWidth="2"><path d="m101 49 8-17 24 3 10 18 17 9-39 5-43-6Z" fill="#42493a" /><path d="m104 49 30 3-3-14-19-2Z" fill="#747457" /><path d="m144 58 20-16-4 21Z" fill={a} /></g>}
      {product.id === 'tidal-swordsman' && <g data-equipment="tide-headband"><path d="M100 59q20-8 40 0v8q-21-7-40 0Z" fill={a} stroke="#b8c8c9" /><path d="m140 61 29-8-9 11 8 9-27-8Z" fill="#527c90" /></g>}
      {product.id === 'moonlit-crane' && <g data-equipment="silver-hair-ornament" fill="#e3e2d9" stroke="#878f97" strokeWidth="1.5"><path d="m109 49 1-12 9-5 11 5 2 13Z" fill="#4c535b" /><path d="m99 43 43-3-7 6-31 2Z" /><circle cx="146" cy="45" r="4" /><path d="m145 49 6 14-4 11-6-10Z" /></g>}
      {product.id === 'jade-moon-oath' && <g data-equipment="ceremonial-crown" stroke="#c3cfad" strokeWidth="1.5"><path d="m105 53-1-16 9-4V25h14v8l10 4-2 16Z" fill="#4b6d5c" /><path d="m104 41-15-5 6 12 11 2m30-9 14-5-5 12-10 2" fill="#526a58" /><path d="M106 49h28v7h-28Z" fill="#b8b798" /><path d="m120 32 5 10-5 6-5-6Z" fill="#9ad4b3" /><path d="m140 51 9 44-8-5-5-36Z" fill={a} /></g>}
      {product.id === 'tidebreaker-vow' && <g data-equipment="armored-headband"><path d="m101 57 7-12 25 1 8 13-11-5-10 7-10-7Z" fill="#8c9caa" stroke="#d2d5ce" strokeWidth="2" /><path d="m140 57 19 10-17 3Z" fill={a} /></g>}
      {product.id === 'crimson-lotus-shadow' && <g data-equipment="mask-and-leg-wraps">
        <path d="M100 64q0-24 20-25 23 2 22 26l-10-12-23 5Z" fill="#292930" stroke="#9f8585" strokeWidth="2" /><path d="m101 74 18 4 21-7-4 17-15 8-17-10Z" fill="#5a343c" stroke="#bd8c8c" strokeWidth="1.5" /><path d="m139 78 29 10-8 4 5 10-27-18Z" fill={a} />
        {!seated && <><path d="m99 232-6 24 9 3 6-25Zm37 1 6 25 9-3-7-24Z" fill="#6e6664" stroke="#cbc1b5" strokeWidth="1.5" /><path d="m97 237 8 6-10 2 7 6m37-14 8 2-6 7 9 2" fill="none" stroke="#d3c7b6" strokeWidth="2" /></>}
      </g>}
      </g>
      </g>
      {/* Closed blade shapes give each weapon a real edge, guard and grip. */}
      {!seated && <>
      {product.id === 'mist-wanderer' && <g data-equipment="traveler-dao" transform="rotate(17 62 172)"><path d="m58 177-4 65q1 15 11 21l5-86Z" fill={`url(#${steel})`} stroke="#9eaaa8" strokeWidth="1.5" /><path d="M55 176h17v6H55Z" fill="#a18e64" stroke={ink} /><path d="M59 157h8v20h-8Z" fill="#5a4d37" stroke="#baaa84" strokeWidth="2" /></g>}
      {product.id === 'tidal-swordsman' && <g data-equipment="long-jian" transform="rotate(14 177 158)"><path d="m173 136 1-102 5-15 5 15 1 102-6 7Z" fill={`url(#${steel})`} stroke="#b6cbd1" strokeWidth="1.5" /><path d="m179 29 1 103" fill="none" stroke="#eff3e9" strokeWidth="1.5" /><path d="m166 138 13-4 14 4-2 6-12-3-11 3Z" fill="#b1bcae" stroke={ink} strokeWidth="1.5" /><path d="M175 143h8v24h-8Z" fill="#4f6673" stroke="#c0c4ae" strokeWidth="2" /><path d="m174 151 10 4m-10 3 10 4" stroke={ink} strokeWidth="2" /><path d="m179 168q-15 13-7 29l7-9 5 8q8-20-5-28Z" fill={a} stroke="#b4c8c9" /></g>}
      {product.id === 'jade-moon-oath' && <g data-equipment="ornamental-sword" transform="rotate(-19 177 159)"><path d="m173 170 1 72 5 16 5-16 1-72Z" fill={`url(#${steel})`} stroke="#adbeb0" strokeWidth="1.5" /><path d="m163 169 15-5 16 5-4 6-11-5-11 5Z" fill="#bfb391" stroke={ink} /><path d="M175 145h8v20h-8Z" fill="#7fb194" stroke="#d5cfaa" strokeWidth="2" /><path d="m179 182-3 49m3-41 4 12-4 10-3-10Z" fill="none" stroke="#587d69" strokeWidth="2" /></g>}
      {product.id === 'tidebreaker-vow' && <g data-equipment="long-broad-dao" transform="rotate(15 177 158)"><path d="m173 137-3-92 6-28q6 5 10 17l9 100-11 10Z" fill={`url(#${steel})`} stroke="#d1d6cd" strokeWidth="2" /><path d="m176 32 6 98 10 3" fill="none" stroke="#f5f1df" strokeWidth="3" /><path d="m163 140 14-5 21 2-1 8-20-3-11 5Z" fill="#8c9b9d" stroke={ink} strokeWidth="2" /><path d="m175 144 8-1 3 29-9 1Z" fill="#35414a" stroke="#c5c1aa" strokeWidth="2" /><path d="m176 149 8 3m-7 3 8 3m-7 3 8 3m-7 3 8 3" stroke="#bcb59b" strokeWidth="2" /><path d="m181 174 12 12-5-1 3 14-12-10Z" fill={a} /></g>}
      {product.id === 'crimson-lotus-shadow' && <g data-equipment="slender-assassin-blade" transform="rotate(-28 62 172)"><path d="m58 182 1 57 4 17 4-17 1-57Z" fill={`url(#${steel})`} stroke="#b8b8b5" strokeWidth="1.5" /><path d="M53 178h20v5H53Z" fill="#bc9c8c" stroke={ink} /><path d="M59 159h8v18h-8Z" fill="#692f39" stroke="#c9a4a0" strokeWidth="2" /></g>}
      </>}
    </g>
  );
};
export default WuxiaCharacter;
