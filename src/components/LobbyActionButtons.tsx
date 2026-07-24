import React from 'react';
import { Eye, Lock, LogIn, PlusSquare } from 'lucide-react';

const LobbyActionButtons: React.FC = () => {
  return (
    <div>
      <div className="wol-room-actions" aria-label="房间操作" aria-describedby="room-actions-status">
        {/* 建房 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--build"
          title="真人多人建房未开放"
          disabled
        >
          <PlusSquare aria-hidden="true" />
          <span>建房</span>
          <small>未开放</small>
        </button>

        {/* 跟房 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--join"
          title="真人多人跟房未开放"
          disabled
        >
          <LogIn aria-hidden="true" />
          <span>跟房</span>
          <small>未开放</small>
        </button>

        {/* 观战 */}
        <button
          type="button"
          className="wol-room-action wol-room-action--spectate"
          title="真人多人观战未开放"
          disabled
        >
          <Eye aria-hidden="true" />
          <span>观战</span>
          <small>未开放</small>
        </button>
      </div>
      <p className="wol-room-actions-status" id="room-actions-status" role="status">
        <Lock aria-hidden="true" />
        真人房间属于后续路线，当前不创建或连接房间
      </p>
    </div>
  );
};

export default LobbyActionButtons;
