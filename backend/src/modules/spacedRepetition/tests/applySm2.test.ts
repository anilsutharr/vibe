import {describe, expect, it} from 'vitest';
import {applySm2, Sm2State} from '../utils/applySm2.js';
import {INITIAL_EASE_FACTOR, MIN_EASE_FACTOR} from '../constants.js';

const NEW_ITEM: Sm2State = {
  repetitions: 0,
  easeFactor: INITIAL_EASE_FACTOR,
  intervalDays: 0,
};

/** Runs a sequence of review qualities and records the state after each. */
function runReviews(qualities: number[], start: Sm2State = NEW_ITEM) {
  const states: Sm2State[] = [];
  let state = start;
  for (const quality of qualities) {
    state = applySm2(state, quality);
    states.push(state);
  }
  return states;
}

describe('applySm2', () => {
  // Expected values follow the formula in issue #1047, worked by hand from
  // EF = 2.5. "Got it" / "Unsure" / "Missed it" map to quality 5 / 3 / 1.
  it.each([
    {
      name: 'always "Got it" (q=5)',
      qualities: [5, 5, 5, 5, 5],
      intervals: [1, 6, 16, 45, 131],
      easeFactors: [2.6, 2.7, 2.8, 2.9, 3.0],
    },
    {
      name: 'always "Unsure" (q=3)',
      qualities: [3, 3, 3, 3, 3],
      intervals: [1, 6, 13, 27, 52],
      easeFactors: [2.36, 2.22, 2.08, 1.94, 1.8],
    },
    {
      name: 'quality 4 keeps the easiness factor',
      qualities: [4, 4, 4],
      intervals: [1, 6, 15],
      easeFactors: [2.5, 2.5, 2.5],
    },
  ])(
    'follows the SM-2 schedule: $name',
    ({qualities, intervals, easeFactors}) => {
      const states = runReviews(qualities);
      expect(states.map(s => s.intervalDays)).toEqual(intervals);
      expect(states.map(s => s.easeFactor)).toEqual(easeFactors);
      expect(states.map(s => s.repetitions)).toEqual(
        qualities.map((_, i) => i + 1),
      );
    },
  );

  it('restarts a missed item at 1 day without changing the easiness factor', () => {
    const states = runReviews([5, 5, 5, 1, 5, 5]);
    expect(states.map(s => s.intervalDays)).toEqual([1, 6, 16, 1, 1, 6]);
    expect(states.map(s => s.repetitions)).toEqual([1, 2, 3, 0, 1, 2]);
    // The miss (4th review) leaves EF at 2.8; the next two reviews raise it.
    expect(states.map(s => s.easeFactor)).toEqual([
      2.6, 2.7, 2.8, 2.8, 2.9, 3.0,
    ]);
  });

  it.each([0, 1, 2])('treats quality %i as a miss', quality => {
    const learned: Sm2State = {
      repetitions: 4,
      easeFactor: 2.7,
      intervalDays: 40,
    };
    expect(applySm2(learned, quality)).toEqual({
      repetitions: 0,
      easeFactor: 2.7,
      intervalDays: 1,
    });
  });

  it('never lets the easiness factor drop below 1.3', () => {
    const states = runReviews(Array(12).fill(3));
    // Each "Unsure" lowers EF by 0.14: it reaches the floor on the 9th review.
    expect(states[7].easeFactor).toBe(1.38);
    expect(states[8].easeFactor).toBe(MIN_EASE_FACTOR);
    expect(states.slice(8).every(s => s.easeFactor === MIN_EASE_FACTOR)).toBe(
      true,
    );
    // Intervals keep growing at the floor rate.
    expect(states[9].intervalDays).toBe(
      Math.round(states[8].intervalDays * MIN_EASE_FACTOR),
    );
  });

  it('uses the easiness factor from before the review to grow the interval', () => {
    const state: Sm2State = {repetitions: 2, easeFactor: 2.0, intervalDays: 10};
    // round(10 * 2.0) = 20, even though q=5 then raises EF to 2.1.
    expect(applySm2(state, 5)).toEqual({
      repetitions: 3,
      easeFactor: 2.1,
      intervalDays: 20,
    });
  });

  it('never schedules a learned item for the same day', () => {
    const corrupt: Sm2State = {
      repetitions: 3,
      easeFactor: 2.5,
      intervalDays: 0,
    };
    expect(applySm2(corrupt, 5).intervalDays).toBe(1);
  });

  it('does not mutate the state it is given', () => {
    const state: Sm2State = {repetitions: 1, easeFactor: 2.5, intervalDays: 1};
    const copy = {...state};
    applySm2(state, 5);
    expect(state).toEqual(copy);
  });

  it.each([-1, 6, 2.5, Number.NaN])('rejects quality %s', quality => {
    expect(() => applySm2(NEW_ITEM, quality)).toThrow(RangeError);
  });
});
