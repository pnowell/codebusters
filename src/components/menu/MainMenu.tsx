import React from 'react';
import {
  DRILLS,
  isCipherEnabledForStudent,
  type CipherType,
} from '../../data/drills';
import { useDualPaneTabs } from '../../hooks/useDualPaneTabs';
import type {
  AristocratDifficulty,
  CaesarRangeMode,
  GeneralPracticeCiphers,
  LetterMathMode,
  MainMenuTab,
  OffsetsMode,
} from '../../types';
import type { DrillSection } from '../../utils/routing';
import { UserAuthBadge } from '../auth/UserAuthBadge';
import {
  CiphersTabIcon,
  DrillsTabIcon,
} from '../shared/DualPaneTabIcons';

export interface SelectDrillOptions {
  offsetsMode?: OffsetsMode;
  letterMathMode?: LetterMathMode;
  caesarRange?: CaesarRangeMode;
  aristocratDifficulty?: AristocratDifficulty;
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
  onOpenAnalytics?: () => void;
  onOpenOptions: () => void;
  onSelectDrill: (
    drill: CipherType,
    section: DrillSection,
    options?: SelectDrillOptions
  ) => void;
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
  onOpenAnalytics,
  onOpenOptions,
  onSelectDrill,
}) => {
  const hasPreviewAccess = isTeacher || isBetaTester;

  const {
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
  } = useDualPaneTabs({
    activeTab,
    onSelectTab,
    drillsTabId: 'menu-tab-drills',
    ciphersTabId: 'menu-tab-ciphers',
  });

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

  const drillsBgUrl = `${import.meta.env.BASE_URL}images/menu-drills-bg.jpg`;
  const ciphersBgUrl = `${import.meta.env.BASE_URL}images/menu-ciphers-bg.jpg`;

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
          {isTeacher && onOpenAnalytics && (
            <button
              type="button"
              className="btn-simple btn-icon-square"
              onClick={onOpenAnalytics}
              title="Class Analytics"
              aria-label="Class Analytics"
            >
              <span className="btn-icon">📊</span>
            </button>
          )}
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
            <DrillsTabIcon />
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
            <CiphersTabIcon />
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
                    <DrillsTabIcon />
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
                            {isNumMathUnpublished &&
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
                            {isLetterToLetterMathUnpublished &&
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
                    <CiphersTabIcon />
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

                    if (d.id === 'aristocrat') {
                      return (
                        <div
                          key={d.id}
                          className="menu-labeled-row menu-labeled-row-aristocrat"
                          role="group"
                          aria-labelledby="menu-aristocrat-row-label"
                        >
                          <div className="menu-labeled-row-left">
                            <span
                              id="menu-aristocrat-row-label"
                              className="menu-labeled-row-title"
                            >
                              {d.menuLabel}
                            </span>
                            {isUnpublished && renderPreviewStatusBadge()}
                          </div>
                          <div className="menu-labeled-row-actions menu-labeled-row-actions-3">
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn menu-inline-pill-compact"
                              onClick={() =>
                                onSelectDrill('aristocrat', 'cipher', {
                                  aristocratDifficulty: 'easy',
                                })
                              }
                              aria-label="Aristocrat Cipher: Easy"
                            >
                              Easy
                            </button>
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn menu-inline-pill-compact"
                              onClick={() =>
                                onSelectDrill('aristocrat', 'cipher', {
                                  aristocratDifficulty: 'medium',
                                })
                              }
                              aria-label="Aristocrat Cipher: Medium"
                            >
                              Med
                            </button>
                            <button
                              type="button"
                              className="menu-drill-btn menu-inline-pill-btn menu-inline-pill-compact"
                              onClick={() =>
                                onSelectDrill('aristocrat', 'cipher', {
                                  aristocratDifficulty: 'hard',
                                })
                              }
                              aria-label="Aristocrat Cipher: Hard"
                            >
                              Hard
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
