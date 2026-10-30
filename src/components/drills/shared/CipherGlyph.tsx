import React from 'react';
import { PigpenGlyph } from '../../symbols/PigpenGlyph';
import { GalacticGlyph } from '../../symbols/GalacticGlyph';
import {
  atbashChar,
  caesarChar,
  letterToOffset,
  isLetter,
} from '../../../utils/ciphers';
import type { CipherType, TestCipherParams } from '../../../types';

interface CipherGlyphProps {
  cipher: CipherType;
  char: string;
  alphaIndex?: number;
  params?: TestCipherParams;
  size?: number;
  color?: string;
}

export const CipherGlyph: React.FC<CipherGlyphProps> = ({
  cipher,
  char,
  alphaIndex = 0,
  params,
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
    case 'caesar': {
      const shift = params?.caesarShift ?? 3;
      return <>{caesarChar(upper, shift)}</>;
    }
    case 'aristocrat': {
      const mapping = params?.alphabetMapping;
      const sub = mapping ? mapping[upper] || upper : upper;
      return <>{sub}</>;
    }
    case 'vigenere': {
      const key = (params?.vigenereKey || 'CIPHER').toUpperCase();
      const keyChar = key[alphaIndex % key.length] || 'A';
      const shift = letterToOffset(keyChar);
      return <>{caesarChar(upper, shift)}</>;
    }
    default:
      return <>{upper}</>;
  }
};
