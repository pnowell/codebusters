import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  AristocratCornerTuple,
  AristocratEditAction,
} from '../../../types';
import { isLetter } from '../../../utils/ciphers';

type PipSlot = 'center' | 'tl' | 'tr' | 'bl' | 'br';

const CORNER_SLOTS: readonly {
  slot: Exclude<PipSlot, 'center'>;
  index: 0 | 1 | 2 | 3;
  label: string;
}[] = [
  { slot: 'tl', index: 0, label: 'Top-left candidate' },
  { slot: 'tr', index: 1, label: 'Top-right candidate' },
  { slot: 'bl', index: 2, label: 'Bottom-left candidate' },
  { slot: 'br', index: 3, label: 'Bottom-right candidate' },
];

const SLOT_ORDER: readonly PipSlot[] = ['center', 'tl', 'tr', 'bl', 'br'];

interface AristocratPipPopupProps {
  cipherLetter: string;
  frequency: number;
  centerGuess: string;
  corners?: AristocratCornerTuple;
  isSelfMapped: boolean;
  duplicateWithCiphers: readonly string[];
  plainOwners: ReadonlyMap<string, readonly string[]>;
  getAnchorEl: (letter: string) => HTMLElement | null;
  onEdit: (action: AristocratEditAction) => void;
  onClose: () => void;
}

