import React from 'react';
import type { SkinProduct } from '../economy/catalog';
import { DEFAULT_OUTFIT_SPEC, getSkinPortraitUrl } from '../economy/skinAssets';

interface Props {
  product?: SkinProduct;
  defaultOutfit?: boolean;
  large?: boolean;
}

const SkinArtwork: React.FC<Props> = ({ product, defaultOutfit = false, large = false }) => {
  const id = defaultOutfit || !product ? DEFAULT_OUTFIT_SPEC.id : product.id;
  const label = defaultOutfit || !product ? DEFAULT_OUTFIT_SPEC.name : product.name;
  const accent = defaultOutfit || !product ? DEFAULT_OUTFIT_SPEC.accent : product.accent;
  const tier = defaultOutfit || !product ? 'Basic' : product.tier;
  const isPremium = !defaultOutfit && product?.tier === 'Premium';

  return (
    <div
      className={`skin-artwork${large ? ' skin-artwork--large' : ''}${isPremium ? ' skin-artwork--premium' : ''}`}
      data-skin-id={id}
      data-skin-tier={tier}
      style={{ '--skin-accent': accent } as React.CSSProperties}
    >
      <img
        src={getSkinPortraitUrl(defaultOutfit ? null : product?.id)}
        alt={`${label} ink-wash portrait`}
        loading={large ? undefined : 'lazy'}
        decoding="async"
      />
    </div>
  );
};

export default SkinArtwork;
