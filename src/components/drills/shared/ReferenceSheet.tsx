import React from 'react';
import { TAP_CODE_GRID } from '../../../utils/ciphers';
import type { LookupCipherType } from '../../../types';

const REFERENCE_IMAGES = {
  atbash: {
    src: 'references/atbash_table.png',
    alt: 'Atbash Cipher Table from Official Resource Sheet',
  },
  pigpen: {
    src: 'references/pigpen_table.png',
    alt: 'Pigpen / Masonic Decryption Table from Official Resource Sheet',
  },
  galactic: {
    src: 'references/galactic_table.png',
    alt: 'Standard Galactic Alphabet from Official Resource Sheet',
  },
  knights: {
    src: 'references/knights_templar_table.png',
    alt: 'Knights Templar Decryption Table from Official Resource Sheet',
  },
} as const;

export type ReferenceCipher = LookupCipherType;

interface Props {
  cipher: ReferenceCipher;
}

export const ReferenceSheet: React.FC<Props> = ({ cipher }) => {
  if (cipher === 'tap') {
    return (
      <div className="tap-ref-wrapper">
        <table className="tap-ref-table" aria-label="Tap Code 5 by 5 Reference Grid">
          <thead>
            <tr>
              <th className="tap-ref-corner" aria-hidden="true" />
              {[1, 2, 3, 4, 5].map((colNum) => (
                <th key={colNum} scope="col" className="tap-ref-axis">
                  {colNum}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TAP_CODE_GRID.map((rowCells, rowIdx) => (
              <tr key={rowIdx}>
                <th scope="row" className="tap-ref-axis">
                  {rowIdx + 1}
                </th>
                {rowCells.map((cellLabel, colIdx) => (
                  <td
                    key={cellLabel}
                    className={`tap-ref-cell${colIdx === 0 ? ' tap-ref-first-col' : ''}`}
                  >
                    {cellLabel}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const { src, alt } = REFERENCE_IMAGES[cipher];
  return (
    <div className="ref-content-image-box">
      <div className="ref-image-wrapper">
        <img src={src} alt={alt} className="official-ref-img" />
      </div>
    </div>
  );
};
