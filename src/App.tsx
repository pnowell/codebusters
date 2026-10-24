import React, { useState, useEffect } from 'react';
import type { CipherType, UserSettings } from './types';
import { LetterOffsetDrill } from './components/drills/LetterOffsetDrill';
import { LookupCipherDrill } from './components/drills/LookupCipherDrill';
import { OptionsModal } from './components/options/OptionsModal';
import {
  DEFAULT_UNLOCKED,
  IMPLEMENTED_DRILLS,
  COMING_SOON_DRILLS,
  isCipherType,
} from './data/drills';

const parseUrlRoute = () => {
  const params = new URLSearchParams(window.location.search);
  const drill = params.get('drill');
  const qStr = params.get('q');
  const quoteId = qStr !== null ? parseInt(qStr, 10) : undefined;

  return {
    drill: isCipherType(drill) ? drill : null,
    quoteId: quoteId !== undefined && !isNaN(quoteId) ? quoteId : undefined,
  };
};

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
    };
  });

  const [activeDrill, setActiveDrill] = useState<CipherType | null>(() => parseUrlRoute().drill);
  const [activeQuoteId, setActiveQuoteId] = useState<number | undefined>(() => parseUrlRoute().quoteId);
  const [isOptionsOpen, setIsOptionsOpen] = useState<boolean>(false);

  // Track the actual visible viewport height above mobile virtual keyboard
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

  // Listen to browser Back / Forward buttons
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (isOptionsOpen && (!e.state || e.state.modal !== 'options')) {
        setIsOptionsOpen(false);
      }
      const route = parseUrlRoute();
      setActiveDrill(route.drill);
      setActiveQuoteId(route.quoteId);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isOptionsOpen]);

  // Handle deep-link history: if user lands directly on a drill from a link,
  // seed the history stack with the menu first so browser back goes to menu instead of closing app
  useEffect(() => {
    const route = parseUrlRoute();
    if (route.drill && (!window.history.state || !('drill' in window.history.state))) {
      window.history.replaceState({ drill: null }, '', window.location.pathname);
      const drillUrl = `${window.location.pathname}${window.location.search}`;
      window.history.pushState({ drill: route.drill, quoteId: route.quoteId }, '', drillUrl);
    }
  }, []);

  const navigateToDrill = (drill: CipherType, quoteId?: number) => {
    setActiveDrill(drill);
    setActiveQuoteId(quoteId);
    const params = new URLSearchParams(window.location.search);
    params.set('drill', drill);
    if (quoteId !== undefined) {
      params.set('q', quoteId.toString());
    } else {
      params.delete('q');
    }
    const query = params.toString();
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.pushState({ drill, quoteId }, '', newUrl);
  };

  const navigateToMenu = () => {
    if (window.history.state && window.history.state.drill) {
      window.history.back();
    } else {
      setActiveDrill(null);
      setActiveQuoteId(undefined);
      const params = new URLSearchParams(window.location.search);
      params.delete('drill');
      params.delete('q');
      const query = params.toString();
      const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.pushState({ drill: null }, '', newUrl);
    }
  };

  const handleQuoteChange = (newQuoteId: number) => {
    setActiveQuoteId(newQuoteId);
    const params = new URLSearchParams(window.location.search);
    if (activeDrill) {
      params.set('drill', activeDrill);
      params.set('q', newQuoteId.toString());
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState({ drill: activeDrill, quoteId: newQuoteId }, '', newUrl);
    }
  };

  const openOptions = () => {
    window.history.pushState({ modal: 'options' }, '', window.location.href);
    setIsOptionsOpen(true);
  };

  const closeOptions = () => {
    if (window.history.state?.modal === 'options') {
      window.history.back();
    } else {
      setIsOptionsOpen(false);
    }
  };

  const handleSaveSettings = (newSettings: UserSettings) => {
    setSettings(newSettings);
    localStorage.setItem('davinci_settings', JSON.stringify(newSettings));
  };

  // Launch a random unlocked drill for General Practice
  const handleRandomPractice = () => {
    const activePool = settings.unlockedCiphers.filter(id =>
      IMPLEMENTED_DRILLS.some(d => d.id === id)
    );
    if (activePool.length > 0) {
      const chosen = activePool[Math.floor(Math.random() * activePool.length)];
      navigateToDrill(chosen);
    }
  };

  return (
    <div className="app-container">
      {/* Main Header only visible on the main menu */}
      {!activeDrill && (
        <header className="main-header">
          <div className="brand-text">
            <h1>DaVinci Decoders</h1>
            <div className="subtitle">Science Olympiad Division A Trainer</div>
          </div>

          <div className="header-user-actions">
            <span className="student-tag">👤 {settings.studentName}</span>
            <button
              className="btn-simple"
              onClick={openOptions}
              title="Classroom Settings"
            >
              ⚙️ Options
            </button>
          </div>
        </header>
      )}

      {/* Active Drill View */}
      {activeDrill === 'offsets' && (
        <LetterOffsetDrill onBack={navigateToMenu} />
      )}

      {activeDrill === 'atbash' && (
        <LookupCipherDrill
          cipher="atbash"
          initialQuoteId={activeQuoteId}
          onQuoteChange={handleQuoteChange}
          onBack={navigateToMenu}
        />
      )}

      {activeDrill === 'pigpen' && (
        <LookupCipherDrill
          cipher="pigpen"
          initialQuoteId={activeQuoteId}
          onQuoteChange={handleQuoteChange}
          onBack={navigateToMenu}
        />
      )}

      {activeDrill === 'galactic' && (
        <LookupCipherDrill
          cipher="galactic"
          initialQuoteId={activeQuoteId}
          onQuoteChange={handleQuoteChange}
          onBack={navigateToMenu}
        />
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
            {IMPLEMENTED_DRILLS.map(d => (
              <button
                key={d.id}
                className="menu-drill-btn"
                onClick={() => navigateToDrill(d.id)}
              >
                {d.name}
              </button>
            ))}
          </div>

          {/* Divider: Coming Soon */}
          <div className="menu-divider coming-soon-divider">
            <span>Coming Soon</span>
          </div>

          <div className="menu-buttons-list disabled-list">
            {COMING_SOON_DRILLS.map(d => (
              <button key={d.id} className="menu-drill-btn btn-disabled" disabled>
                {d.name}
              </button>
            ))}
          </div>
        </main>
      )}

      {/* Settings Modal */}
      <OptionsModal
        isOpen={isOptionsOpen}
        onClose={closeOptions}
        settings={settings}
        onSaveSettings={handleSaveSettings}
      />
    </div>
  );
};

export default App;
