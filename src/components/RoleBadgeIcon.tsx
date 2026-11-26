import React from 'react';
import { Role } from '../types';

interface RoleBadgeIconProps {
  role: Role;
  size?: number;
  className?: string;
}

/**
 * Custom ink-wash prop SVG icon for each of the six assignable human roles.
 */
const RoleBadgeIcon: React.FC<RoleBadgeIconProps> = ({
  role,
  size = 18,
  className = '',
}) => {
  const commonProps = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: className ? `role-badge-icon ${className}` : 'role-badge-icon',
    'aria-hidden': true as const,
    focusable: 'false' as const,
    'data-role-icon': role,
  };

  switch (role) {
    case Role.WEREWOLF:
      return (
        <svg {...commonProps}>
          <path d="M4.5 3L9.5 8L12 7.5L14.5 8L19.5 3V11.5L21 13.5L17.5 15.5L15 19L12 21L9 19L6.5 15.5L3 13.5L4.5 11.5Z" />
          <path d="M7.2 11.5L9.8 12.7" />
          <path d="M16.8 11.5L14.2 12.7" />
          <path d="M10.5 14L12 16L13.5 14" />
          <path d="M12 16V18" />
          <path d="M10 18.5L10.6 20" />
          <path d="M14 18.5L13.4 20" />
        </svg>
      );
    case Role.SEER:
      return (
        <svg {...commonProps}>
          <path d="M2.5 12C5 7.5 8.5 5.5 12 5.5C15.5 5.5 19 7.5 21.5 12C19 16.5 15.5 18.5 12 18.5C8.5 18.5 5 16.5 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5V4" />
          <path d="M12 20V21.5" />
        </svg>
      );
    case Role.WITCH:
      return (
        <svg {...commonProps}>
          <path d="M9.5 3.5H14.5" />
          <path d="M10.5 3.5V7.5L5.8 15.8C5 17.2 6 19 7.6 19H16.4C18 19 19 17.2 18.2 15.8L13.5 7.5V3.5" />
          <path d="M7.5 14.5H16.5" />
          <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case Role.HUNTER:
      return (
        <svg {...commonProps}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 2.5V7" />
          <path d="M12 17V21.5" />
          <path d="M2.5 12H7" />
          <path d="M17 12H21.5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case Role.IDIOT:
      return (
        <svg {...commonProps}>
          <path d="M4.5 15.5L6.5 8L10 11.5L12 5.5L14 11.5L17.5 8L19.5 15.5Z" />
          <path d="M5.5 18.5H18.5" />
          <circle cx="6.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="5" r="1" fill="currentColor" stroke="none" />
          <circle cx="17.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case Role.VILLAGER:
    default:
      return (
        <svg {...commonProps}>
          <path d="M9 4.5H15" />
          <path d="M8 7.5H16L17 17.5H7L8 7.5Z" />
          <path d="M12 10.5V14.5" />
          <path d="M7.5 20H16.5" />
        </svg>
      );
  }
};

export default RoleBadgeIcon;
