import { useEffect } from 'react';

const PRIMARY_SCROLL_CONTAINER_SELECTOR = [
  '.menu-container',
  '.practice-tests-scroll-list',
  '.test-editor-scroll-body',
  '.quote-browser-virtual-scroller',
  '.test-results-view',
  '.cipher-scroll-panel',
  '.test-review-table-container',
  '.offset-card-wrapper',
].join(', ');

const LINE_DELTA_PX = 36;

function isVerticallyScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight + 1) return false;
  const { overflowY } = window.getComputedStyle(el);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

function hasScrollableAncestor(start: Element | null): boolean {
  let node: Element | null = start;
  while (node && node !== document.body && node !== document.documentElement) {
    if (node instanceof HTMLElement && isVerticallyScrollable(node)) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function toPixelDeltaY(e: WheelEvent, scroller: HTMLElement): number {
  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return e.deltaY * LINE_DELTA_PX;
  }
  if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return e.deltaY * scroller.clientHeight * 0.85;
  }
  return e.deltaY;
}

/**
 * Forwards vertical wheel and trackpad scroll gestures from the outer page
 * margins (or pinned non-scrolling headers) to the active screen's primary
 * scroll container, while leaving native scrolling inside scrollable elements,
 * modals, popovers, and browser zoom untouched.
 */
export function useOuterMarginScroll(): void {
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      // Do not scroll the background page while a modal dialog is open
      if (document.querySelector('.modal-backdrop')) return;

      const targetEl =
        e.target instanceof Element
          ? e.target
          : e.target instanceof Node
            ? e.target.parentElement
            : null;

      if (targetEl?.closest('.drill-overflow-popover')) return;

      const scroller = document.querySelector<HTMLElement>(
        PRIMARY_SCROLL_CONTAINER_SELECTOR
      );
      if (!scroller) return;

      // Let the browser handle scrolling natively when already inside the
      // primary scroll container or any other scrollable element.
      if (targetEl && (scroller.contains(targetEl) || hasScrollableAncestor(targetEl))) {
        return;
      }

      if (scroller.scrollHeight <= scroller.clientHeight) return;

      scroller.scrollTop += toPixelDeltaY(e, scroller);
    };

    window.addEventListener('wheel', handleWheel, { passive: true });
    return () => {
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);
}
