import { useEffect, useState } from 'react';
import type { UseEconomyResult } from '../hooks/useEconomy';
import { SKIN_CATALOG_BY_ID, type SkinProduct } from './catalog';

type EquipmentEconomy = Pick<UseEconomyResult, 'mode' | 'phase' | 'state' | 'ledgerCorrupt'>;

export type AvatarFrameId = 'ink-ring' | 'crimson-moon';

/** Cosmetic lookup only; ownership and the current verified catalog remain authoritative. */
export const resolveEquippedSkinProduct = (economy: EquipmentEconomy): SkinProduct | null => {
  const id = economy.state.equippedSkinId;
  if (economy.phase !== 'ready' || economy.ledgerCorrupt || !id
    || !economy.state.inventory.includes(`skin:${id}`)) return null;
  const product = SKIN_CATALOG_BY_ID.get(id);
  if (!product) return null;
  if (economy.mode === 'guest') return product;
  const item = economy.state.accountCatalog.find(entry => entry.id === id && entry.itemKind === 'skin');
  return item ? { ...product, name: item.name } : null;
};

const hasVerifiedFrame = (economy: EquipmentEconomy, frameId: AvatarFrameId): boolean => {
  const assetId = `avatar-frame:${frameId}`;
  if (!economy.state.inventory.includes(assetId)) return false;
  if (economy.mode === 'guest') return true;
  return economy.state.accountCatalog.some(entry => entry.id === assetId && entry.itemKind === 'avatar_frame');
};

/** Highest-tier owned avatar frame (crimson-moon > ink-ring) when economy state is ready. */
export const resolveEquippedAvatarFrame = (economy: EquipmentEconomy): AvatarFrameId | null => {
  if (economy.phase !== 'ready' || economy.ledgerCorrupt) return null;
  if (hasVerifiedFrame(economy, 'crimson-moon')) return 'crimson-moon';
  if (hasVerifiedFrame(economy, 'ink-ring')) return 'ink-ring';
  return null;
};

/** Hide the previous subject's snapshot during the hook's boundary-clearing commit. */
export const useEquippedSkinProduct = (economy: EquipmentEconomy, principalId: string | null): SkinProduct | null => {
  const [visiblePrincipal, setVisiblePrincipal] = useState(principalId);
  useEffect(() => { setVisiblePrincipal(principalId); }, [principalId]);
  return principalId && visiblePrincipal === principalId ? resolveEquippedSkinProduct(economy) : null;
};

/** Hide the previous subject's avatar frame during the hook's boundary-clearing commit. */
export const useEquippedAvatarFrame = (economy: EquipmentEconomy, principalId: string | null): AvatarFrameId | null => {
  const [visiblePrincipal, setVisiblePrincipal] = useState(principalId);
  useEffect(() => { setVisiblePrincipal(principalId); }, [principalId]);
  return principalId && visiblePrincipal === principalId ? resolveEquippedAvatarFrame(economy) : null;
};
