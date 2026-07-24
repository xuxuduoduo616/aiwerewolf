import React from 'react';
import { Eye, LogIn, PlusSquare } from 'lucide-react';

interface Props {
  onBuildRoom: () => void;
  onJoinRoom: () => void;
  onSpectate: () => void;
}

const LobbyActionButtons: React.FC<Props> = ({ onBuildRoom, onJoinRoom, onSpectate }) => {
  return (
    <div className="wol-room-actions" aria-label="房间操作">
      {/* 建房 */}
      <button
        type="button"
        onClick={onBuildRoom}
        className="wol-room-action wol-room-action--build"
      >
        <PlusSquare aria-hidden="true" />
        <span>建房</span>
      </button>

      {/* 跟房 */}
      <button
        type="button"
        onClick={onJoinRoom}
        className="wol-room-action wol-room-action--join"
      >
        <LogIn aria-hidden="true" />
        <span>跟房</span>
      </button>

      {/* 观战 */}
      <button
        type="button"
        onClick={onSpectate}
        className="wol-room-action wol-room-action--spectate"
      >
        <Eye aria-hidden="true" />
        <span>观战</span>
      </button>
    </div>
  );
};

export default LobbyActionButtons;
