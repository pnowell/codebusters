import React, { useState, useEffect } from 'react';
import type { CipherType, UserSettings } from './types';
import { LetterOffsetDrill } from './components/drills/LetterOffsetDrill';
import { LookupCipherDrill } from './components/drills/LookupCipherDrill';
import { OptionsModal } from './components/options/OptionsModal';

const DEFAULT_UNLOCKED: CipherType[] = ['offsets', 'atbash', 'pigpen', 'galactic'];

export const App: React.FC = () => {
  const [settings, setSettings] = useState<UserSettings>(() => {
    const saved = localStorage.getItem('davinci_settings');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        // Fallback
      }
    }
    return {
      studentName: 'Decoder',
      unlockedCiphers: DEFAULT_UNLOCKED,
      isTeacher: false,
      soundEnabled: true,
    };
  });

  const [activeDrill, setActiveDrill] = useState<CipherType | null>(null);
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);

  // Check URL query parameters on load to allow one-click sync from coach
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const unlockedParam = params.get('unlocked');
    if (unlockedParam) {
      const ciphersFromUrl = unlockedParam.split(',') as CipherType[];
      setSettings(prev => {
        const updated = { ...prev, unlockedCiphers: ciphersFromUrl };
        localStorage.setItem('davinci_settings', JSON.stringify(updated));
        return updated;
      });
    }
  }, []);

  const handleSaveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    localStorage.setItem('davinci_settings', JSON.stringify(newSettings));
  };

  // Launch a random unlocked drill for General Practice
  const handleRandomPractice = () => {
    const activePool = settings.unlockedCiphers.filter(c =>
      ['offsets', 'atbash', 'pigpen', 'galactic'].includes(c)
    );
    if (activePool.length > 0) {
      const chosen = activePool[Math.floor(Math.random() * activePool.length)];
      setActiveDrill(chosen);
    }
  };

  return (
    <div className="app-container">
      <header className="main-header">
        <div className="brand-text">
          <h1>DaVinci Decoders</h1>
          <div className="subtitle">Science Olympiad Division A Trainer</div>
        </div>

        <div className="header-user-actions">
          <span className="student-tag">👤 {settings.studentName}</span>
          <button
            className="btn-simple"
            onClick={() => setIsOptionsOpen(true)}
            title="Classroom Settings"
          >
            ⚙️ Options
          </button>
        </div>
      </header>

      {/* Active Drill View */}
      {activeDrill === 'offsets' && (
        <LetterOffsetDrill onBack={() => setActiveDrill(null)} />
      )}

      {activeDrill === 'atbash' && (
        <LookupCipherDrill cipher="atbash" onBack={() => setActiveDrill(null)} />
      )}

      {activeDrill === 'pigpen' && (
        <LookupCipherDrill cipher="pigpen" onBack={() => setActiveDrill(null)} />
      )}

      {activeDrill === 'galactic' && (
        <LookupCipherDrill cipher="galactic" onBack={() => setActiveDrill(null)} />
      )}

      {/* Simplified Main Menu Dashboard */}
      {!activeDrill && (
        <main className="menu-container">
          {/* General Practice Button at Top */}
          <div className="general-practice-section">
            <button className="btn-main-action" onClick={handleRandomPractice}>
              ⚡ General Practice
            </button>
          </div>

          {/* Divider: Individual Practice */}
          <div className="menu-divider">
            <span>Individual Practice</span>
          </div>

          <div className="menu-buttons-list">
            <button
              className="menu-drill-btn"
              onClick={() => setActiveDrill('offsets')}
            >
              Letter Offsets
            </button>

            <button
              className="menu-drill-btn"
              onClick={() => setActiveDrill('atbash')}
            >
              Atbash Cipher
            </button>

            <button
              className="menu-drill-btn"
              onClick={() => setActiveDrill('pigpen')}
            >
              Pigpen / Masonic Cipher
            </button>

            <button
              className="menu-drill-btn"
              onClick={() => setActiveDrill('galactic')}
            >
              Standard Galactic Alphabet
            </button>
          </div>

          {/* Divider: Coming Soon */}
          <div className="menu-divider">
            <span>Coming Soon</span>
          </div>

          <div className="menu-buttons-list disabled-list">
            <button className="menu-drill-btn btn-disabled" disabled>
              Caesar Cipher (±3)
            </button>
            <button className="menu-drill-btn btn-disabled" disabled>
              Tap Code Cipher
            </button>
            <button className="menu-drill-btn btn-disabled" disabled>
              Knights Templar Cipher
            </button>
            <button className="menu-drill-btn btn-disabled" disabled>
              Vigenère Cipher
            </button>
            <button className="menu-drill-btn btn-disabled" disabled>
              Aristocrat Cryptanalysis
            </button>
          </div>
        </main>
      )}

      {/* Settings Modal */}
      <OptionsModal
        isOpen={isOptionsOpen}
        onClose={() => setIsOptionsOpen(false)}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
};

export default App;
