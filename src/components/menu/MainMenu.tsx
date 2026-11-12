import React, { useEffect, useRef, useState } from 'react';
import {
  DRILLS,
  isCipherEnabledForStudent,
  type CipherType,
} from '../../data/drills';
import type {
  CaesarRangeMode,
  GeneralPracticeCiphers,
  LetterMathMode,
  MainMenuTab,
  OffsetsMode,
} from '../../types';
import type { DrillSection } from '../../utils/routing';
import { UserAuthBadge } from '../auth/UserAuthBadge';

export interface SelectDrillOptions {
  offsetsMode?: OffsetsMode;
  letterMathMode?: LetterMathMode;
  caesarRange?: CaesarRangeMode;
}

interface MainMenuProps {
  studentName: string;
  isAllowed: boolean;
  isTeacher: boolean;
  isBetaTester?: boolean;
  generalPracticeCiphers: GeneralPracticeCiphers;
  activeTab: MainMenuTab;
  onSelectTab: (tab: MainMenuTab) => void;
  onStartWorkout: () => void;
  onOpenTestsList: () => void;
  onOpenLeaderboard: () => void;
  onOpenOptions: () => void;
  onSelectDrill: (
    drill: CipherType,
    section: DrillSection,
    options?: SelectDrillOptions
  ) => void;
}

const SIDE_BY_SIDE_MEDIA_QUERY = '(min-width: 820px)';

