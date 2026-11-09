import React from 'react';
import { letterToTapPair } from '../../utils/ciphers';

interface TapCodeGlyphProps {
  letter: string;
  size?: number;
  className?: string;
  color?: string;
}

export const TapCodeGlyph: React.FC<TapCodeGlyphProps> = ({
  letter,
  size = 22,
  className = '',
  color = 'currentColor',
}) => {
  const pair = letterToTapPair(letter);
  if (!pair) return null;

  const [row, col] = pair;
  const isStage = size >= 40;

  const dotRadius = isStage ? 7 : 2.25;
  const dotDiameter = dotRadius * 2;
  const intraGap = isStage ? 7 : 2.25;
  const interGap = isStage ? 28 : 8.5;
  const svgHeight = isStage ? 28 : 14;
  const padX = 1;
  const step = dotDiameter + intraGap;

  const group1Width = row * dotDiameter + (row - 1) * intraGap;
  const group2Start = padX + group1Width + interGap;
  const group2Width = col * dotDiameter + (col - 1) * intraGap;
  const svgWidth = group2Start + group2Width + padX;
  const cy = svgHeight / 2;

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className={`tap-code-glyph ${className}`.trim()}
      role="img"
      aria-label={`Tap code ${row} and ${col}`}
      style={{
        display: 'block',
        maxWidth: '100%',
        height: 'auto',
      }}
    >
      {Array.from({ length: row }, (_, i) => (
        <circle
          key={`r-${i}`}
          cx={padX + dotRadius + i * step}
          cy={cy}
          r={dotRadius}
          fill={color}
        />
      ))}
      {Array.from({ length: col }, (_, j) => (
        <circle
          key={`c-${j}`}
          cx={group2Start + dotRadius + j * step}
          cy={cy}
          r={dotRadius}
          fill={color}
        />
      ))}
    </svg>
  );
};
