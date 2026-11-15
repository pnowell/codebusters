import React, { useMemo, useRef, useState } from 'react';
import {
  ALPHABET_LETTERS,
  computeAristocratAnalysis,
  ENGLISH_LETTER_FREQUENCIES,
} from '../../../utils/aristocrat';
import { useDragScroll } from '../../../hooks/useDragScroll';
import type {
  AristocratCornerTuple,
  AristocratEditAction,
} from '../../../types';
import { AristocratCornersOverlay } from './AristocratCornersOverlay';
import { AristocratPipPopup } from './AristocratPipPopup';

const TOP_HALF_LETTERS = ALPHABET_LETTERS.slice(0, 13);
const BOTTOM_HALF_LETTERS = ALPHABET_LETTERS.slice(13, 26);

/**
 * Balanced 5-column grouping of the 26 English letter frequencies ([6, 6, 5, 5, 4]):
 * Col 1: E T A O I N (>7%) | Col 2: S R H L D C (3–7%) | Col 3: U M F P G | Col 4: W Y B V K | Col 5: X J Q Z (<0.2%)
 */
const ENGLISH_FREQ_COLUMNS = [
  ENGLISH_LETTER_FREQUENCIES.slice(0, 6),
  ENGLISH_LETTER_FREQUENCIES.slice(6, 12),
  ENGLISH_LETTER_FREQUENCIES.slice(12, 17),
  ENGLISH_LETTER_FREQUENCIES.slice(17, 22),
  ENGLISH_LETTER_FREQUENCIES.slice(22, 26),
] as const;

export interface AristocratReferenceProps {
  frequencies?: Record<string, number>;
  replacements?: Partial<Record<string, string>>;
  corners?: Partial<Record<string, AristocratCornerTuple>>;
  activeCipherLetter?: string | null;
  disabled?: boolean;
  onEdit?: (action: AristocratEditAction) => void;
  onSelectCipherLetter?: (
    cipherLetter: string | null,
    source?: 'table' | 'grid'
  ) => void;
}