export const AristocratPipPopup: React.FC<AristocratPipPopupProps> = ({
  cipherLetter,
  frequency,
  centerGuess,
  corners,
  isSelfMapped,
  duplicateWithCiphers,
  plainOwners,
  getAnchorEl,
  onEdit,
  onClose,
}) => {
  const [prevCipherLetter, setPrevCipherLetter] = useState(cipherLetter);
  const [activeSlot, setActiveSlot] = useState<PipSlot>('center');
  if (prevCipherLetter !== cipherLetter) {
    setPrevCipherLetter(cipherLetter);
    setActiveSlot('center');
  }

  const popupRef = useRef<HTMLDivElement | null>(null);
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    arrowLeft: number;
    placedAbove: boolean;
  }>({ top: 80, left: 16, arrowLeft: 80, placedAbove: false });

  const focusHiddenInput = () => {
    hiddenInputRef.current?.focus({ preventScroll: true });
  };

  // Focus hidden input when popup opens or retargets to a new cipher letter
  useEffect(() => {
    focusHiddenInput();
  }, [cipherLetter]);

  // Compute anchored floating position relative to viewport
  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchorEl = getAnchorEl(cipherLetter);
      if (!anchorEl) return;
      const rect = anchorEl.getBoundingClientRect();
      const popupWidth = popupRef.current?.offsetWidth || 196;
      const popupHeight = popupRef.current?.offsetHeight || 192;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const anchorCenterX = rect.left + rect.width / 2;
      const clampedLeft = Math.max(
        8,
        Math.min(vw - popupWidth - 8, Math.round(anchorCenterX - popupWidth / 2))
      );
      const arrowLeft = Math.max(
        16,
        Math.min(popupWidth - 16, Math.round(anchorCenterX - clampedLeft))
      );

      const spaceBelow = vh - rect.bottom;
      const placedAbove = spaceBelow < popupHeight + 14 && rect.top > popupHeight + 14;
      const top = placedAbove
        ? Math.max(8, Math.round(rect.top - popupHeight - 8))
        : Math.min(vh - popupHeight - 8, Math.round(rect.bottom + 8));

      setCoords({ top, left: clampedLeft, arrowLeft, placedAbove });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [cipherLetter, getAnchorEl]);

  // Close when clicking/tapping outside both the popup and Replacement Table cells
  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (popupRef.current?.contains(target)) return;
      if (target.closest('[data-aristo-rep-cell]')) return;
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [onClose]);

  const cornerValues: AristocratCornerTuple = corners ?? ['', '', '', ''];
  const hasAnyCorner = cornerValues.some((c) => Boolean(c));

  const applyLetterToSlot = (slot: PipSlot, rawLetter: string) => {
    const clean = rawLetter.slice(-1).toUpperCase();
    if (!isLetter(clean)) return;

    if (slot === 'center') {
      onEdit({
        kind: 'setCenterByCipher',
        cipherLetter,
        plainLetter: clean,
      });
      return;
    }

    const found = CORNER_SLOTS.find((c) => c.slot === slot);
    if (!found) return;
    onEdit({
      kind: 'setCorner',
      cipherLetter,
      cornerIndex: found.index,
      plainLetter: clean,
    });
    // Auto-advance through corner slots (TL -> TR -> BL -> BR)
    const nextCornerIdx = (found.index + 1) % 4;
    setActiveSlot(CORNER_SLOTS[nextCornerIdx].slot);
  };

  const handleClearSlotOnBackspace = (slot: PipSlot) => {
    if (slot === 'center') {
      onEdit({
        kind: 'setCenterByCipher',
        cipherLetter,
        plainLetter: '',
      });
      return;
    }

    const found = CORNER_SLOTS.find((c) => c.slot === slot);
    if (!found) return;
    if (cornerValues[found.index]) {
      onEdit({
        kind: 'setCorner',
        cipherLetter,
        cornerIndex: found.index,
        plainLetter: '',
      });
    } else {
      const prevIdx = ((found.index + 3) % 4) as 0 | 1 | 2 | 3;
      onEdit({
        kind: 'setCorner',
        cipherLetter,
        cornerIndex: prevIdx,
        plainLetter: '',
      });
      setActiveSlot(CORNER_SLOTS[prevIdx].slot);
    }
  };

  const handleHiddenInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const last = val.slice(-1).toUpperCase();
    if (isLetter(last)) {
      applyLetterToSlot(activeSlot, last);
    }
  };

  const handleHiddenKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      handleClearSlotOnBackspace(activeSlot);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const idx = SLOT_ORDER.indexOf(activeSlot);
      const delta = e.shiftKey ? -1 : 1;
      const nextIdx = (idx + delta + SLOT_ORDER.length) % SLOT_ORDER.length;
      setActiveSlot(SLOT_ORDER[nextIdx]);
    }
  };

  const selectSlot = (slot: PipSlot, e: React.PointerEvent | React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActiveSlot(slot);
    focusHiddenInput();
  };

  const isCornerClaimedElsewhere = (ch: string): boolean => {
    if (!ch) return false;
    const owners = plainOwners.get(ch);
    return Boolean(owners && owners.some((o) => o !== cipherLetter));
  };

  const renderCornerButton = (cornerIdx: 0 | 1 | 2 | 3) => {
    const meta = CORNER_SLOTS[cornerIdx];
    const val = cornerValues[cornerIdx];
    const isActive = activeSlot === meta.slot;
    const isClaimed = isCornerClaimedElsewhere(val);

    return (
      <button
        key={meta.slot}
        type="button"
        className={`aristo-pip-slot aristo-pip-corner aristo-pip-${meta.slot}${
          isActive ? ' is-active' : ''
        }${isClaimed ? ' is-claimed' : ''}`}
        aria-label={`${meta.label} for ciphertext ${cipherLetter}`}
        aria-pressed={isActive}
        onPointerDown={(e) => selectSlot(meta.slot, e)}
        onClick={(e) => selectSlot(meta.slot, e)}
      >
        {val || ''}
      </button>
    );
  };

  let warningText: string | null = null;
  if (isSelfMapped) {
    warningText = `${cipherLetter} cannot map to itself`;
  } else if (duplicateWithCiphers.length > 0) {
    warningText = `Also mapped on ${duplicateWithCiphers.join(', ')}`;
  }

  const popupNode = (
    <div
      ref={popupRef}
      className={`aristo-pip-popup${coords.placedAbove ? ' is-above' : ''}`}
      style={{ top: `${coords.top}px`, left: `${coords.left}px` }}
      role="dialog"
      aria-label={`Replacement and candidate notes for ciphertext ${cipherLetter}`}
      onPointerDown={() => focusHiddenInput()}
    >
      <span
        className="aristo-pip-arrow"
        style={{ left: `${coords.arrowLeft}px` }}
        aria-hidden="true"
      />

      <input
        ref={hiddenInputRef}
        type="text"
        inputMode="text"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck="false"
        className="aristo-pip-hidden-input"
        value=""
        aria-label={`Type letter for ${cipherLetter} ${activeSlot} slot`}
        onChange={handleHiddenInputChange}
        onKeyDown={handleHiddenKeyDown}
      />

      <div className="aristo-pip-header">
        <span className="aristo-pip-title">
          Cipher <strong>{cipherLetter}</strong>
        </span>
        <span className="aristo-pip-freq">{frequency}×</span>
      </div>

      {warningText && (
        <div className="aristo-pip-warning" role="status">
          ⚠ {warningText}
        </div>
      )}

      <div className="aristo-pip-die-grid">
        {renderCornerButton(0)}
        {renderCornerButton(1)}

        <button
          type="button"
          className={`aristo-pip-slot aristo-pip-center${
            activeSlot === 'center' ? ' is-active' : ''
          }${isSelfMapped || duplicateWithCiphers.length > 0 ? ' is-conflict' : ''}`}
          aria-label={`Main replacement guess for ciphertext ${cipherLetter}`}
          aria-pressed={activeSlot === 'center'}
          onPointerDown={(e) => selectSlot('center', e)}
          onClick={(e) => selectSlot('center', e)}
        >
          {centerGuess || ''}
        </button>

        {renderCornerButton(2)}
        {renderCornerButton(3)}
      </div>

      <div className="aristo-pip-footer">
        <button
          type="button"
          className="btn-simple aristo-pip-clear-btn"
          disabled={!hasAnyCorner}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            onEdit({ kind: 'clearCornersForLetter', cipherLetter });
            focusHiddenInput();
          }}
        >
          Clear Corners
        </button>
        <button
          type="button"
          className="btn-simple aristo-pip-close-btn"
          aria-label="Close replacement popup"
          title="Close (Enter / Esc)"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );

  return createPortal(popupNode, document.body);
};
