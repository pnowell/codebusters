import type React from 'react';
import { useEffect, useRef, useState } from 'react';

export type DualPaneTab = 'drills' | 'ciphers';

export const DUAL_PANE_MEDIA_QUERY = '(min-width: 820px)';

interface SwipeState {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  viewportWidth: number;
  axis: 'x' | 'y' | null;
  lastDx: number;
}

interface UseDualPaneTabsOptions {
  activeTab: DualPaneTab;
  onSelectTab: (tab: DualPaneTab) => void;
  drillsTabId: string;
  ciphersTabId: string;
}

/**
 * Shared responsive two-pane controller: displays both panes side-by-side at >= 820px
 * and provides horizontal touch/mouse swipe + arrow-key tab switching on narrower screens.
 */
export function useDualPaneTabs({
  activeTab,
  onSelectTab,
  drillsTabId,
  ciphersTabId,
}: UseDualPaneTabsOptions) {
  const [isSideBySide, setIsSideBySide] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DUAL_PANE_MEDIA_QUERY).matches
      : false
  );
  const [dragOffsetPx, setDragOffsetPx] = useState<number>(0);
  const [dragViewportWidth, setDragViewportWidth] = useState<number>(360);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<SwipeState | null>(null);
  const suppressClickUntilRef = useRef<number>(0);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia(DUAL_PANE_MEDIA_QUERY);
    const handleChange = (e: MediaQueryListEvent) => {
      setIsSideBySide(e.matches);
      setDragOffsetPx(0);
      setIsDragging(false);
      swipeRef.current = null;
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSideBySide) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const target = e.target as HTMLElement | null;
    if (target?.closest('select, input, textarea, option')) {
      return;
    }

    const width = viewportRef.current?.clientWidth || 360;
    setDragViewportWidth(width);
    swipeRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: Date.now(),
      viewportWidth: width,
      axis: null,
      lastDx: 0,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const state = swipeRef.current;
    if (!state || state.pointerId !== e.pointerId || isSideBySide) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (state.axis === null) {
      if (Math.hypot(dx, dy) < 10) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.15) {
        state.axis = 'x';
        setIsDragging(true);
        window.getSelection()?.removeAllRanges();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore pointer capture errors
        }
      } else {
        state.axis = 'y';
        swipeRef.current = null;
        return;
      }
    }

    if (state.axis === 'x') {
      state.lastDx = dx;
      // Apply rubber-band resistance when dragging past outer bounds
      const isPullingPastStart = activeTab === 'drills' && dx > 0;
      const isPullingPastEnd = activeTab === 'ciphers' && dx < 0;
      const dampedDx =
        isPullingPastStart || isPullingPastEnd ? dx * 0.25 : dx;
      const clampedDx = Math.max(
        -state.viewportWidth,
        Math.min(state.viewportWidth, dampedDx)
      );
      setDragOffsetPx(clampedDx);
    }
  };

  const finishSwipe = (
    e: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean
  ) => {
    const state = swipeRef.current;
    if (!state || state.pointerId !== e.pointerId) return;
    swipeRef.current = null;

    if (state.axis === 'x') {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore pointer capture release errors
      }

      if (!cancelled) {
        const dx = state.lastDx;
        const dt = Math.max(1, Date.now() - state.startTime);
        const vx = dx / dt;
        const threshold = state.viewportWidth * 0.2;

        if (
          activeTab === 'drills' &&
          (dx < -threshold || (dx < -28 && vx < -0.35))
        ) {
          onSelectTab('ciphers');
        } else if (
          activeTab === 'ciphers' &&
          (dx > threshold || (dx > 28 && vx > 0.35))
        ) {
          onSelectTab('drills');
        }

        if (Math.abs(dx) > 10) {
          suppressClickUntilRef.current = Date.now() + 90;
        }
      }
    }

    setIsDragging(false);
    setDragOffsetPx(0);
  };

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntilRef.current = 0;
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextTab: DualPaneTab =
        activeTab === 'drills' ? 'ciphers' : 'drills';
      onSelectTab(nextTab);
      const targetId = nextTab === 'drills' ? drillsTabId : ciphersTabId;
      document.getElementById(targetId)?.focus();
    }
  };

  const baseTabProgress = activeTab === 'ciphers' ? 1 : 0;
  const indicatorProgress = Math.max(
    0,
    Math.min(
      1,
      dragViewportWidth > 0
        ? baseTabProgress - dragOffsetPx / dragViewportWidth
        : baseTabProgress
    )
  );
  const visualActiveTab: DualPaneTab = isDragging
    ? indicatorProgress >= 0.5
      ? 'ciphers'
      : 'drills'
    : activeTab;

  const trackTransform = isSideBySide
    ? undefined
    : `translate3d(calc(${activeTab === 'ciphers' ? '-50%' : '0%'} + ${dragOffsetPx}px), 0, 0)`;

  return {
    viewportRef,
    isSideBySide,
    isDragging,
    indicatorProgress,
    visualActiveTab,
    trackTransform,
    handlePointerDown,
    handlePointerMove,
    finishSwipe,
    handleClickCapture,
    handleTabKeyDown,
  };
}
