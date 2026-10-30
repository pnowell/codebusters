import { useState, useRef, useCallback } from 'react';

export interface FloatingGhostItem {
  id: string;
  text: string;
}

export function useFloatingGhosts() {
  const [ghosts, setGhosts] = useState<FloatingGhostItem[]>([]);
  const seqRef = useRef(0);

  const spawnGhost = useCallback((text: string) => {
    const id = `ghost-${++seqRef.current}`;
    setGhosts((prev) => [...prev, { id, text }]);
  }, []);

  const removeGhost = useCallback((id: string) => {
    setGhosts((prev) => prev.filter((g) => g.id !== id));
  }, []);

  return { ghosts, spawnGhost, removeGhost };
}
