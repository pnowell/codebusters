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
        <div className="header-brand">
          <div className="logo-icon">🗝️</div>
          <div className="brand-text">
            <h1>DaVinci Decoders</h1>
            <div className="subtitle">Science Olympiad Division A Trainer</div>
          </div>
        </div>

        <div className="header-user-actions">
          <span className="student-tag">👤 {settings.studentName}</span>
          <button
            className="btn-secondary"
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

      {/* Main Menu Dashboard */}
      {!activeDrill && (
        <main className="dashboard-content">
          <div className="hero-banner card-panel">
            <div className="hero-content">
              <h2>Ready for your Cipher Workout?</h2>
              <p>Practice speed, test your letter offsets, or decode quotes using official competition references.</p>
            </div>
            <button className="btn-large" onClick={handleRandomPractice}>
              ⚡ General Practice
            </button>
          </div>

          <div className="section-heading">Phase 1: Foundations & Symbol Ciphers</div>
          <div className="drill-grid">
            {/* Letter Offsets */}
            <div
              className="card-panel cipher-card"
              onClick={() => setActiveDrill('offsets')}
            >
              <div className="card-top">
                <div className="cipher-icon">🔢</div>
                <span className="badge">Mental Math</span>
              </div>
              <h3>Letter Offsets</h3>
              <p>Memorize A=0 through Z=25 to decode Atbash and Caesar in seconds without a sheet.</p>
              <div className="card-btn">Start Drill →</div>
            </div>

            {/* Atbash */}
            <div
              className={`card-panel cipher-card ${!settings.unlockedCiphers.includes('atbash') ? 'card-locked' : ''}`}
              onClick={() => settings.unlockedCiphers.includes('atbash') && setActiveDrill('atbash')}
            >
              <div className="card-top">
                <div className="cipher-icon">🪞</div>
                <span className="badge">Substitution</span>
              </div>
              <h3>Atbash Cipher</h3>
              <p>Reversed alphabet mapping (A↔Z, B↔Y). Pairs sum to 25!</p>
              <div className="card-btn">Practice Atbash →</div>
            </div>

            {/* Pigpen */}
            <div
              className={`card-panel cipher-card ${!settings.unlockedCiphers.includes('pigpen') ? 'card-locked' : ''}`}
              onClick={() => settings.unlockedCiphers.includes('pigpen') && setActiveDrill('pigpen')}
            >
              <div className="card-top">
                <div className="cipher-icon">🐷</div>
                <span className="badge">Symbol Grid</span>
              </div>
              <h3>Pigpen / Masonic</h3>
              <p>Classic tic-tac-toe and X grids with dots. Rapid symbol lookup.</p>
              <div className="card-btn">Decode Pigpen →</div>
            </div>

            {/* Standard Galactic */}
            <div
              className={`card-panel cipher-card ${!settings.unlockedCiphers.includes('galactic') ? 'card-locked' : ''}`}
              onClick={() => settings.unlockedCiphers.includes('galactic') && setActiveDrill('galactic')}
            >
              <div className="card-top">
                <div className="cipher-icon">🌌</div>
                <span className="badge">Minecraft Glyphs</span>
              </div>
              <h3>Standard Galactic</h3>
              <p>Decode enchanting table runes using the official translation table.</p>
              <div className="card-btn">Decode Galactic →</div>
            </div>
          </div>

          <div className="section-heading">Upcoming Ciphers (Unlocking in Meetings 2–4)</div>
          <div className="drill-grid">
            <div className="card-panel cipher-card card-locked">
              <div className="card-top">
                <div className="cipher-icon">🏛️</div>
                <span className="badge badge-locked">Meeting 2</span>
              </div>
              <h3>Caesar Cipher</h3>
              <p>Shifted alphabet by ±1, ±2, or ±3 characters. Spot the shift and decrypt.</p>
            </div>

            <div className="card-panel cipher-card card-locked">
              <div className="card-top">
                <div className="cipher-icon">🚪</div>
                <span className="badge badge-locked">Meeting 2</span>
              </div>
              <h3>Tap Code</h3>
              <p>5×5 grid coordinates. AFLQV trick for on-the-fly mental decoding.</p>
            </div>

            <div className="card-panel cipher-card card-locked">
              <div className="card-top">
                <div className="cipher-icon">⚔️</div>
                <span className="badge badge-locked">Meeting 2</span>
              </div>
              <h3>Knights Templar</h3>
              <p>Eight-pointed cross geometry with angles, triangles, and kites.</p>
            </div>

            <div className="card-panel cipher-card card-locked">
              <div className="card-top">
                <div className="cipher-icon">📐</div>
                <span className="badge badge-locked">Meeting 3</span>
              </div>
              <h3>Vigenère Cipher</h3>
              <p>Polyalphabetic decryption with repeated keyword and tableau.</p>
            </div>

            <div className="card-panel cipher-card card-locked">
              <div className="card-top">
                <div className="cipher-icon">👑</div>
                <span className="badge badge-locked">Meeting 3-4</span>
              </div>
              <h3>Aristocrat Cryptanalysis</h3>
              <p>The championship differentiator: frequencies, short words, contractions, and elimination.</p>
            </div>
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
