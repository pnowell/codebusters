import { useEffect } from 'react';

/**
 * Tracks the actual visible viewport height above the mobile virtual keyboard.
 * When the keyboard appears, it sets `--visual-viewport-height` and pins outer window at (0, 0)
 * so the fixed header/reference elements don't get shifted off-screen.
 */
export function useVisualViewportHeight() {
  useEffect(() => {
    const updateViewportHeight = () => {
      if (window.visualViewport) {
        document.documentElement.style.setProperty(
          '--visual-viewport-height',
          `${window.visualViewport.height}px`
        );
        // Ensure the outer window is pinned at (0, 0)
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      }
    };

    updateViewportHeight();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', updateViewportHeight);
    vv?.addEventListener('scroll', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);

    return () => {
      vv?.removeEventListener('resize', updateViewportHeight);
      vv?.removeEventListener('scroll', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
    };
  }, []);
}
