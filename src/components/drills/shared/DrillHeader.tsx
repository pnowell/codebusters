import React from 'react';

interface Props {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}

export const DrillHeader: React.FC<Props> = ({ title, onBack, right }) => (
  <div className="drill-header-compact">
    <button className="btn-simple btn-back" onClick={onBack}>
      ← Menu
    </button>
    <h2 className="drill-title-compact">{title}</h2>
    {right}
  </div>
);