interface SwipeState {
  pointerId: number;
  startX: number;
  startY: number;
  startTime: number;
  viewportWidth: number;
  axis: 'x' | 'y' | null;
  lastDx: number;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  studentName,
  isAllowed,
  isTeacher,
  isBetaTester = false,
  generalPracticeCiphers,
  activeTab,
  onSelectTab,
  onStartWorkout,
  onOpenTestsList,
  onOpenLeaderboard,
  onOpenOptions,
  onSelectDrill,
}) => {
  const hasPreviewAccess = isTeacher || isBetaTester;

  const [isSideBySide, setIsSideBySide] = useState<boolean>(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(SIDE_BY_SIDE_MEDIA_QUERY).matches
      : false
  );
  const [dragOffsetPx, setDragOffsetPx] = useState<number>(0);
  const [dragViewportWidth, setDragViewportWidth] = useState<number>(360);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const swipeRef = useRef<SwipeState | null>(null);
  const suppressClickUntilRef = useRef<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(SIDE_BY_SIDE_MEDIA_QUERY);
    const handleChange = (e: MediaQueryListEvent) => {
      setIsSideBySide(e.matches);
      setDragOffsetPx(0);
      setIsDragging(false);
      swipeRef.current = null;
    };
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, []);

  const isNumMathVisible =
    hasPreviewAccess ||
    isCipherEnabledForStudent('caesar', generalPracticeCiphers);
  const isNumMathUnpublished =
    hasPreviewAccess &&
    !isCipherEnabledForStudent('caesar', generalPracticeCiphers);

  const isLetterToLetterMathVisible =
    hasPreviewAccess ||
    isCipherEnabledForStudent('vigenere', generalPracticeCiphers);
  const isLetterToLetterMathUnpublished =
    hasPreviewAccess &&
    !isCipherEnabledForStudent('vigenere', generalPracticeCiphers);

  const isLetterMathVisible = isNumMathVisible || isLetterToLetterMathVisible;
  const areAllVisibleLetterMathRowsUnpublished =
    isLetterMathVisible &&
    (!isNumMathVisible || isNumMathUnpublished) &&
    (!isLetterToLetterMathVisible || isLetterToLetterMathUnpublished);

  const visibleFlashcardDrills = DRILLS.filter(
    (d) =>
      d.id !== 'offsets' &&
      d.id !== 'letterMath' &&
      d.implemented &&
      d.hasFlashcardDrill &&
      (hasPreviewAccess || isCipherEnabledForStudent(d.id, generalPracticeCiphers))
  );

  const visibleQuoteCiphers = DRILLS.filter(
    (d) =>
      d.implemented &&
      d.hasQuoteWorkspace &&
      (hasPreviewAccess || isCipherEnabledForStudent(d.id, generalPracticeCiphers))
  );

  const comingSoonDrillLabels: { key: string; label: string }[] = [];
  if (!isNumMathVisible && !isLetterToLetterMathVisible) {
    comingSoonDrillLabels.push({ key: 'letterMath', label: 'Letter Math' });
  } else if (!isNumMathVisible) {
    comingSoonDrillLabels.push({ key: 'letterMathNum', label: 'ABC ± #' });
  } else if (!isLetterToLetterMathVisible) {
    comingSoonDrillLabels.push({ key: 'letterMathLetter', label: 'ABC ± ABC' });
  }
  for (const d of DRILLS) {
    if (d.id === 'offsets' || d.id === 'letterMath' || !d.hasFlashcardDrill) {
      continue;
    }
    if (
      !d.implemented ||
      (!hasPreviewAccess &&
        !isCipherEnabledForStudent(d.id, generalPracticeCiphers))
    ) {
      comingSoonDrillLabels.push({ key: d.id, label: d.menuLabel });
    }
  }

  const comingSoonCiphers = DRILLS.filter(
    (d) =>
      d.hasQuoteWorkspace &&
      (!d.implemented ||
        (!hasPreviewAccess &&
          !isCipherEnabledForStudent(d.id, generalPracticeCiphers)))
  );

  const renderPreviewStatusBadge = (
    teacherTitle: string = 'Beta preview — enable for all students in Settings'
  ) => {
    if (!hasPreviewAccess) return null;
    return (
      <span
        className="menu-beta-badge"
        title={
          isTeacher
            ? teacherTitle
            : 'Beta preview — hidden from other students'
        }
      >
        βeta
      </span>
    );
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSideBySide) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

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

  const finishSwipe = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
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
      const nextTab: MainMenuTab = activeTab === 'drills' ? 'ciphers' : 'drills';
      onSelectTab(nextTab);
      const targetId =
        nextTab === 'drills' ? 'menu-tab-drills' : 'menu-tab-ciphers';
      document.getElementById(targetId)?.focus();
    }
  };

  const drillsBgUrl = `${import.meta.env.BASE_URL}images/menu-drills-bg.jpg`;
  const ciphersBgUrl = `${import.meta.env.BASE_URL}images/menu-ciphers-bg.jpg`;

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
  const visualActiveTab: MainMenuTab = isDragging
    ? indicatorProgress >= 0.5
      ? 'ciphers'
      : 'drills'
    : activeTab;

  const trackTransform = isSideBySide
    ? undefined
    : `translate3d(calc(${activeTab === 'ciphers' ? '-50%' : '0%'} + ${dragOffsetPx}px), 0, 0)`;

  return (
    <>
      <header className="main-header">
        <div className="brand-lockup">
          <img
            src={`${import.meta.env.BASE_URL}favicon.svg`}
            alt="DaVinci Decoders logo"
            className="brand-logo"
            width={42}
            height={42}
          />
          <div className="brand-text">
            <h1>DaVinci Decoders</h1>
            <div className="subtitle">Science Olympiad Division A Trainer</div>
          </div>
        </div>

        <div className="header-user-actions">
          <UserAuthBadge displayName={studentName} onOpenOptions={onOpenOptions} />
          {isAllowed && (
            <button
              type="button"
              className="btn-simple btn-icon-square"
              onClick={onOpenLeaderboard}
              title="Leaderboards"
              aria-label="Leaderboards"
            >
              <span className="btn-icon">🏆</span>
            </button>
          )}
          <button
            type="button"
            className="btn-simple btn-icon-square"
            onClick={onOpenOptions}
            title="Settings"
            aria-label="Settings"
          >
            <span className="btn-icon">⚙️</span>
          </button>
        </div>
      </header>

      <main className="menu-container">
        {/* Featured Practice Actions */}
        <div className="menu-featured-actions">
          <button className="menu-action-btn" onClick={onStartWorkout}>
            ⚡ General Practice
          </button>
          {isAllowed && (
            <button className="menu-action-btn" onClick={onOpenTestsList}>
              📝 Practice Tests
            </button>
          )}
        </div>

        {/* Mobile / Narrow Tab Switcher (hidden on wide side-by-side screens) */}
        <div
          className="menu-tabs-bar"
          role="tablist"
          aria-label="Practice category"
          onKeyDown={handleTabKeyDown}
        >
          <div
            className={`menu-tabs-indicator ${
              visualActiveTab === 'ciphers' ? 'is-ciphers' : 'is-drills'
            }${isDragging ? ' is-dragging' : ''}`}
            style={{
              transform: `translate3d(${indicatorProgress * 100}%, 0, 0)`,
            }}
            aria-hidden="true"
          />
          <button
            id="menu-tab-drills"
            type="button"
            role="tab"
            aria-selected={activeTab === 'drills'}
            aria-controls="menu-panel-drills"
            tabIndex={activeTab === 'drills' ? 0 : -1}
            className={`menu-tab-btn menu-tab-btn-drills ${
              visualActiveTab === 'drills' ? 'active' : ''
            }`}
            onClick={() => onSelectTab('drills')}
          >
            <svg
              className="menu-tab-icon"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="8" y1="2" x2="12" y2="2" />
              <line x1="10" y1="2" x2="10" y2="4.5" />
              <line x1="14.8" y1="5.2" x2="16.2" y2="3.8" />
              <circle cx="10" cy="11.5" r="6.5" />
              <polyline points="10 8 10 11.5 12.6 13" />
            </svg>
            <span>Drills</span>
          </button>

          <button
            id="menu-tab-ciphers"
            type="button"
            role="tab"
            aria-selected={activeTab === 'ciphers'}
            aria-controls="menu-panel-ciphers"
            tabIndex={activeTab === 'ciphers' ? 0 : -1}
            className={`menu-tab-btn menu-tab-btn-ciphers ${
              visualActiveTab === 'ciphers' ? 'active' : ''
            }`}
            onClick={() => onSelectTab('ciphers')}
          >
            <svg
              className="menu-tab-icon"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="2.5" y="3" width="6.2" height="6.2" rx="1.2" />
              <rect x="11.3" y="3" width="6.2" height="6.2" rx="1.2" />
              <rect x="2.5" y="11.3" width="6.2" height="6.2" rx="1.2" />
              <path d="M12.2 14.4h4.4M14.4 12.2v4.4" />
            </svg>
            <span>Ciphers</span>
          </button>
        </div>

        {/* Swipeable Viewport on Narrow Screens / Side-by-Side Grid on Wide Screens */}
        <div
          ref={viewportRef}
          className="menu-panes-viewport"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={(e) => finishSwipe(e, false)}
          onPointerCancel={(e) => finishSwipe(e, true)}
          onClickCapture={handleClickCapture}
        >
          <div
            className={`menu-panes-track${isDragging ? ' is-dragging' : ''}`}
            style={trackTransform ? { transform: trackTransform } : undefined}
          >
            {/* Pane 1: Drills */}
            <section
              id="menu-panel-drills"
              role={isSideBySide ? 'region' : 'tabpanel'}
              aria-labelledby={
                isSideBySide ? 'menu-heading-drills' : 'menu-tab-drills'
              }
              inert={!isSideBySide && activeTab !== 'drills' ? true : undefined}
              className="menu-pane-card menu-pane-drills"
            >
              <div
                className="menu-pane-bg menu-pane-bg-drills"
                style={{ backgroundImage: `url("${drillsBgUrl}")` }}
                aria-hidden="true"
              />
              <div
                className="menu-pane-tint menu-pane-tint-drills"
                aria-hidden="true"
              />

              <div className="menu-pane-content">
                <div className="menu-pane-header">
                  <h2 id="menu-heading-drills" className="menu-pane-title">
                    <svg
                      className="menu-tab-icon"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <line x1="8" y1="2" x2="12" y2="2" />
                      <line x1="10" y1="2" x2="10" y2="4.5" />
                      <line x1="14.8" y1="5.2" x2="16.2" y2="3.8" />
                      <circle cx="10" cy="11.5" r="6.5" />
                      <polyline points="10 8 10 11.5 12.6 13" />
                    </svg>
                    <span>Drills</span>
                  </h2>
                  <span className="menu-pane-subtitle">
                    Speed &amp; Symbol Flashcards
                  </span>
                </div>

                <div className="menu-buttons-list">
                  {/* Letter Offsets — Horizontal Labeled Row */}
                  <div
                    className="menu-labeled-row"
                    role="group"
                    aria-labelledby="menu-offsets-row-label"
                  >
                    <span
                      id="menu-offsets-row-label"
                      className="menu-labeled-row-title"
                    >
                      Letter Offsets
                    </span>
                    <div className="menu-labeled-row-actions">
                      <button
                        type="button"
                        className="menu-drill-btn menu-inline-pill-btn"
                        onClick={() =>
                          onSelectDrill('offsets', 'memorize', {
                            offsetsMode: 'letterToNum',
                          })
                        }
                        aria-label="Letter Offsets: ABC to Number"
                      >
                        ABC → #
                      </button>
                      <button
                        type="button"
                        className="menu-drill-btn menu-inline-pill-btn"
                        onClick={() =>
                          onSelectDrill('offsets', 'memorize', {
                            offsetsMode: 'numToLetter',
                          })
                        }
                        aria-label="Letter Offsets: Number to ABC"
                      >
                        # → ABC
                      </button>
                    </div>
                  </div>

                  {/* Letter Math — Grouped Sub-Card inside Drills */}
                  {isLetterMathVisible && (
                    <div
                      className="menu-drill-group"
                      role="group"
                      aria-labelledby="menu-letter-math-group-label"
                    >
                      <div className="menu-drill-group-header">
                        <span
                          id="menu-letter-math-group-label"
                          className="menu-drill-group-label"
                        >
                          Letter Math
                        </span>
                        {areAllVisibleLetterMathRowsUnpublished &&
                          renderPreviewStatusBadge(
                            'Beta preview — enable Caesar / Vigenère in Settings'
                          )}
                      </div>

                      {isNumMathVisible && (
                        <div
                          className="menu-labeled-row menu-labeled-row-nested"
                          role="group"
                          aria-labelledby="menu-letter-math-num-label"
                        >
                          <div className="menu-labeled-row-left">
                            <span
                              id="menu-letter-math-num-label"
                              className="menu-labeled-row-title"
                            >
                              ABC ± #
                            </span>
                            {!areAllVisibleLetterMathRowsUnpublished &&
                              isNumMathUnpublished &&
                              renderPreviewStatusBadge(
                                'Beta preview — enable Caesar (±3) & ABC ± # in Settings'
                              )}
                          </div>
                          <div className="menu-labeled-row-actions">
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn"
                              onClick={() =>
                                onSelectDrill('letterMath', 'memorize', {
                                  letterMathMode: 'easy',
                                })
                              }
                              aria-label="Letter Math ABC plus or minus Number: Easy (up to 3)"
                            >
                              Easy
                            </button>
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn"
                              onClick={() =>
                                onSelectDrill('letterMath', 'memorize', {
                                  letterMathMode: 'hard',
                                })
                              }
                              aria-label="Letter Math ABC plus or minus Number: Hard (any offset)"
                            >
                              Hard
                            </button>
                          </div>
                        </div>
                      )}

                      {isLetterToLetterMathVisible && (
                        <div
                          className="menu-labeled-row menu-labeled-row-nested"
                          role="group"
                          aria-labelledby="menu-letter-math-let-label"
                        >
                          <div className="menu-labeled-row-left">
                            <span
                              id="menu-letter-math-let-label"
                              className="menu-labeled-row-title"
                            >
                              ABC ± ABC
                            </span>
                            {!areAllVisibleLetterMathRowsUnpublished &&
                              isLetterToLetterMathUnpublished &&
                              renderPreviewStatusBadge(
                                'Beta preview — enable Vigenère & ABC ± ABC in Settings'
                              )}
                          </div>
                          <div className="menu-labeled-row-actions">
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn"
                              onClick={() =>
                                onSelectDrill('letterMath', 'memorize', {
                                  letterMathMode: 'letterEasy',
                                })
                              }
                              aria-label="Letter Math ABC plus or minus ABC: Easy"
                            >
                              Easy
                            </button>
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn"
                              onClick={() =>
                                onSelectDrill('letterMath', 'memorize', {
                                  letterMathMode: 'letterHard',
                                })
                              }
                              aria-label="Letter Math ABC plus or minus ABC: Hard"
                            >
                              Hard
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {visibleFlashcardDrills.map((d) => {
                    const isUnpublished =
                      hasPreviewAccess &&
                      !isCipherEnabledForStudent(d.id, generalPracticeCiphers);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`menu-drill-btn${
                          isUnpublished ? ' menu-drill-btn-with-badge' : ''
                        }`}
                        onClick={() => onSelectDrill(d.id, 'memorize')}
                      >
                        <span>{d.menuLabel}</span>
                        {isUnpublished && renderPreviewStatusBadge()}
                      </button>
                    );
                  })}

                  {comingSoonDrillLabels.length > 0 && (
                    <>
                      <div className="menu-divider coming-soon-divider">
                        <span>Coming Soon</span>
                      </div>
                      <div className="menu-buttons-list disabled-list">
                        {comingSoonDrillLabels.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className="menu-drill-btn btn-disabled"
                            disabled
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>

            {/* Pane 2: Ciphers */}
            <section
              id="menu-panel-ciphers"
              role={isSideBySide ? 'region' : 'tabpanel'}
              aria-labelledby={
                isSideBySide ? 'menu-heading-ciphers' : 'menu-tab-ciphers'
              }
              inert={!isSideBySide && activeTab !== 'ciphers' ? true : undefined}
              className="menu-pane-card menu-pane-ciphers"
            >
              <div
                className="menu-pane-bg menu-pane-bg-ciphers"
                style={{ backgroundImage: `url("${ciphersBgUrl}")` }}
                aria-hidden="true"
              />
              <div
                className="menu-pane-tint menu-pane-tint-ciphers"
                aria-hidden="true"
              />

              <div className="menu-pane-content">
                <div className="menu-pane-header">
                  <h2 id="menu-heading-ciphers" className="menu-pane-title">
                    <svg
                      className="menu-tab-icon"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="2.5" y="3" width="6.2" height="6.2" rx="1.2" />
                      <rect x="11.3" y="3" width="6.2" height="6.2" rx="1.2" />
                      <rect x="2.5" y="11.3" width="6.2" height="6.2" rx="1.2" />
                      <path d="M12.2 14.4h4.4M14.4 12.2v4.4" />
                    </svg>
                    <span>Ciphers</span>
                  </h2>
                  <span className="menu-pane-subtitle">
                    Full-Quote Cryptograms
                  </span>
                </div>

                <div className="menu-buttons-list">
                  {visibleQuoteCiphers.map((d) => {
                    const isUnpublished =
                      hasPreviewAccess &&
                      !isCipherEnabledForStudent(d.id, generalPracticeCiphers);

                    if (d.id === 'caesar') {
                      return (
                        <div
                          key={d.id}
                          className="menu-labeled-row"
                          role="group"
                          aria-labelledby="menu-caesar-row-label"
                        >
                          <div className="menu-labeled-row-left">
                            <span
                              id="menu-caesar-row-label"
                              className="menu-labeled-row-title"
                            >
                              {d.menuLabel}
                            </span>
                            {isUnpublished && renderPreviewStatusBadge()}
                          </div>
                          <div className="menu-labeled-row-actions">
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn"
                              onClick={() =>
                                onSelectDrill('caesar', 'cipher', {
                                  caesarRange: 'pm3',
                                })
                              }
                              aria-label="Caesar Cipher: Offset plus or minus 3"
                            >
                              Offset ± 3
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`menu-drill-btn${
                          isUnpublished ? ' menu-drill-btn-with-badge' : ''
                        }`}
                        onClick={() => onSelectDrill(d.id, 'cipher')}
                      >
                        <span>{d.menuLabel}</span>
                        {isUnpublished && renderPreviewStatusBadge()}
                      </button>
                    );
                  })}

                  {comingSoonCiphers.length > 0 && (
                    <>
                      <div className="menu-divider coming-soon-divider">
                        <span>Coming Soon</span>
                      </div>
                      <div className="menu-buttons-list disabled-list">
                        {comingSoonCiphers.map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            className="menu-drill-btn btn-disabled"
                            disabled
                          >
                            {d.menuLabel}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="menu-footer">
          <span>
            DaVinci Decoders — Interactive Science Olympiad cipher &amp; cryptogram trainer
          </span>
          <span className="menu-footer-sep" aria-hidden="true">
            •
          </span>
          <a
            href={
              import.meta.env.DEV
                ? '/privacy_policy.html'
                : 'https://pnowell.github.io/codebusters/privacy_policy.html'
            }
            className="menu-footer-link"
          >
            Privacy Policy
          </a>
        </footer>
      </main>
    </>
  );
};
