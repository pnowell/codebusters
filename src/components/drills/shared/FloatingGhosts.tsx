import React from 'react';
import type { FloatingGhostItem } from '../../../hooks/useFloatingGhosts';

interface FloatingGhostsProps {
  ghosts: FloatingGhostItem[];
  onRemove: (id: string) => void;
}

export const FloatingGhosts: React.FC<FloatingGhostsProps> = ({ ghosts, onRemove }) => (
  <div className="ghost-container">
    {ghosts.map((g) => (
      <div
        key={g.id}
        className="floating-ghost"
        onAnimationEnd={() => onRemove(g.id)}
      >
        {g.text}
      </div>
    ))}
  </div>
);
