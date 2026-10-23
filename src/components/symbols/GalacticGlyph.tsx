import React from 'react';

interface GalacticGlyphProps {
  letter: string;
  size?: number;
  className?: string;
  color?: string;
}

export const GalacticGlyph: React.FC<GalacticGlyphProps> = ({
  letter,
  size = 30,
  className = '',
  color = 'currentColor',
}) => {
  const upper = letter.toUpperCase();

  return (
    <span
      className={`galactic-glyph ${className}`}
      style={{
        fontFamily: "'StandardGalacticAlphabetSO', monospace",
        fontSize: `${size}px`,
        color,
        lineHeight: 1,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: `${size}px`,
        height: `${size}px`,
        userSelect: 'none',
      }}
      aria-label={`Galactic glyph for ${upper}`}
    >
      {upper}
    </span>
  );
};
