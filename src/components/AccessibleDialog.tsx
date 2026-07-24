import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

type ScrollLockStyle = Pick<CSSStyleDeclaration, 'overflow'>;

let activeScrollLocks = 0;
let overflowBeforeFirstLock = '';

/** Acquire a nest-safe body scroll lock and return its idempotent release. */
export const acquireDocumentScrollLock = (style: ScrollLockStyle): (() => void) => {
  if (activeScrollLocks === 0) overflowBeforeFirstLock = style.overflow;
  activeScrollLocks += 1;
  style.overflow = 'hidden';

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeScrollLocks = Math.max(0, activeScrollLocks - 1);
    if (activeScrollLocks === 0) style.overflow = overflowBeforeFirstLock;
  };
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(element => (
    !element.hidden
    && element.getAttribute('aria-hidden') !== 'true'
    && element.getClientRects().length > 0
  ));

/** Returns the element that should receive focus when Tab wraps the dialog. */
export const getFocusLoopTarget = <T,>(
  focusable: readonly T[],
  current: T | null,
  reverse: boolean,
): T | null | undefined => {
  if (focusable.length === 0) return null;

  const currentIndex = current === null ? -1 : focusable.indexOf(current);
  if (currentIndex === -1) return reverse ? focusable[focusable.length - 1] : focusable[0];
  if (reverse && currentIndex === 0) return focusable[focusable.length - 1];
  if (!reverse && currentIndex === focusable.length - 1) return focusable[0];
  return undefined;
};

type BackdropMouseDownEvent = Pick<
  React.MouseEvent<HTMLDivElement>,
  'currentTarget' | 'preventDefault' | 'target'
>;

export const closeOnBackdropMouseDown = (
  event: BackdropMouseDownEvent,
  onClose: () => void,
): boolean => {
  if (event.target !== event.currentTarget) return false;

  // Keep the remaining pointer sequence from overriding cleanup focus restore.
  event.preventDefault();
  onClose();
  return true;
};

interface AccessibleDialogProps {
  open: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
  onClose: () => void;
  description?: React.ReactNode;
  closeLabel?: string;
  className?: string;
  initialFocusRef?: React.RefObject<HTMLElement>;
  returnFocusRef?: React.RefObject<HTMLElement>;
}

const AccessibleDialog: React.FC<AccessibleDialogProps> = ({
  open,
  title,
  description,
  children,
  onClose,
  closeLabel = 'Close dialog',
  className = '',
  initialFocusRef,
  returnFocusRef,
}) => {
  const reactId = useId().replace(/:/g, '');
  const titleId = `dialog-title-${reactId}`;
  const descriptionId = `dialog-description-${reactId}`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const releaseScrollLock = acquireDocumentScrollLock(document.body.style);

    const focusDialog = () => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const preferred = initialFocusRef?.current;
      const target = preferred && dialog.contains(preferred)
        ? preferred
        : getFocusableElements(dialog)[0] ?? dialog;
      target.focus();
    };

    const animationFrame = window.requestAnimationFrame(focusDialog);

    const handleKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(dialog);
      const current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      const target = getFocusLoopTarget(focusable, current, event.shiftKey);
      if (target !== undefined) {
        event.preventDefault();
        (target ?? dialog).focus();
      }
    };

    const handleFocusIn = (event: FocusEvent) => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(event.target as Node)) return;
      (getFocusableElements(dialog)[0] ?? dialog).focus();
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('focusin', handleFocusIn);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('focusin', handleFocusIn);
      releaseScrollLock();

      const restoreTarget = returnFocusRef?.current ?? previousFocusRef.current;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [initialFocusRef, open, returnFocusRef]);

  if (!open) return null;

  return (
    <div
      className="accessible-dialog__backdrop"
      onMouseDown={event => closeOnBackdropMouseDown(event, onClose)}
    >
      <div
        ref={dialogRef}
        className={`accessible-dialog${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className="accessible-dialog__header">
          <div>
            <h2 id={titleId} className="accessible-dialog__title">{title}</h2>
            {description && (
              <p id={descriptionId} className="accessible-dialog__description">{description}</p>
            )}
          </div>
          <button
            type="button"
            className="accessible-dialog__close"
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="accessible-dialog__body">{children}</div>
      </div>
    </div>
  );
};

export default AccessibleDialog;
