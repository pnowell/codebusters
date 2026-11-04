import { useEffect, useState } from 'react';

const MIN_LARGE_STAGE_WIDTH = 560;
const MIN_LARGE_STAGE_HEIGHT = 580;

function checkIsLargeStage(): boolean {
  if (typeof window === 'undefined') return false;
  const width = window.visualViewport?.width ?? window.innerWidth;
  const height = window.visualViewport?.height ?? window.innerHeight;
  return width >= MIN_LARGE_STAGE_WIDTH && height >= MIN_LARGE_STAGE_HEIGHT;
}

/**
 * Returns true when the visible viewport (accounting for mobile virtual keyboards
 * via `visualViewport`) has enough horizontal and vertical room to surface
 * secondary drill action buttons directly below the flashcard workspace.
 */
export function useIsLargeDrillStage(): boolean {
  const [isLarge, setIsLarge] = useState<boolean>(checkIsLargeStage);

  useEffect(() => {
    const update = () => {
      setIsLarge(checkIsLargeStage());
    };

    update();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', update);
    window.addEventListener('resize', update);

    return () => {
      vv?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return isLarge;
}
