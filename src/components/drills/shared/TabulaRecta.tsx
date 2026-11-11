import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { formatSignedOffset, offsetToLetter } from '../../../utils/ciphers';
import { useDragScroll } from '../../../hooks/useDragScroll';
import type { CaesarRangeMode } from '../../../types';

export interface TabulaRectaProps {
  variant?: 'caesar' | 'vigenere';
  caesarRange?: CaesarRangeMode;
}

const COLS = Array.from({ length: 26 }, (_, i) => i);

const CAESAR_PM3_SHIFTS = [-3, -2, -1, 0, 1, 2, 3] as const;
const CAESAR_ANY_SHIFTS = Array.from({ length: 27 }, (_, i) => i - 13);
const VIGENERE_SHIFTS = Array.from({ length: 26 }, (_, i) => i);

export const TabulaRecta: React.FC<TabulaRectaProps> = ({
  variant = 'caesar',
  caesarRange = 'pm3',
}) => {
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const { containerRef, isDragging, dragHandlers } =
    useDragScroll<HTMLDivElement>();
  const zeroRowHeaderRef = useRef<HTMLTableCellElement | null>(null);

  const rowShifts = useMemo<readonly number[]>(() => {
    if (variant === 'vigenere') return VIGENERE_SHIFTS;
    return caesarRange === 'any' ? CAESAR_ANY_SHIFTS : CAESAR_PM3_SHIFTS;
  }, [variant, caesarRange]);

  // In Caesar Any-Offset mode (-13..+13), center the sub-window on the "0" row on mount
  useLayoutEffect(() => {
    if (variant !== 'caesar' || caesarRange !== 'any') return;
    const container = containerRef.current;
    const zeroEl = zeroRowHeaderRef.current;
    if (!container || !zeroEl) return;
    const targetTop =
      zeroEl.offsetTop - (container.clientHeight - zeroEl.offsetHeight) / 2;
    container.scrollTop = Math.max(0, Math.round(targetTop));
  }, [caesarRange, containerRef, variant]);

  const handleRowClick = (shift: number, isReferenceRow: boolean) => {
    if (isReferenceRow) {
      setSelectedRow(null);
      return;
    }
    setSelectedRow((prev) => (prev === shift ? null : shift));
  };

  const handleRowHeaderKeyDown = (
    e: React.KeyboardEvent<HTMLTableCellElement>,
    shift: number,
    isReferenceRow: boolean
  ) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick(shift, isReferenceRow);
    }
  };

  return (
    <div className="tabula-recta-outer">
      <div
        ref={containerRef}
        className={`tabula-recta-viewport${isDragging ? ' is-dragging' : ''}`}
        {...dragHandlers}
      >
        <table
          className="tabula-recta-table"
          aria-label={
            variant === 'vigenere'
              ? 'Vigenère Tabula Recta Reference Table'
              : 'Caesar Shift Tabula Recta Reference Table'
          }
        >
          {variant === 'vigenere' && (
            <thead>
              <tr className="tr-vigenere-head-row">
                <th
                  scope="col"
                  className="tr-cell tr-row-header tr-vigenere-corner"
                  aria-hidden="true"
                />
                {COLS.map((colIdx) => {
                  const colLetter = offsetToLetter(colIdx);
                  return (
                    <th
                      key={colLetter}
                      scope="col"
                      className="tr-cell tr-ref-cell tr-vigenere-col-header"
                    >
                      {colLetter}
                    </th>
                  );
                })}
              </tr>
            </thead>
          )}

          <tbody>
            {rowShifts.map((shift) => {
              const isReferenceRow = variant === 'caesar' && shift === 0;
              const isSelected = !isReferenceRow && selectedRow === shift;
              const rowHeaderLabel =
                variant === 'vigenere'
                  ? offsetToLetter(shift)
                  : formatSignedOffset(shift);

              const rowClassName = [
                'tr-body-row',
                isReferenceRow ? 'tr-zero-row' : 'tr-selectable-row',
                isSelected ? 'is-selected' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <tr
                  key={shift}
                  className={rowClassName}
                  onClick={() => handleRowClick(shift, isReferenceRow)}
                >
                  <th
                    ref={isReferenceRow ? zeroRowHeaderRef : undefined}
                    scope="row"
                    tabIndex={isReferenceRow ? undefined : 0}
                    aria-pressed={isReferenceRow ? undefined : isSelected}
                    onKeyDown={(e) =>
                      handleRowHeaderKeyDown(e, shift, isReferenceRow)
                    }
                    className={[
                      'tr-cell',
                      'tr-row-header',
                      isReferenceRow ? 'tr-ref-cell tr-zero-corner' : '',
                      isSelected ? 'is-selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {rowHeaderLabel}
                  </th>

                  {COLS.map((colIdx) => {
                    const cellLetter = offsetToLetter(
                      (((colIdx + shift) % 26) + 26) % 26
                    );
                    return (
                      <td
                        key={colIdx}
                        className={[
                          'tr-cell',
                          isReferenceRow ? 'tr-ref-cell tr-zero-cell' : '',
                          isSelected ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {cellLetter}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
