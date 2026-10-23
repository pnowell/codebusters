import React from 'react';

interface PigpenGlyphProps {
  letter: string;
  size?: number;
  className?: string;
  color?: string;
}

export const PigpenGlyph: React.FC<PigpenGlyphProps> = ({
  letter,
  size = 36,
  className = '',
  color = 'currentColor',
}) => {
  const upper = letter.toUpperCase();

  // Draw lines with a stroke-width of 4 inside a 40x40 viewBox
  // Margin of 6 around edges
  const stroke = color;
  const strokeWidth = 3.5;
  const dotRadius = 3;

  // Helpers
  const dot = <circle cx="20" cy="20" r={dotRadius} fill={stroke} />;

  const renderShape = () => {
    switch (upper) {
      // Grid 1 (no dot)
      case 'A': // Bottom + Right
        return <path d="M 10 34 H 34 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'B': // Left + Bottom + Right
        return <path d="M 6 10 V 34 H 34 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'C': // Bottom + Left
        return <path d="M 30 34 H 6 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'D': // Top + Bottom + Right
        return <path d="M 10 6 H 34 V 34 H 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'E': // Full box
        return <rect x="8" y="8" width="24" height="24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'F': // Top + Bottom + Left
        return <path d="M 30 6 H 6 V 34 H 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'G': // Top + Right
        return <path d="M 10 6 H 34 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'H': // Left + Top + Right
        return <path d="M 6 30 V 6 H 34 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'I': // Top + Left
        return <path d="M 30 6 H 6 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;

      // Grid 2 (with dot)
      case 'J':
        return <>{renderShapeGrid('A')}{dot}</>;
      case 'K':
        return <>{renderShapeGrid('B')}{dot}</>;
      case 'L':
        return <>{renderShapeGrid('C')}{dot}</>;
      case 'M':
        return <>{renderShapeGrid('D')}{dot}</>;
      case 'N':
        return <>{renderShapeGrid('E')}{dot}</>;
      case 'O':
        return <>{renderShapeGrid('F')}{dot}</>;
      case 'P':
        return <>{renderShapeGrid('G')}{dot}</>;
      case 'Q':
        return <>{renderShapeGrid('H')}{dot}</>;
      case 'R':
        return <>{renderShapeGrid('I')}{dot}</>;

      // X Grid 1 (S..V)
      case 'S': // V-shape (open at top)
        return <path d="M 6 8 L 20 28 L 34 8" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'T': // > shape (pointing right, open at left)
        return <path d="M 8 6 L 28 20 L 8 34" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'U': // < shape (pointing left, open at right)
        return <path d="M 32 6 L 12 20 L 32 34" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'V': // ^ shape (pointing up, open at bottom)
        return <path d="M 6 32 L 20 12 L 34 32" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;

      // X Grid 2 (W..Z) with dot
      case 'W':
        return (
          <>
            <path d="M 6 8 L 20 28 L 34 8" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20" cy="15" r={dotRadius} fill={stroke} />
          </>
        );
      case 'X':
        return (
          <>
            <path d="M 8 6 L 28 20 L 8 34" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="20" r={dotRadius} fill={stroke} />
          </>
        );
      case 'Y':
        return (
          <>
            <path d="M 32 6 L 12 20 L 32 34" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="24" cy="20" r={dotRadius} fill={stroke} />
          </>
        );
      case 'Z':
        return (
          <>
            <path d="M 6 32 L 20 12 L 34 32" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="20" cy="25" r={dotRadius} fill={stroke} />
          </>
        );

      default:
        return <text x="20" y="26" textAnchor="middle" fontSize="18" fill={stroke}>{upper}</text>;
    }
  };

  const renderShapeGrid = (mappedLetter: string) => {
    switch (mappedLetter) {
      case 'A': return <path d="M 10 34 H 34 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'B': return <path d="M 6 10 V 34 H 34 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'C': return <path d="M 30 34 H 6 V 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'D': return <path d="M 10 6 H 34 V 34 H 10" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'E': return <rect x="8" y="8" width="24" height="24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'F': return <path d="M 30 6 H 6 V 34 H 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'G': return <path d="M 10 6 H 34 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'H': return <path d="M 6 30 V 6 H 34 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      case 'I': return <path d="M 30 6 H 6 V 30" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />;
      default: return null;
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
      {renderShape()}
    </svg>
  );
};
