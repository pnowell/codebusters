import { useState, useRef, useCallback, useMemo } from 'react';
import { letterToOffset } from '../utils/ciphers';
import {
  loadDrillProgress,
  saveDrillProgress,
  resetDrillProgress,
} from '../services/storage';
import type { DrillId, DrillProgress } from '../types';

const ALL_LETTERS: readonly string[] = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function shuffle<T>(arr: readonly T[] | T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Weighted offset from the back of the deck for already-mastered letters:
 * - 50% chance: 0 (the absolute back of the deck)
 * - 25% chance: 1 (1 card from the back)
 * - 15% chance: 2 (2 cards from the back)
 * - 10% chance: 3 (3 cards from the back)
 * Favors 0 strongly to prevent any card from getting stranded, while providing gentle shuffling.
 */
function getMasteredInsertIndex(deckLength: number): number {
  const rand = Math.random();
  let offsetFromBack = 0;
  if (rand < 0.5) {
    offsetFromBack = 0;
  } else if (rand < 0.75) {
    offsetFromBack = 1;
  } else if (rand < 0.9) {
    offsetFromBack = 2;
  } else {
    offsetFromBack = 3;
  }
  return Math.max(0, deckLength - offsetFromBack);
}

function initDeck(progress: DrillProgress): string[] {
  const learningOrMissed: string[] = [];
  const unseen: string[] = [];
  const mastered: string[] = [];

  for (const letter of ALL_LETTERS) {
    const p = progress ? progress[letter] : undefined;
    if (!p || typeof p !== 'object' || p.attempts === 0) {
      unseen.push(letter);
    } else if ((p.streak || 0) >= 3) {
      mastered.push(letter);
    } else {
      learningOrMissed.push(letter);
    }
  }

  // Fresh start or reset (all 26 unseen): fully shuffle all 26 letters
  if (unseen.length === 26) {
    return shuffle(ALL_LETTERS);
  }

  // Resumed progress: learning items come first, then unseen, then mastered
  return [
    ...shuffle(learningOrMissed),
    ...shuffle(unseen),
    ...shuffle(mastered),
  ];
}

export function useSpacedDeck(drillId: DrillId) {
  const [initialState] = useState(() => {
    const initialProgress = loadDrillProgress(drillId);
    const initialDeck = initDeck(initialProgress);
    const initialLetter = initialDeck[0] ?? 'A';
    return { initialProgress, initialDeck, initialLetter };
  });

  const deckQueueRef = useRef<string[]>(initialState.initialDeck);
  const [progress, setProgress] = useState<DrillProgress>(initialState.initialProgress);
  const [currentLetter, setCurrentLetter] = useState<string>(initialState.initialLetter);

  const advanceCard = useCallback((): string => {
    const deck = deckQueueRef.current;
    const nextLetter =
      deck.length > 0 ? deck[0] : ALL_LETTERS[Math.floor(Math.random() * 26)];
    setCurrentLetter(nextLetter);
    return nextLetter;
  }, []);

  const recordAttempt = useCallback(
    (isCorrect: boolean, advanceImmediately = isCorrect) => {
      const deck = deckQueueRef.current;
      const targetLetter = currentLetter;

      // Pop the answered letter from the front of the active deck
      if (deck[0] === targetLetter) {
        deck.shift();
      } else {
        const idx = deck.indexOf(targetLetter);
        if (idx !== -1) deck.splice(idx, 1);
      }

      const prevLetterProgress = progress[targetLetter] || {
        streak: 0,
        attempts: 0,
        correct: 0,
      };

      let updatedLetterProgress: { streak: number; attempts: number; correct: number };
      let insertIdx: number;

      if (isCorrect) {
        const wasUnseen = prevLetterProgress.attempts === 0;
        const wasMastered = prevLetterProgress.streak >= 3;

        if (wasUnseen) {
          // UNSEEN correct: immediately mark as Mastered (streak 3) and send to absolute back of deck
          updatedLetterProgress = {
            streak: 3,
            attempts: 1,
            correct: 1,
          };
          insertIdx = deck.length;
        } else if (wasMastered) {
          // Already mastered: increment streak, insert into last few slots
          updatedLetterProgress = {
            streak: prevLetterProgress.streak + 1,
            attempts: prevLetterProgress.attempts + 1,
            correct: prevLetterProgress.correct + 1,
          };
          insertIdx = getMasteredInsertIndex(deck.length);
        } else {
          // Learning (recovering from a miss)
          const nextStreak = prevLetterProgress.streak + 1;
          updatedLetterProgress = {
            streak: nextStreak,
            attempts: prevLetterProgress.attempts + 1,
            correct: prevLetterProgress.correct + 1,
          };
          insertIdx =
            nextStreak >= 3
              ? getMasteredInsertIndex(deck.length)
              : Math.min(deck.length, 4 + nextStreak * 2);
        }
      } else {
        updatedLetterProgress = {
          streak: 0,
          attempts: prevLetterProgress.attempts + 1,
          correct: prevLetterProgress.correct,
        };
        // Miss: re-insert shallowly (index 3 => 2-3 intervening questions)
        insertIdx = Math.min(deck.length, 3);
      }

      const newProgress: DrillProgress = {
        ...progress,
        [targetLetter]: updatedLetterProgress,
      };
      setProgress(newProgress);
      saveDrillProgress(drillId, newProgress);

      deck.splice(insertIdx, 0, targetLetter);

      if (advanceImmediately) {
        advanceCard();
      }
    },
    [advanceCard, currentLetter, drillId, progress]
  );

  const resetProgress = useCallback(() => {
    resetDrillProgress(drillId);
    const freshProgress: DrillProgress = {};
    setProgress(freshProgress);
    const freshDeck = initDeck(freshProgress);
    deckQueueRef.current = freshDeck;
    setCurrentLetter(freshDeck[0] ?? 'A');
  }, [drillId]);

  const masteredCount = useMemo(
    () =>
      Object.values(progress).filter(
        (p) => p && typeof p === 'object' && (p.streak || 0) >= 3
      ).length,
    [progress]
  );

  const currentOffset = letterToOffset(currentLetter);

  return {
    progress,
    masteredCount,
    currentLetter,
    currentOffset,
    recordAttempt,
    advanceCard,
    resetProgress,
  };
}
