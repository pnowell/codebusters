import React from 'react';

interface Props {
  info: React.ReactNode;
  children: React.ReactNode;
}

export const DrillActionRow: React.FC<Props> = ({ info, children }) => (
  <div className="drill-action-row">
    <div className="progress-info">{info}</div>
    {children}
  </div>
);
