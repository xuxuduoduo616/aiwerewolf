import React from 'react';
import type { SkinProduct } from '../economy/catalog';
import { INK_SCENES } from '../scene/inkSceneConfig';
import { isWuxiaSkinId } from '../economy/skinAssets';

interface Props {
  equippedSkin?: SkinProduct | null;
  /** 'vista' keeps the Lobby right stage open over the living village backdrop; 'card' renders a framed swordsman vignette for Profile wardrobe cards. */
  variant?: 'vista' | 'card';
  onPreviewOutfit?: () => void;
}

/**
 * Open Jianghu vista stage on the right side of the Lobby hero.
 * Retires the legacy minimalist stick-figure SVG so the living 2K ink-wash
 * Moonlit Wolf Village backdrop and floating ink-seal role orbs compose into
 * one cohesive artistic world alongside the full role portraits.
 */
const LobbyVillageScene: React.FC<Props> = ({ equippedSkin, variant = 'vista' }) => {
  const product = equippedSkin && isWuxiaSkinId(equippedSkin.id) ? equippedSkin : null;

  if (variant === 'card') {
    return (
      <div
        className="night-village-art night-village-card"
        data-equipped-skin={product?.id ?? 'default'}
        data-scene-stage="ink-card"
        role="img"
        aria-label="Lone Wuxia wanderer in a bamboo hat overlooking a moonlit ink-wash mountain valley"
      >
        <img
          className="night-village-card-img"
          src={INK_SCENES['sign-in'].imageSrc}
          alt=""
          decoding="async"
        />
        <span className="night-eyebrow night-vista-caption">Lone Jianghu Wanderer</span>
      </div>
    );
  }

  return (
    <div
      className="night-village-art night-village-vista"
      data-equipped-skin={product?.id ?? 'default'}
      data-scene-stage="ink-vista"
      role="region"
      aria-label={
        product
          ? `Moonlit Wolf Village ink-wash vista attuned to the ${product.name} outfit`
          : 'Moonlit Wolf Village ink-wash vista beneath a crimson-rimmed silver moon'
      }
    >
      <div className="night-vista-frame">
        {product && (
          <div
            className="night-vista-seal"
            data-skin-id={product.id}
            aria-hidden="true"
            style={{ '--vista-accent': product.accent } as React.CSSProperties}
          >
            <span className="night-vista-seal-ring" />
            <span className="night-vista-seal-label">
              <small>Attuned Outfit</small>
              <strong>{product.name}</strong>
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default LobbyVillageScene;
