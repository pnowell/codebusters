import React from 'react';
import {
  DRILLS,
  isCipherEnabledForStudent,
  type CipherType,
} from '../../data/drills';
import type {
  CaesarRangeMode,
  GeneralPracticeCiphers,
  LetterMathMode,
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
  generalPracticeCiphers: GeneralPracticeCiphers;
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

export const MainMenu: React.FC<MainMenuProps> = ({
  studentName,
  isAllowed,
  isTeacher,
  generalPracticeCiphers,
  onStartWorkout,
  onOpenTestsList,
  onOpenLeaderboard,
  onOpenOptions,
  onSelectDrill,
}) => {
  const isLetterMathVisible =
    isTeacher || isCipherEnabledForStudent('letterMath', generalPracticeCiphers);
  const isLetterMathHiddenFromStudents =
    isTeacher && !isCipherEnabledForStudent('letterMath', generalPracticeCiphers);

  const visibleFlashcardDrills = DRILLS.filter(
    (d) =>
      d.id !== 'offsets' &&
      d.id !== 'letterMath' &&
      d.implemented &&
      d.hasFlashcardDrill &&
      (isTeacher || isCipherEnabledForStudent(d.id, generalPracticeCiphers))
  );

  const visibleQuoteCiphers = DRILLS.filter(
    (d) =>
      d.implemented &&
      d.hasQuoteWorkspace &&
      (isTeacher || isCipherEnabledForStudent(d.id, generalPracticeCiphers))
  );

  const comingSoonDrills = DRILLS.filter(
    (d) =>
      d.id !== 'offsets' &&
      d.id !== 'letterMath' &&
      (!d.implemented ||
        (!isTeacher && !isCipherEnabledForStudent(d.id, generalPracticeCiphers)))
  );

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

        {/* Section: Drills */}
        <div className="menu-divider">
          <span>Drills</span>
        </div>

        <div className="menu-buttons-list">
          {/* Letter Offsets — Horizontal Labeled Row */}
          <div
            className="menu-labeled-row"
            role="group"
            aria-labelledby="menu-offsets-row-label"
          >
            <span id="menu-offsets-row-label" className="menu-labeled-row-title">
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
                {isLetterMathHiddenFromStudents && (
                  <span
                    className="menu-teacher-hidden-badge"
                    title="Hidden from students — enable Caesar Cipher in Settings"
                  >
                    🔒 Hidden
                  </span>
                )}
              </div>

              <div
                className="menu-labeled-row menu-labeled-row-nested"
                role="group"
                aria-labelledby="menu-letter-math-num-label"
              >
                <span
                  id="menu-letter-math-num-label"
                  className="menu-labeled-row-title"
                >
                  ABC ± #
                </span>
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
            </div>
          )}

          {visibleFlashcardDrills.map((d) => {
            const isHiddenFromStudents =
              isTeacher && !isCipherEnabledForStudent(d.id, generalPracticeCiphers);
            return (
              <button
                key={d.id}
                type="button"
                className={`menu-drill-btn${isHiddenFromStudents ? ' menu-drill-btn-with-badge' : ''}`}
                onClick={() => onSelectDrill(d.id, 'memorize')}
              >
                <span>{d.menuLabel}</span>
                {isHiddenFromStudents && (
                  <span
                    className="menu-teacher-hidden-badge"
                    title="Hidden from students — enable in Settings"
                  >
                    🔒 Hidden
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Section: Ciphers */}
        {visibleQuoteCiphers.length > 0 && (
          <>
            <div className="menu-divider">
              <span>Ciphers</span>
            </div>

            <div className="menu-buttons-list">
              {visibleQuoteCiphers.map((d) => {
                const isHiddenFromStudents =
                  isTeacher && !isCipherEnabledForStudent(d.id, generalPracticeCiphers);

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
                        {isHiddenFromStudents && (
                          <span
                            className="menu-teacher-hidden-badge"
                            title="Hidden from students — enable in Settings"
                          >
                            🔒 Hidden
                          </span>
                        )}
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
                    className={`menu-drill-btn${isHiddenFromStudents ? ' menu-drill-btn-with-badge' : ''}`}
                    onClick={() => onSelectDrill(d.id, 'cipher')}
                  >
                    <span>{d.menuLabel}</span>
                    {isHiddenFromStudents && (
                      <span
                        className="menu-teacher-hidden-badge"
                        title="Hidden from students — enable in Settings"
                      >
                        🔒 Hidden
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Section: Coming Soon */}
        {comingSoonDrills.length > 0 && (
          <>
            <div className="menu-divider coming-soon-divider">
              <span>Coming Soon</span>
            </div>

            <div className="menu-buttons-list disabled-list">
              {comingSoonDrills.map((d) => (
                <button key={d.id} className="menu-drill-btn btn-disabled" disabled>
                  {d.name}
                </button>
              ))}
            </div>
          </>
        )}

        <footer className="menu-footer">
          <span>DaVinci Decoders — Interactive Science Olympiad cipher &amp; cryptogram trainer</span>
          <span className="menu-footer-sep" aria-hidden="true">•</span>
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
