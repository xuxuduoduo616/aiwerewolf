import React from 'react';
import type { SkinProduct } from '../economy/catalog';
import WuxiaCharacter, { isWuxiaSkinId } from './WuxiaCharacter';

/** One coordinate space keeps the moon, distant roofs and foreground feet aligned. */
const LobbyVillageScene = ({ equippedSkin }: { equippedSkin?: SkinProduct | null }) => {
  const product = equippedSkin && isWuxiaSkinId(equippedSkin.id) ? equippedSkin : null;
  return (
    <div className="night-village-art" data-equipped-skin={product?.id ?? 'default'}>
      <svg viewBox="0 0 360 420" fill="none" role="img"
        aria-label={`${product ? `${product.name} seated facing forward with an arm resting on a grounded sword` : 'A traveler in a plain coat seated facing forward with bent legs'} beneath a pale yellow moon, overlooking the village`}>
        <g aria-hidden="true">
          <circle cx="207" cy="113" r="92" stroke="#e9dca3" strokeOpacity=".09" />
          <circle cx="207" cy="113" r="73" stroke="#e9dca3" strokeOpacity=".05" />
          <path d="M220 65a48 48 0 1 0 22 81 52 52 0 0 1-22-81Z" fill="#eee0a6" />
          {/* Smaller, quieter roofs sit behind the foreground ridge. */}
          <g stroke="currentColor" strokeOpacity=".27" strokeLinejoin="round">
            <path d="M27 292 72 255 113 280 168 244 220 274 278 247 334 288" strokeOpacity=".13" />
            <path d="M48 302v-36l22-20 24 20v36m46 0v-52l26-27 27 27v52m53 0v-38l25-23 26 23v38" fill="#101012" />
            <path d="M166 223v-21m-7 7h14m-12 55h10v15h-10zm-96 9h9v12h-9zm201-1h9v12h-9z" />
          </g>
          <path d="M23 370q57-28 111-17 73-23 116 1 40-6 87 18l-7 10H30Z" fill="#17181a" />
          <path d="M23 370q57-28 111-17 73-23 116 1 40-6 87 18M50 388q126 13 257 0" stroke="currentColor" strokeOpacity=".23" />
          <ellipse cx="175" cy="353" rx="58" ry="8" fill="#08090b" opacity=".8" />
          <ellipse cx="114" cy="380" rx="15" ry="4" fill="#08090b" opacity=".8" />
          <ellipse cx="209" cy="373" rx="14" ry="4" fill="#08090b" opacity=".8" />
          {product ? (
            <g className="night-village-player" transform="translate(67 98) scale(.9)">
              <WuxiaCharacter key={product.id} product={product} pose="seated" />
            </g>
          ) : (
            <g className="night-village-player night-traveler" data-pose="seated" strokeLinecap="round" strokeLinejoin="round">
              {/* A frontal pelvis, shortened thighs and forward toe caps share one ground plane. */}
              <g className="night-traveler-cape night-wind-cloth">
                <path d="M163 276q-17 23-29 41-12 17-34 18 26 14 53 5l24-27 9-31Z" fill="#55534e" stroke="#969085" strokeWidth="1.5" />
                <path d="M160 292q-15 30-43 41m48-28-22 26" stroke="#aaa193" strokeOpacity=".5" />
              </g>
              <path data-part="grounded-hips" d="m161 275-10 14 5 31-11 21q0 12 17 12h26q17 0 17-12l-11-21 5-31-10-14Z" fill="#6a655c" stroke="#ada394" strokeWidth="1.7" />
              <path d="m164 277 11 15 11-15m-11 17v30m-18-5h36m-29 14-4 10 15 4 15-4-4-10" stroke="#c0b5a3" strokeWidth="1.5" />
              <path d="M164 342 135 333 119 362M186 342 205 316 208 355" stroke="#171b1d" strokeWidth="11" />
              <path d="M164 342 135 333M186 342 205 316" stroke="#969184" strokeWidth="6" />
              <path d="M135 333 119 362M205 316 208 355" stroke="#c1bdb0" strokeWidth="5" />
              <g fill="#c1bdb0" stroke="#252a2b" strokeWidth="1.8">
                <circle cx="135" cy="333" r="5" /><circle cx="205" cy="316" r="5" />
                <path d="M114 358q5-2 10 2l-3 18q-11 4-21-2Z" />
                <path d="M203 353q5-3 10 0l6 18q-12 6-22 0Z" />
              </g>
              <path d="M157 289 136 318 144 335M193 289 205 314 189 322" stroke="#272b2c" strokeWidth="10" />
              <path d="M157 289 136 318 144 335M193 289 205 314 189 322" stroke="#c1bdb0" strokeWidth="4" />
              <path data-part="neck" d="M175 268v8" stroke="#c1bdb0" strokeWidth="6" />
              <circle cx="175" cy="253" r="16" fill="#d3cfc2" stroke="#252a2b" strokeWidth="2.5" />
            </g>
          )}
        </g>
      </svg>
      <span className="night-eyebrow">Shadows of the village</span>
    </div>
  );
};

export default LobbyVillageScene;