export const AristocratReference: React.FC<AristocratReferenceProps> = ({
  frequencies,
  replacements,
  corners,
  activeCipherLetter,
  disabled = false,
  onEdit,
  onSelectCipherLetter,
}) => {
  const { containerRef, isDragging, dragHandlers } =
    useDragScroll<HTMLDivElement>();
  const [popupLetter, setPopupLetter] = useState<string | null>(null);
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const effectivePopupLetter = !disabled ? popupLetter : null;

  const analysis = useMemo(
    () => computeAristocratAnalysis(replacements),
    [replacements]
  );

  const handleCellClick = (letter: string) => {
    if (disabled || !onEdit) return;
    if (effectivePopupLetter === letter) {
      // Second click on the same slot hides the 5-pip popup while keeping
      // that letter highlighted across the Replacement Table & workspace.
      setPopupLetter(null);
      onSelectCipherLetter?.(letter, 'table');
    } else {
      setPopupLetter(letter);
      onSelectCipherLetter?.(letter, 'table');
    }
  };

  const handleReplacementPanelClick = (e: React.MouseEvent<HTMLElement>) => {
    if (disabled) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('[data-aristo-rep-cell]')) return;
    if (effectivePopupLetter) {
      setPopupLetter(null);
      onSelectCipherLetter?.(effectivePopupLetter, 'table');
    } else {
      onSelectCipherLetter?.(null, 'table');
    }
  };

  const handleClosePopup = () => {
    setPopupLetter(null);
  };

  const renderReplacementRow = (letters: readonly string[]) => (
    <div className="aristo-rep-half-row" role="row">
      {letters.map((cLetter) => {
        const freq = frequencies?.[cLetter] ?? 0;
        const centerVal = replacements?.[cLetter] ?? '';
        const cornerVal = !disabled ? corners?.[cLetter] : undefined;
        const isPopupTarget = effectivePopupLetter === cLetter;
        const isPeerActive = !isPopupTarget && activeCipherLetter === cLetter;
        const isConflict = analysis.conflictingCiphers.has(cLetter);

        const cellClass = [
          'aristo-rep-col',
          freq === 0 ? 'is-zero-freq' : '',
          isPopupTarget ? 'is-popup-open' : '',
          isPeerActive ? 'is-peer-active' : '',
          isConflict ? 'is-conflict' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={cLetter}
            ref={(el) => {
              cellRefs.current[cLetter] = el;
            }}
            type="button"
            data-aristo-rep-cell={cLetter}
            disabled={disabled || !onEdit}
            className={cellClass}
            onClick={() => handleCellClick(cLetter)}
            aria-label={`Ciphertext ${cLetter}, frequency ${freq}${
              centerVal ? `, mapped to ${centerVal}` : ''
            }`}
          >
            <span className="aristo-rep-cipher">{cLetter}</span>
            <span className="aristo-rep-freq">{freq}</span>
            <span className="aristo-rep-box">
              <AristocratCornersOverlay
                corners={cornerVal}
                hasCenterGuess={Boolean(centerVal)}
                cipherLetter={cLetter}
                plainOwners={analysis.plainOwners}
              />
              <span className="aristo-rep-center">{centerVal}</span>
            </span>
          </button>
        );
      })}
    </div>
  );

  const popupCenter = effectivePopupLetter
    ? replacements?.[effectivePopupLetter] ?? ''
    : '';
  const popupDuplicates = useMemo(() => {
    if (!effectivePopupLetter || !popupCenter) return [];
    const owners = analysis.duplicatePlainOwners.get(popupCenter) ?? [];
    return owners.filter((c) => c !== effectivePopupLetter);
  }, [analysis.duplicatePlainOwners, effectivePopupLetter, popupCenter]);

  const getAnchorEl = (letter: string): HTMLElement | null =>
    cellRefs.current[letter] ?? null;

  return (
    <div className="aristo-ref-outer">
      <div
        ref={containerRef}
        className={`aristo-ref-scroll${isDragging ? ' is-dragging' : ''}`}
        {...dragHandlers}
      >
        <div className="aristo-ref-strip">
          <section
            className="aristo-ref-panel aristo-rep-panel"
            aria-label="Aristocrat Replacement Table"
            onClick={handleReplacementPanelClick}
          >
            <div className="aristo-ref-panel-header">
              <span className="aristo-ref-panel-title">Replacement Table</span>
            </div>
            <div className="aristo-rep-grid" role="grid">
              {renderReplacementRow(TOP_HALF_LETTERS)}
              {renderReplacementRow(BOTTOM_HALF_LETTERS)}
            </div>
          </section>

          <section
            className="aristo-ref-panel aristo-eng-panel"
            aria-label="Official English Letter Frequencies"
          >
            <div className="aristo-ref-panel-header">
              <span className="aristo-ref-panel-title">English Freq (%)</span>
            </div>
            <div className="aristo-eng-columns" role="list">
              {ENGLISH_FREQ_COLUMNS.map((colItems, colIdx) => (
                <div key={colIdx} className="aristo-eng-col-list">
                  {colItems.map(({ letter, percent }) => {
                    const isUsed = analysis.usedPlainLetters.has(letter);
                    return (
                      <div
                        key={letter}
                        role="listitem"
                        className={`aristo-eng-item${isUsed ? ' is-used' : ''}`}
                        title={`${letter} — ${percent.toFixed(2)}%${
                          isUsed ? ' (assigned in Replacement Table)' : ''
                        }`}
                      >
                        <span className="aristo-eng-letter">{letter}</span>
                        <span className="aristo-eng-pct">
                          {percent.toFixed(2)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {effectivePopupLetter && onEdit && (
        <AristocratPipPopup
          cipherLetter={effectivePopupLetter}
          frequency={frequencies?.[effectivePopupLetter] ?? 0}
          centerGuess={popupCenter}
          corners={corners?.[effectivePopupLetter]}
          isSelfMapped={analysis.selfMappedCiphers.has(effectivePopupLetter)}
          duplicateWithCiphers={popupDuplicates}
          plainOwners={analysis.plainOwners}
          getAnchorEl={getAnchorEl}
          onEdit={onEdit}
          onClose={handleClosePopup}
        />
      )}
    </div>
  );
};
