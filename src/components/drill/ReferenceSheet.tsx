import React from 'react';

const REFERENCE_IMAGES = {
  atbash: {
    src: 'references/atbash_table.png',
    alt: 'Atbash Cipher Table from Official Resource Sheet',
  },
  pigpen: {
    src: 'references/pigpen_table.png',
    alt: 'Pigpen / Masonic Decryption Table from Official Resource Sheet',
  },
  galactic: {
    src: 'references/galactic_table.png',
    alt: 'Standard Galactic Alphabet from Official Resource Sheet',
  },
  knights: {
    src: 'references/knights_templar_table.png',
    alt: 'Knights Templar Decryption Table from Official Resource Sheet',
  },
} as const;

export type ReferenceCipher = keyof typeof REFERENCE_IMAGES;

interface Props {
  cipher: ReferenceCipher;
}

export const ReferenceSheet: React.FC<Props> = ({ cipher }) => {
  const { src, alt } = REFERENCE_IMAGES[cipher];
  return (
    <div className="ref-content-image-box">
      <div className="ref-image-wrapper">
        <img src={src} alt={alt} className="official-ref-img" />
      </div>
    </div>
  );
};
