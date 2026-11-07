import { useEffect, useState } from 'react';
import type { UseEconomyResult } from '../hooks/useEconomy';
import { SKIN_CATALOG_BY_ID, type SkinProduct } from './catalog';

type EquipmentEconomy = Pick<UseEconomyResult, 'mode' | 'phase' | 'state' | 'ledgerCorrupt'>;

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

/** Hide the previous subject's snapshot during the hook's boundary-clearing commit. */
export const useEquippedSkinProduct = (economy: EquipmentEconomy, principalId: string | null): SkinProduct | null => {
  const [visiblePrincipal, setVisiblePrincipal] = useState(principalId);
  useEffect(() => { setVisiblePrincipal(principalId); }, [principalId]);
  return principalId && visiblePrincipal === principalId ? resolveEquippedSkinProduct(economy) : null;
};
