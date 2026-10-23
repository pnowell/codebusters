import React, { useEffect } from 'react';

interface VirtualKeyboardProps {
  onChar: (char: string) => void;
  onBackspace: () => void;
  onClear?: () => void;
  disabledLetters?: string[];
  activeLetter?: string;
  hideKeyboard?: boolean;
}

export const VirtualKeyboard: React.FC<VirtualKeyboardProps> = ({
  onChar,
  onBackspace,
  onClear,
  disabledLetters = [],
  activeLetter,
  hideKeyboard = false,
}) => {
  // Listen for physical keyboard input on desktop as well!
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input or textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Backspace') {
        e.preventDefault();
        onBackspace();
      } else if (e.key.length === 1 && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        onChar(e.key.toUpperCase());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onChar, onBackspace]);

  if (hideKeyboard) return null;

  const rows = [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'],
    ['Z', 'X', 'C', 'V', 'B', 'N', 'M'],
  ];

  return (
    <div className="virtual-keyboard">
      {rows.map((row, rIdx) => (
        <div key={rIdx} className="keyboard-row">
          {rIdx === 2 && onClear && (
            <button
              type="button"
              className="key-btn special-btn"
              onClick={onClear}
              title="Clear current box"
            >
              Clear
            </button>
          )}

          {row.map(char => {
            const isDisabled = disabledLetters.includes(char);
            const isActive = activeLetter === char;
            return (
              <button
                key={char}
                type="button"
                className={`key-btn ${isActive ? 'active-key' : ''} ${isDisabled ? 'disabled-key' : ''}`}
                onClick={() => onChar(char)}
                disabled={isDisabled}
              >
                {char}
              </button>
            );
          })}

          {rIdx === 2 && (
            <button
              type="button"
              className="key-btn special-btn backspace-btn"
              onClick={onBackspace}
              title="Backspace"
            >
              ⌫
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
