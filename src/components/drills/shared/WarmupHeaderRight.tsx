import React from 'react';
import { formatClock } from '../../../utils/format';
import { WARMUP_TARGET_SECONDS } from '../../../hooks/useWarmupTimer';
import type { WorkoutStepContext } from '../../../types';

interface WarmupHeaderRightProps {
  streak: number;
  bestStreak: number;
  workoutContext?: WorkoutStepContext;
  elapsedWarmup: number;
  onSkipWarmup: () => void;
  onAdvanceWarmup: () => void;
}

export const WarmupHeaderRight: React.FC<WarmupHeaderRightProps> = ({
  streak,
  bestStreak,
  workoutContext,
  elapsedWarmup,
  onSkipWarmup,
  onAdvanceWarmup,
}) => {
  const streakBadge = (
    <div
      className="streak-badge-compact"
      title={`Current streak: ${streak} | Best: ${bestStreak}`}
    >
      🔥 <strong>{streak}</strong> <small>({bestStreak})</small>
    </div>
  );

  if (!workoutContext) {
    return streakBadge;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {streakBadge}
      {elapsedWarmup >= WARMUP_TARGET_SECONDS ? (
        <button
          type="button"
          className="btn-workout-next"
          onClick={onAdvanceWarmup}
          title="Warm-up complete! Click to continue"
        >
          {workoutContext.isLastStep
            ? 'Finish Round 🏆 ➔'
            : `Next: ${workoutContext.nextCipherTitle || 'Next'} ➔`}
        </button>
      ) : (
        <span
          className="workout-warmup-timer"
          onDoubleClick={onSkipWarmup}
          title="Warm-up target: 2:00 (double-click to complete in testing)"
        >
          ⏱️ {formatClock(elapsedWarmup)} / 2:00
        </span>
      )}
    </div>
  );
};
