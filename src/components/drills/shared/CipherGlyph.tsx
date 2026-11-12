import React from 'react';
import { PigpenGlyph } from '../../symbols/PigpenGlyph';
import { GalacticGlyph } from '../../symbols/GalacticGlyph';
import { TapCodeGlyph } from '../../symbols/TapCodeGlyph';
import { KnightsTemplarGlyph } from '../../symbols/KnightsTemplarGlyph';
import {
  atbashChar,
  caesarChar,
  isLetter,
  vigenereEncryptChar,
} from '../../../utils/ciphers';
import type { CipherWorkspaceParams, TestableCipherType } from '../../../types';

interface CipherGlyphProps {
  cipher: TestableCipherType;
  char: string;
  size?: number;
  color?: string;
  cipherParams?: CipherWorkspaceParams;
}

export const CipherGlyph: React.FC<CipherGlyphProps> = ({
  cipher,
  char,
  size = 22,
  color,
  cipherParams,
}) => {
  const upper = char.toUpperCase();
  if (!isLetter(upper)) return <>{char}</>;

  switch (cipher) {
    case 'atbash':
      return <>{atbashChar(upper)}</>;
    case 'caesar':
      return <>{caesarChar(upper, cipherParams?.caesarOffset ?? 1)}</>;
    case 'vigenere':
      return <>{vigenereEncryptChar(upper, cipherParams?.vigenereKeyChar ?? 'A')}</>;
    case 'pigpen':
      return <PigpenGlyph letter={upper} size={size} color={color} />;
    case 'galactic':
      return <GalacticGlyph letter={upper} size={size} color={color} />;
    case 'tap':
      return <TapCodeGlyph letter={upper} size={size} color={color} />;
    case 'knights':
      return <KnightsTemplarGlyph letter={upper} size={size} color={color} />;
  }
};
