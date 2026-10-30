import React from 'react';
import { COMING_SOON_DRILLS, type CipherType } from '../../data/drills';
import type { DrillSection } from '../../utils/routing';
import { UserAuthBadge } from '../auth/UserAuthBadge';

interface MainMenuProps {
  studentName: string;
  isAllowed: boolean;
  onStartWorkout: () => void;
  onOpenTestsList: () => void;
  onOpenLeaderboard: () => void;
  onOpenOptions: () => void;
  onSelectDrill: (drill: CipherType, section: DrillSection) => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({
  studentName,
  isAllowed,
  onStartWorkout,
  onOpenTestsList,
  onOpenLeaderboard,
  onOpenOptions,
  onSelectDrill,
}) => (
  <>
    <header className="main-header">
      <div className="brand-text">
        <h1>DaVinci Decoders</h1>
        <div className="subtitle">Science Olympiad Division A Trainer</div>
      </div>

      <div className="header-user-actions">
        <UserAuthBadge displayName={studentName} onOpenOptions={onOpenOptions} />
        {isAllowed && (
          <button
            type="button"
            className="btn-simple btn-icon-square"
            onClick={onOpenLeaderboard}
            title="Team Leaderboard"
            aria-label="Team Leaderboard"
          >
            <span className="btn-icon">🏆</span>
          </button>
        )}
        <button
          type="button"
          className="btn-simple btn-icon-square"
          onClick={onOpenOptions}
          title="Classroom Settings"
          aria-label="Classroom Settings"
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
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('offsets', 'memorize')}
        >
          Letter Offsets
        </button>
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('atbash', 'memorize')}
        >
          Atbash
        </button>
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('pigpen', 'memorize')}
        >
          Pigpen
        </button>
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('galactic', 'memorize')}
        >
          Standard Galactic Alphabet
        </button>
      </div>

      {/* Section: Ciphers */}
      <div className="menu-divider">
        <span>Ciphers</span>
      </div>

      <div className="menu-buttons-list">
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('atbash', 'cipher')}
        >
          Atbash
        </button>
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('pigpen', 'cipher')}
        >
          Pigpen
        </button>
        <button
          type="button"
          className="menu-drill-btn"
          onClick={() => onSelectDrill('galactic', 'cipher')}
        >
          Standard Galactic Alphabet
        </button>
      </div>

      {/* Section: Coming Soon */}
      <div className="menu-divider coming-soon-divider">
        <span>Coming Soon</span>
      </div>

      <div className="menu-buttons-list disabled-list">
        {COMING_SOON_DRILLS.map((d) => (
          <button key={d.id} className="menu-drill-btn btn-disabled" disabled>
            {d.name}
          </button>
        ))}
      </div>
    </main>
  </>
);
