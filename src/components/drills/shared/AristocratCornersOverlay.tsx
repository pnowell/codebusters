import React from 'react';
import type { AristocratCornerTuple } from '../../../types';

interface AristocratCornersOverlayProps {
  corners?: AristocratCornerTuple;
  hasCenterGuess: boolean;
  /** Cipher letter owning this cell, so we know whether a plain letter is claimed *elsewhere* */
  cipherLetter: string;
  plainOwners?: ReadonlyMap<string, readonly string[]>;
}

const POS_CLASSES = [
  'aristo-corner-tl',
  'aristo-corner-tr',
  'aristo-corner-bl',
  'aristo-corner-br',
] as const;

export const AristocratCornersOverlay: React.FC<AristocratCornersOverlayProps> = ({
  corners,
  hasCenterGuess,
  cipherLetter,
  plainOwners,
}) => {
  if (!corners || corners.every((c) => !c)) {
    return null;
  }

  return (
    <span
      className={`aristo-corners-layer${hasCenterGuess ? ' under-center' : ''}`}
      aria-hidden="true"
    >
      {corners.map((ch, idx) => {
        if (!ch) return null;
        const owners = plainOwners?.get(ch);
        const isClaimedElsewhere = Boolean(
          owners && owners.some((owner) => owner !== cipherLetter)
        );
        return (
          <span
            key={POS_CLASSES[idx]}
            className={`aristo-corner-pip ${POS_CLASSES[idx]}${
              isClaimedElsewhere ? ' is-claimed' : ''
            }`}
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
};
