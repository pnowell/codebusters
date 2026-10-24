import { useEffect, type RefObject } from 'react';

/**
 * Keep focused element centered horizontally and visible vertically
 * without triggering whole-page jump/glitch or conflicting smooth-scroll animations.
 */
export function useKeepInView(
  panelRef: RefObject<HTMLElement | null>,
  getTarget: () => HTMLElement | null,
  dep: unknown
) {
  useEffect(() => {
    const panel = panelRef.current;
    const el = getTarget();
    if (!panel || !el) return;

    const panelRect = panel.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();

    // Horizontal auto-centering with 15px dead-zone
    const elCenterX = elRect.left + elRect.width / 2;
    const panelCenterX = panelRect.left + panelRect.width / 2;
    const diffX = elCenterX - panelCenterX;
    if (Math.abs(diffX) > 15) {
      panel.scrollLeft += diffX;
    }

    // Vertical visibility: keep in view with 10px margin
    const margin = 10;
    if (elRect.top < panelRect.top + margin) {
      panel.scrollTop -= panelRect.top + margin - elRect.top;
    } else if (elRect.bottom > panelRect.bottom - margin) {
      panel.scrollTop += elRect.bottom - (panelRect.bottom - margin);
    }
  }, [panelRef, getTarget, dep]);
}
