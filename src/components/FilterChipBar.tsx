import React from 'react';

export interface FilterChip<T extends string> {
  key: T;
  label: string;
}

interface Props<T extends string> {
  chips: readonly FilterChip<T>[];
  active: T;
  onSelect: (key: T) => void;
}

/**
 * Generic filter-chip bar. Renders a horizontal scrollable row of pill-shaped
 * toggle buttons with ARIA pressed semantics.
 */
const FilterChipBar = <T extends string>({ chips, active, onSelect }: Props<T>) => {
  return (
    <div className="wol-filter-bar">
      {chips.map(chip => (
        <button
          key={chip.key}
          type="button"
          className={`wol-filter-chip${active === chip.key ? ' wol-filter-chip--active' : ''}`}
          aria-pressed={active === chip.key}
          onClick={() => onSelect(chip.key)}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
};

export default FilterChipBar;
