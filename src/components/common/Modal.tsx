import React, { useEffect } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  dialogClassName?: string;
  children: React.ReactNode;
}

/**
 * Unified accessible modal wrapper providing consistent backdrop click handling,
 * Escape-to-close dismissal, and ARIA dialog semantics across all app dialogs.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  ariaLabelledBy,
  ariaLabel,
  closeOnBackdrop = true,
  backdropClassName,
  dialogClassName,
  children,
}) => {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const backdropClasses = ['modal-backdrop', backdropClassName].filter(Boolean).join(' ');
  const dialogClasses = ['modal-surface', dialogClassName].filter(Boolean).join(' ');

  return (
    <div
      className={backdropClasses}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
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
