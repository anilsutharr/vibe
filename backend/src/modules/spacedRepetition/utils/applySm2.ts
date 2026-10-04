import {
  MAX_QUALITY,
  MIN_EASE_FACTOR,
  MIN_QUALITY,
  PASSING_QUALITY,
} from '../constants.js';

export interface Sm2State {
  /** `n`: correct reviews in a row. */
  repetitions: number;
  /** `EF`: easiness factor. */
  easeFactor: number;
  /** `I`: days until the next review. */
  intervalDays: number;
}

/**
 * Applies one SM-2 review to an item's state, as specified in issue #1047.
 *
 * - A recalled answer (quality >= 3) grows the interval to 1 day, then 6 days,
 *   then the previous interval times the easiness factor (the factor from
 *   before this review), and adjusts the easiness factor by the SM-2 formula.
 * - A missed answer (quality < 3) restarts the item at a 1-day interval and
 *   leaves the easiness factor unchanged, as the issue's pseudocode does.
 *   (Original SM-2 also lowers it after a miss; see the open question in the
 *   implementation plan.)
 *
 * The easiness factor is kept to two decimals. Every SM-2 adjustment is a
 * multiple of 0.01, so this only removes floating-point noise.
 */
export function applySm2(state: Sm2State, quality: number): Sm2State {
  if (
    !Number.isInteger(quality) ||
    quality < MIN_QUALITY ||
    quality > MAX_QUALITY
  ) {
    throw new RangeError(
      `SM-2 quality must be a whole number from ${MIN_QUALITY} to ${MAX_QUALITY}, got ${quality}`,
    );
  }

  if (quality < PASSING_QUALITY) {
    return {repetitions: 0, easeFactor: state.easeFactor, intervalDays: 1};
  }

  let intervalDays: number;
  if (state.repetitions === 0) {
    intervalDays = 1;
  } else if (state.repetitions === 1) {
    intervalDays = 6;
  } else {
    // Guard against a stored interval of 0 so an item can never become due
    // again on the same day it was reviewed.
    intervalDays = Math.max(
      1,
      Math.round(state.intervalDays * state.easeFactor),
    );
  }

  const missBy = MAX_QUALITY - quality;
  const adjusted = state.easeFactor + (0.1 - missBy * (0.08 + missBy * 0.02));
  const easeFactor = Math.max(
    MIN_EASE_FACTOR,
    Math.round(adjusted * 100) / 100,
  );

  return {repetitions: state.repetitions + 1, easeFactor, intervalDays};
}
