import React, { useState } from 'react';

interface Props {
  showLabel: string;
  className: string;
  children: React.ReactNode;
}

export const CollapsibleReference: React.FC<Props> = ({ showLabel, className, children }) => {
  const [open, setOpen] = useState(true);

  if (!open) {
    return (
      <div className="show-ref-row">
        <button type="button" className="btn-simple show-ref-btn" onClick={() => setOpen(true)}>
          📖 {showLabel}
        </button>
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        className="ref-close-btn"
        onClick={() => setOpen(false)}
        title="Hide reference"
        aria-label="Hide reference"
      >
        ✕
      </button>
      {children}
    </div>
  );
};
