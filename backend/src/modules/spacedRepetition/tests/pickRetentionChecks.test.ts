import {describe, expect, it} from 'vitest';
import {pickRetentionChecks} from '../utils/pickRetentionChecks.js';

/** A fixed sequence of "random" numbers, so the choice is predictable. */
const sequence =
  (...values: number[]) =>
  () =>
    values.shift() ?? 0;

describe('pickRetentionChecks', () => {
  it('picks the requested number of questions', () => {
    expect(
      pickRetentionChecks(['a', 'b', 'c', 'd'], new Set(), 2),
    ).toHaveLength(2);
  });

  it('chooses at random from the candidates', () => {
    // First pick: index 0 + floor(0.99 * 4) = 3 -> 'd'.
    // Second pick: index 1 + floor(0 * 3) = 1 -> 'b'.
    expect(
      pickRetentionChecks(
        ['a', 'b', 'c', 'd'],
        new Set(),
        2,
        sequence(0.99, 0),
      ),
    ).toEqual(['d', 'b']);
  });

  it('never picks a question the student is already reviewing', () => {
    const picked = pickRetentionChecks(['a', 'b', 'c'], new Set(['a', 'c']), 2);
    expect(picked).toEqual(['b']);
  });

  it('returns every candidate when there are fewer than requested', () => {
    expect(
      pickRetentionChecks(['a'], new Set(), 2, sequence(0.5)).sort(),
    ).toEqual(['a']);
    expect(pickRetentionChecks([], new Set(), 2)).toEqual([]);
  });

  it('ignores duplicate ids', () => {
    expect(pickRetentionChecks(['a', 'a', 'a'], new Set(), 2)).toEqual(['a']);
  });

  it('picks nothing when asked for zero', () => {
    expect(pickRetentionChecks(['a', 'b'], new Set(), 0)).toEqual([]);
  });
});
