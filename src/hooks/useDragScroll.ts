import React, { useCallback, useRef, useState } from 'react';

const DRAG_THRESHOLD_PX = 5;

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  startScrollLeft: number;
  startScrollTop: number;
  captured: boolean;
}

/**
 * Enables 2D click-and-drag scrolling on desktop mouse pointers while preserving
 * native 2D inertial touch scrolling on mobile/tablet devices.
 * Suppresses synthetic `click` events whenever pointer movement exceeds 5px so
 * dragging never accidentally toggles row/cell selection inside interactive tables.
 */
export function useDragScroll<T extends HTMLElement>() {
  const containerRef = useRef<T | null>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const suppressNextClickRef = useRef<boolean>(false);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;

    suppressNextClickRef.current = false;
    sessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startScrollLeft: el.scrollLeft,
      startScrollTop: el.scrollTop,
      captured: false,
    };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const session = sessionRef.current;
    const el = containerRef.current;
    if (!session || !el || e.pointerId !== session.pointerId) return;

    const dx = e.clientX - session.startX;
    const dy = e.clientY - session.startY;

    if (!session.captured) {
      if (Math.hypot(dx, dy) <= DRAG_THRESHOLD_PX) return;
      session.captured = true;
      suppressNextClickRef.current = true;
      setIsDragging(true);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unavailable
      }
    }

    e.preventDefault();
    el.scrollLeft = session.startScrollLeft - dx;
    el.scrollTop = session.startScrollTop - dy;
  }, []);

  const finishDrag = useCallback((e: React.PointerEvent<T>) => {
    const session = sessionRef.current;
    const el = containerRef.current;
    if (!session || e.pointerId !== session.pointerId) return;

    if (session.captured && el) {
      try {
        if (el.hasPointerCapture(e.pointerId)) {
          el.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }
      setIsDragging(false);
      // Browser synthetic click (if any) dispatches immediately after pointerup;
      // auto-clear shortly afterward in case no synthetic click was emitted.
      setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 50);
    }
    sessionRef.current = null;
  }, []);

  const onClickCapture = useCallback((e: React.MouseEvent<T>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  return {
    containerRef,
    isDragging,
    dragHandlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishDrag,
      onPointerCancel: finishDrag,
      onClickCapture,
    },
  };
}
