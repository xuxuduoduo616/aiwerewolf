import React from 'react';
import type { DisplayLanguage } from '../i18n';
import type { Role } from '../types';
import { getRoleShowcaseSpec, getShowcaseText } from '../services/roleShowcaseConfig';
import RoleBadgeIcon from './RoleBadgeIcon';

export interface RoleIdentityBadgeProps {
  role: Role;
  language: DisplayLanguage;
  onOpenReplay: () => void;
  disabled?: boolean;
}

/**
 * Compact bottom-left identity pill for human seat 1. Reopens the role showcase
 * in replay mode without modifying introPending or match timers.
 */
const RoleIdentityBadge = React.forwardRef<HTMLButtonElement, RoleIdentityBadgeProps>(
  ({ role, language, onOpenReplay, disabled = false }, ref) => {
    const spec = getRoleShowcaseSpec(role);
    const badgeLabel = getShowcaseText(spec.badgeLabel, language);

    return (
      <button
        ref={ref}
        type="button"
        onClick={onOpenReplay}
        disabled={disabled}
        className="role-identity-badge"
        aria-label={`View ${spec.roleTitle.en} role showcase`}
        aria-haspopup="dialog"
        data-role-slug={spec.slug}
      >
        <RoleBadgeIcon role={role} size={18} />
        <span
          className="role-identity-badge__label"
          data-ui-copy-category="AI_OR_PLAYER_SPEECH_OR_CHAT"
        >
          {badgeLabel}
        </span>
      </button>
    );
  },
);

RoleIdentityBadge.displayName = 'RoleIdentityBadge';

export default RoleIdentityBadge;
