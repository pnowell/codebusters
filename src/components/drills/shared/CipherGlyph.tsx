import React from 'react';
import { PigpenGlyph } from '../../symbols/PigpenGlyph';
import { GalacticGlyph } from '../../symbols/GalacticGlyph';
import { TapCodeGlyph } from '../../symbols/TapCodeGlyph';
import { atbashChar, isLetter } from '../../../utils/ciphers';
import type { LookupCipherType } from '../../../types';

interface CipherGlyphProps {
  cipher: LookupCipherType;
  char: string;
  size?: number;
  color?: string;
}

export const CipherGlyph: React.FC<CipherGlyphProps> = ({
  cipher,
  char,
  size = 22,
  color,
}) => {
  const upper = char.toUpperCase();
  if (!isLetter(upper)) return <>{char}</>;

  switch (cipher) {
    case 'atbash':
      return <>{atbashChar(upper)}</>;
    case 'pigpen':
      return <PigpenGlyph letter={upper} size={size} color={color} />;
    case 'galactic':
      return <GalacticGlyph letter={upper} size={size} color={color} />;
    case 'tap':
      return <TapCodeGlyph letter={upper} size={size} color={color} />;
  }
};
