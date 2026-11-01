import React from 'react';
import { formatClock } from '../../../utils/format';
import { WARMUP_TARGET_SECONDS } from '../../../hooks/useWarmupTimer';
import type { WorkoutStepContext } from '../../../types';
import { DrillOverflowMenu, type DrillOverflowMenuProps } from './DrillOverflowMenu';

interface WarmupHeaderRightProps {
  workoutContext?: WorkoutStepContext;
  elapsedWarmup: number;
  onSkipWarmup: () => void;
  onAdvanceWarmup: () => void;
  menuProps: DrillOverflowMenuProps;
}

export const WarmupHeaderRight: React.FC<WarmupHeaderRightProps> = ({
  workoutContext,
  elapsedWarmup,
  onSkipWarmup,
  onAdvanceWarmup,
  menuProps,
}) => {
  return (
    <div className="drill-header-right-group">
      {workoutContext &&
        (elapsedWarmup >= WARMUP_TARGET_SECONDS ? (
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
        ))}
      <DrillOverflowMenu {...menuProps} />
    </div>
  );
};
