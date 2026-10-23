import React, { useState } from 'react';
import { ALPHABET, atbashChar } from '../../utils/ciphers';

interface ReferenceSheetProps {
  initialCipher?: 'atbash' | 'pigpen' | 'galactic' | 'knights';
  compact?: boolean;
}

export const ReferenceSheet: React.FC<ReferenceSheetProps> = ({
  initialCipher = 'pigpen',
  compact = false,
}) => {
  const [activeTab, setActiveTab] = useState<'atbash' | 'pigpen' | 'galactic' | 'knights'>(initialCipher);

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
        <button
          className={`ref-tab-btn ${activeTab === 'knights' ? 'active' : ''}`}
          onClick={() => setActiveTab('knights')}
        >
          Knights Templar
        </button>
      </div>

      <div className="ref-content-image-box">
        {activeTab === 'atbash' && (
          <div className="ref-image-wrapper">
            {/* Direct Official PDF Resource Sheet Table */}
            <img
              src="references/atbash_table.png"
              alt="Atbash Cipher Table from Official Resource Sheet"
              className="official-ref-img"
            />
            {/* Crisp High-Contrast HTML Alignment Grid */}
            <div className="atbash-aligned-grid">
              <div className="grid-row-header">
                <span className="row-tag">Plain:</span>
                <div className="grid-cells-row">
                  {ALPHABET.split('').map(c => (
                    <span key={c} className="cell cell-plain">{c}</span>
                  ))}
                </div>
              </div>
              <div className="grid-row-header">
                <span className="row-tag">Cipher:</span>
                <div className="grid-cells-row">
                  {ALPHABET.split('').map(c => (
                    <span key={c} className="cell cell-cipher">{atbashChar(c)}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'pigpen' && (
          <div className="ref-image-wrapper">
            <img
              src="references/pigpen_table.png"
              alt="Pigpen / Masonic Decryption Table from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}

        {activeTab === 'galactic' && (
          <div className="ref-image-wrapper">
            <img
              src="references/galactic_table.png"
              alt="Standard Galactic Alphabet from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}

        {activeTab === 'knights' && (
          <div className="ref-image-wrapper">
            <img
              src="references/knights_templar_table.png"
              alt="Knights Templar Decryption Table from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}
      </div>
    </div>
  );
};
