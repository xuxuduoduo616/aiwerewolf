import React, { useRef, useState } from 'react';
import AccessibleDialog from './AccessibleDialog';

interface LeaveGameDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: React.RefObject<HTMLElement>;
}

/** Mounted for one leave request; every dismissal preserves the match. */
const LeaveGameDialog: React.FC<LeaveGameDialogProps> = ({ onCancel, onConfirm, returnFocusRef }) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [isLeaving, setIsLeaving] = useState(false);

  return (
    <AccessibleDialog
      open
      title="Leave this game?"
      description="Your current match progress will be lost. Leave the game and return to the lobby?"
      closeLabel="Cancel leaving game"
      className="leave-game-dialog"
      onClose={onCancel}
      initialFocusRef={cancelRef}
      returnFocusRef={returnFocusRef}
    >
      <div className="leave-game-dialog__actions">
        <button ref={cancelRef} type="button" className="wol-btn wol-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="wol-btn wol-btn--danger"
          disabled={isLeaving}
          onClick={event => {
            if (confirmedRef.current) return;
            confirmedRef.current = true;
            event.currentTarget.disabled = true;
            setIsLeaving(true);
            onConfirm();
          }}
        >
          {isLeaving ? 'Leaving game…' : 'Leave game'}
        </button>
      </div>
    </AccessibleDialog>
  );
};

export default LeaveGameDialog;
