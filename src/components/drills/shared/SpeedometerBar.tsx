import React from 'react';
import type { HeatTierInfo } from '../../../hooks/useVelocityTracker';

interface SpeedometerBarProps {
  heat: HeatTierInfo;
  current60s: number;
  best60s: number;
  barPercent: number;
  newRecordAlert: boolean;
}

export const SpeedometerBar: React.FC<SpeedometerBarProps> = ({
  heat,
  current60s,
  best60s,
  barPercent,
  newRecordAlert,
}) => (
  <div className={`speedometer-container tier-${heat.tier}`}>
    <div className="speedometer-top-row">
      <div className="speedometer-left">
        <span className="speedometer-tier-badge">
          {heat.icon} {heat.label}
        </span>
      </div>

      <div className="speedometer-60s-stats">
        <span className="speedometer-60s-current">
          60s: <strong>{current60s}</strong>
        </span>
        <span className="speedometer-60s-best">
          (Best: {best60s})
        </span>
        {newRecordAlert && (
          <span style={{ color: '#fbbf24', fontWeight: 800, animation: 'flameGlow 0.8s infinite' }}>
            ★ NEW BEST!
          </span>
        )}
      </div>
    </div>

    <div className="speedometer-bar-wrapper">
      <div className="speedometer-bar-fill" style={{ width: `${barPercent}%` }} />
    </div>
  </div>
);
