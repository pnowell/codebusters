import React, { useState } from 'react';
import { PigpenGlyph } from './PigpenGlyph';
import { GalacticGlyph } from './GalacticGlyph';
import { ALPHABET, atbashChar } from '../../utils/ciphers';

interface ReferenceSheetProps {
  initialCipher?: 'atbash' | 'pigpen' | 'galactic';
  compact?: boolean;
}

export const ReferenceSheet: React.FC<ReferenceSheetProps> = ({
  initialCipher = 'pigpen',
  compact = false,
}) => {
  const [activeTab, setActiveTab] = useState<'atbash' | 'pigpen' | 'galactic'>(initialCipher);

  return (
    <div className={`reference-sheet ${compact ? 'compact' : ''}`}>
      <div className="ref-tabs">
        <button
          className={`ref-tab-btn ${activeTab === 'atbash' ? 'active' : ''}`}
          onClick={() => setActiveTab('atbash')}
        >
          Atbash
        </button>
        <button
          className={`ref-tab-btn ${activeTab === 'pigpen' ? 'active' : ''}`}
          onClick={() => setActiveTab('pigpen')}
        >
          Pigpen
        </button>
        <button
          className={`ref-tab-btn ${activeTab === 'galactic' ? 'active' : ''}`}
          onClick={() => setActiveTab('galactic')}
        >
          Galactic
        </button>
      </div>

      <div className="ref-content">
        {activeTab === 'atbash' && (
          <div className="atbash-ref-table">
            <div className="ref-row">
              <span className="ref-label">Plain:</span>
              <div className="ref-chars">
                {ALPHABET.split('').map(c => (
                  <span key={c} className="char-cell">{c}</span>
                ))}
              </div>
            </div>
            <div className="ref-row cipher-row">
              <span className="ref-label">Cipher:</span>
              <div className="ref-chars">
                {ALPHABET.split('').map(c => (
                  <span key={c} className="char-cell highlighted">{atbashChar(c)}</span>
                ))}
              </div>
            </div>
            <div className="ref-hint">
              💡 Hint: Letters add up to 25! (A↔Z, B↔Y, C↔X, M↔N)
            </div>
          </div>
        )}

        {activeTab === 'pigpen' && (
          <div className="pigpen-ref-grid">
            <div className="pigpen-grid-group">
              <div className="group-title">Standard Grids (A–I & J–R)</div>
              <div className="symbols-row">
                {ALPHABET.slice(0, 18).split('').map(c => (
                  <div key={c} className="symbol-pair">
                    <PigpenGlyph letter={c} size={28} />
                    <span className="symbol-letter">{c}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pigpen-grid-group">
              <div className="group-title">X-Grids (S–V & W–Z)</div>
              <div className="symbols-row">
                {ALPHABET.slice(18).split('').map(c => (
                  <div key={c} className="symbol-pair">
                    <PigpenGlyph letter={c} size={28} />
                    <span className="symbol-letter">{c}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'galactic' && (
          <div className="galactic-ref-grid">
            <div className="symbols-row wrap-grid">
              {ALPHABET.split('').map(c => (
                <div key={c} className="symbol-pair">
                  <GalacticGlyph letter={c} size={26} />
                  <span className="symbol-letter">{c}</span>
                </div>
              ))}
            </div>
            <div className="ref-hint">
              Minecraft Enchanting Table Alphabet (Standard Galactic Alphabet)
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
