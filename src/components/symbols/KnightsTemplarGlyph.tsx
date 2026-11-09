import React from 'react';

interface KnightsTemplarGlyphProps {
  letter: string;
  size?: number;
  className?: string;
  color?: string;
}

type WedgeShape = 'angle' | 'triangle' | 'kite';
type WedgeDirection = 0 | 90 | 180 | 270; // 0 = Top, 90 = Right, 180 = Bottom, 270 = Left

interface KnightsSpec {
  shape: WedgeShape | 'cross';
  angle?: WedgeDirection;
  dotted?: boolean;
}

// Verified against the official 2026-2027 SoCal DaVinci Decoders Resource Sheet:
// - Cross 1 (angles, no dot):   Top=A, Right=B, Bottom=C, Left=D
// - Cross 2 (triangles, no dot): Left=E, Right=F, Bottom=G, Top=H
// - Cross 3 (kites, no dot):    Top=I/J, Right=K, Bottom=L, Left=M
// - Center '×':                 N
// - Cross 4 (angles, dotted):   Top=O, Right=P, Bottom=Q, Left=R
// - Cross 5 (triangles, dotted): Top=S, Right=T, Bottom=U, Left=V
// - Cross 6 (kites, dotted):    Bottom=W, Top=X, Right=Y, Left=Z
const KNIGHTS_MAP: Record<string, KnightsSpec> = {
  A: { shape: 'angle', angle: 0, dotted: false },
  B: { shape: 'angle', angle: 90, dotted: false },
  C: { shape: 'angle', angle: 180, dotted: false },
  D: { shape: 'angle', angle: 270, dotted: false },

  E: { shape: 'triangle', angle: 270, dotted: false },
  F: { shape: 'triangle', angle: 90, dotted: false },
  G: { shape: 'triangle', angle: 180, dotted: false },
  H: { shape: 'triangle', angle: 0, dotted: false },

  I: { shape: 'kite', angle: 0, dotted: false },
  J: { shape: 'kite', angle: 0, dotted: false },
  K: { shape: 'kite', angle: 90, dotted: false },
  L: { shape: 'kite', angle: 180, dotted: false },
  M: { shape: 'kite', angle: 270, dotted: false },

  N: { shape: 'cross' },

  O: { shape: 'angle', angle: 0, dotted: true },
  P: { shape: 'angle', angle: 90, dotted: true },
  Q: { shape: 'angle', angle: 180, dotted: true },
  R: { shape: 'angle', angle: 270, dotted: true },

  S: { shape: 'triangle', angle: 0, dotted: true },
  T: { shape: 'triangle', angle: 90, dotted: true },
  U: { shape: 'triangle', angle: 180, dotted: true },
  V: { shape: 'triangle', angle: 270, dotted: true },

  W: { shape: 'kite', angle: 180, dotted: true },
  X: { shape: 'kite', angle: 0, dotted: true },
  Y: { shape: 'kite', angle: 90, dotted: true },
  Z: { shape: 'kite', angle: 270, dotted: true },
};

export const KnightsTemplarGlyph: React.FC<KnightsTemplarGlyphProps> = ({
  letter,
  size = 36,
  className = '',
  color = 'currentColor',
}) => {
  const upper = letter.toUpperCase();
  const spec = KNIGHTS_MAP[upper];
  if (!spec) return null;

  const strokeWidth = 3.2;
  const dotRadius = 2.8;

  const renderContent = () => {
    if (spec.shape === 'cross') {
      return (
        <path
          d="M 9 9 L 31 31 M 31 9 L 9 31"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      );
    }

    let pathD: string;
    let dotCy: number;

    switch (spec.shape) {
      case 'angle':
        pathD = 'M 10.5 7 L 20 33 L 29.5 7';
        dotCy = 14.5;
        break;
      case 'triangle':
        pathD = 'M 10 7 L 30 7 L 20 33 Z';
        dotCy = 15;
        break;
      case 'kite':
        pathD = 'M 20 5.5 L 29.5 13.5 L 20 34 L 10.5 13.5 Z';
        dotCy = 16;
        break;
    }

    const angle = spec.angle ?? 0;

    return (
      <g transform={angle !== 0 ? `rotate(${angle} 20 20)` : undefined}>
        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {spec.dotted && <circle cx="20" cy={dotCy} r={dotRadius} fill={color} />}
      </g>
    );
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`knights-glyph ${className}`.trim()}
      role="img"
      aria-label="Knights Templar symbol"
      style={{
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
      }}
    >
      {renderContent()}
    </svg>
  );
};
