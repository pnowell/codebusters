import React from 'react';

export const DrillsTabIcon: React.FC = () => (
  <svg
    className="menu-tab-icon"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <line x1="8" y1="2" x2="12" y2="2" />
    <line x1="10" y1="2" x2="10" y2="4.5" />
    <line x1="14.8" y1="5.2" x2="16.2" y2="3.8" />
    <circle cx="10" cy="11.5" r="6.5" />
    <polyline points="10 8 10 11.5 12.6 13" />
  </svg>
);

export const CiphersTabIcon: React.FC = () => (
  <svg
    className="menu-tab-icon"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="2.5" y="3" width="6.2" height="6.2" rx="1.2" />
    <rect x="11.3" y="3" width="6.2" height="6.2" rx="1.2" />
    <rect x="2.5" y="11.3" width="6.2" height="6.2" rx="1.2" />
    <path d="M12.2 14.4h4.4M14.4 12.2v4.4" />
  </svg>
);
