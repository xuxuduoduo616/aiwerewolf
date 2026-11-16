import React from 'react';
import SkinCollectionPanel, { type SkinCollectionProps } from './SkinCollectionPanel';

/** Outfits and Skins use the same verified wardrobe, including the original. */
const OutfitsPanel: React.FC<SkinCollectionProps> = props => <SkinCollectionPanel {...props} />;

export default OutfitsPanel;
