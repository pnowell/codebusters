import React from 'react';

interface GalacticGlyphProps {
  letter: string;
  size?: number;
  className?: string;
  color?: string;
}

export const GalacticGlyph: React.FC<GalacticGlyphProps> = ({
  letter,
  size = 36,
  className = '',
  color = 'currentColor',
}) => {
  const upper = letter.toUpperCase();
  const stroke = color;
  const strokeWidth = 3;
  const dotR = 2.5;

  const renderGlyph = () => {
    switch (upper) {
      case 'A': // L shape with top cross and dots
        return (
          <>
            <line x1="10" y1="8" x2="10" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="10" y1="32" x2="28" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="28" cy="14" r={dotR} fill={stroke} />
            <circle cx="28" cy="22" r={dotR} fill={stroke} />
          </>
        );
      case 'B': // Two vertical dots + horizontal bar
        return (
          <>
            <line x1="8" y1="12" x2="32" y2="12" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="12" x2="20" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="10" cy="24" r={dotR} fill={stroke} />
          </>
        );
      case 'C': // Right angle top-right + dot
        return (
          <>
            <path d="M 10 10 H 30 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="18" cy="22" r={dotR} fill={stroke} />
          </>
        );
      case 'D': // Square with dot
        return (
          <>
            <rect x="12" y="12" width="16" height="16" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
            <circle cx="20" cy="20" r={dotR} fill={stroke} />
          </>
        );
      case 'E': // Vertical bar with 3 dots on right
        return (
          <>
            <line x1="12" y1="8" x2="12" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="24" cy="12" r={dotR} fill={stroke} />
            <circle cx="24" cy="20" r={dotR} fill={stroke} />
            <circle cx="24" cy="28" r={dotR} fill={stroke} />
          </>
        );
      case 'F': // Cross with top-left dot
        return (
          <>
            <line x1="8" y1="20" x2="32" y2="20" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="8" x2="20" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="12" cy="12" r={dotR} fill={stroke} />
          </>
        );
      case 'G': // Horizontal bar with vertical tick and dots
        return (
          <>
            <line x1="10" y1="14" x2="30" y2="14" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="14" x2="20" y2="28" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="12" cy="24" r={dotR} fill={stroke} />
            <circle cx="28" cy="24" r={dotR} fill={stroke} />
          </>
        );
      case 'H': // Two vertical bars connected
        return (
          <>
            <line x1="12" y1="10" x2="12" y2="30" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="28" y1="10" x2="28" y2="30" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="20" cy="20" r={dotR} fill={stroke} />
          </>
        );
      case 'I': // Single vertical line with top dot
        return (
          <>
            <line x1="20" y1="14" x2="20" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="20" cy="8" r={dotR} fill={stroke} />
          </>
        );
      case 'J': // Angle shape pointing down-left
        return (
          <>
            <path d="M 28 8 V 28 H 12" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="16" cy="16" r={dotR} fill={stroke} />
          </>
        );
      case 'K': // Diagonal line and vertical line
        return (
          <>
            <line x1="12" y1="8" x2="12" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="12" y1="20" x2="28" y2="10" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="24" cy="26" r={dotR} fill={stroke} />
          </>
        );
      case 'L': // Classic right angle L
        return (
          <>
            <path d="M 12 8 V 30 H 28" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
      case 'M': // T-like shape with dots
        return (
          <>
            <line x1="8" y1="10" x2="32" y2="10" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="10" x2="20" y2="28" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="20" cy="33" r={dotR} fill={stroke} />
          </>
        );
      case 'N': // Two parallel horizontal bars with dots
        return (
          <>
            <line x1="10" y1="12" x2="30" y2="12" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="10" y1="26" x2="30" y2="26" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="20" cy="19" r={dotR} fill={stroke} />
          </>
        );
      case 'O': // Circle / square
        return (
          <circle cx="20" cy="20" r="9" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
        );
      case 'P': // Upper loop on vertical bar
        return (
          <>
            <line x1="12" y1="8" x2="12" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <rect x="12" y="8" width="14" height="12" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
          </>
        );
      case 'Q': // Square with diagonal leg
        return (
          <>
            <rect x="10" y="10" width="16" height="16" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
            <line x1="22" y1="22" x2="32" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
      case 'R': // Triangle with dots
        return (
          <>
            <polygon points="20,10 10,28 30,28" fill="none" stroke={stroke} strokeWidth={strokeWidth} />
            <circle cx="20" cy="22" r={dotR} fill={stroke} />
          </>
        );
      case 'S': // Z-like or zig-zag step
        return (
          <path d="M 28 10 H 12 V 20 H 28 V 30 H 12" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        );
      case 'T': // T shape
        return (
          <>
            <line x1="8" y1="10" x2="32" y2="10" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="10" x2="20" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
      case 'U': // U cup shape
        return (
          <path d="M 12 10 V 26 C 12 30, 28 30, 28 26 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
        );
      case 'V': // V wedge shape
        return (
          <path d="M 10 10 L 20 30 L 30 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        );
      case 'W': // W shape
        return (
          <path d="M 8 10 L 14 30 L 20 16 L 26 30 L 32 10" fill="none" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        );
      case 'X': // Diagonal X with center circle
        return (
          <>
            <line x1="10" y1="10" x2="30" y2="30" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="30" y1="10" x2="10" y2="30" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <circle cx="20" cy="20" r="3" fill={stroke} />
          </>
        );
      case 'Y': // Y shape
        return (
          <>
            <line x1="10" y1="10" x2="20" y2="20" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="30" y1="10" x2="20" y2="20" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
            <line x1="20" y1="20" x2="20" y2="32" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" />
          </>
        );
      case 'Z': // Horizontal bars with diagonal
        return (
          <path d="M 10 10 H 30 L 10 30 H 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
        );
      default:
        return <text x="20" y="26" textAnchor="middle" fontSize="18" fill={stroke}>{upper}</text>;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={className}
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      {renderGlyph()}
    </svg>
  );
};
