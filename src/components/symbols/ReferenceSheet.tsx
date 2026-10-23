import React, { useState } from 'react';

export type CipherRefType = 'atbash' | 'pigpen' | 'galactic' | 'knights';

interface ReferenceSheetProps {
  initialCipher?: CipherRefType;
  singleCipher?: CipherRefType;
  compact?: boolean;
  onClose?: () => void;
}

export const ReferenceSheet: React.FC<ReferenceSheetProps> = ({
  initialCipher = 'pigpen',
  singleCipher,
  compact = false,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<CipherRefType>(singleCipher || initialCipher);

  const currentCipher = singleCipher || activeTab;

  return (
    <div className={`reference-sheet ${compact ? 'compact' : ''}`}>
      {onClose && (
        <button
          type="button"
          className="ref-close-btn"
          onClick={onClose}
          title="Hide reference"
          aria-label="Hide reference"
        >
          ✕
        </button>
      )}

      {/* Only show category tabs if no single specific cipher is mandated */}
      {!singleCipher && (
        <div className="ref-tabs">
          <button
            className={`ref-tab-btn ${currentCipher === 'atbash' ? 'active' : ''}`}
            onClick={() => setActiveTab('atbash')}
          >
            Atbash
          </button>
          <button
            className={`ref-tab-btn ${currentCipher === 'pigpen' ? 'active' : ''}`}
            onClick={() => setActiveTab('pigpen')}
          >
            Pigpen
          </button>
          <button
            className={`ref-tab-btn ${currentCipher === 'galactic' ? 'active' : ''}`}
            onClick={() => setActiveTab('galactic')}
          >
            Galactic
          </button>
          <button
            className={`ref-tab-btn ${currentCipher === 'knights' ? 'active' : ''}`}
            onClick={() => setActiveTab('knights')}
          >
            Knights Templar
          </button>
        </div>
      )}

      <div className="ref-content-image-box">
        {currentCipher === 'atbash' && (
          <div className="ref-image-wrapper">
            <img
              src="references/atbash_table.png"
              alt="Atbash Cipher Table from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}

        {currentCipher === 'pigpen' && (
          <div className="ref-image-wrapper">
            <img
              src="references/pigpen_table.png"
              alt="Pigpen / Masonic Decryption Table from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}

        {currentCipher === 'galactic' && (
          <div className="ref-image-wrapper">
            <img
              src="references/galactic_table.png"
              alt="Standard Galactic Alphabet from Official Resource Sheet"
              className="official-ref-img"
            />
          </div>
        )}

        {currentCipher === 'knights' && (
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
