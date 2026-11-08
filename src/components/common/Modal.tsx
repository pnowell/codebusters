import React, { useEffect, useRef } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  backdropClassName?: string;
  dialogClassName?: string;
  children: React.ReactNode;
}

/**
 * Unified accessible modal wrapper providing consistent backdrop click handling,
 * Escape-to-close dismissal, background input focus isolation, and ARIA dialog
 * semantics across all app dialogs.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  closeOnBackdrop = true,
  closeOnEscape = true,
  backdropClassName,
  dialogClassName,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const activeEl = document.activeElement;
    if (
      activeEl instanceof HTMLElement &&
      !dialogRef.current?.contains(activeEl)
    ) {
      activeEl.blur();
      dialogRef.current?.focus({ preventScroll: true });
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !closeOnEscape) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, closeOnEscape, onClose]);

  if (!isOpen) return null;

  const backdropClasses = ['modal-backdrop', backdropClassName].filter(Boolean).join(' ');
  const dialogClasses = ['modal-surface', dialogClassName].filter(Boolean).join(' ');

  return (
    <div
      className={backdropClasses}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={dialogClasses}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
      >
        {children}
      </div>
    </div>
  );
};
