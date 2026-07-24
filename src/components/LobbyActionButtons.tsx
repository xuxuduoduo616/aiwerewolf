import React from 'react';
import { Eye, Lock, LogIn, PlusSquare } from 'lucide-react';

const LobbyActionButtons: React.FC = () => {
  return (
    <div>
      <div className="wol-room-actions" aria-label="Room actions" aria-describedby="room-actions-status">
        {/* 建房 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--build"
          title="Create multiplayer room is unavailable"
          disabled
        >
          <PlusSquare aria-hidden="true" />
          <span>Create</span>
          <small>Unavailable</small>
        </button>

        {/* 跟房 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--join"
          title="Join multiplayer room is unavailable"
          disabled
        >
          <LogIn aria-hidden="true" />
          <span>Join</span>
          <small>Unavailable</small>
        </button>

        {/* 观战 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--spectate"
          title="Spectate multiplayer room is unavailable"
          disabled
        >
          <Eye aria-hidden="true" />
          <span>Spectate</span>
          <small>Unavailable</small>
        </button>
      </div>
      <p className="wol-room-actions-status" id="room-actions-status" role="status">
        <Lock aria-hidden="true" />
        Live multiplayer rooms are planned for a later stage. No room is created or connected here.
      </p>
    </div>
  );
};

export default LobbyActionButtons;
