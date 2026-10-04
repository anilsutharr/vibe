import {describe, expect, it} from 'vitest';
import {getNextReviewDate} from '../utils/getNextReviewDate.js';

// Review days start at 00:00 IST, which is 18:30 UTC on the previous date.
describe('getNextReviewDate', () => {
  it('returns the start of the next IST day for a 1-day interval', () => {
    // 10:00 IST on 5 Oct -> due from 00:00 IST on 6 Oct.
    expect(
      getNextReviewDate(new Date('2026-10-05T04:30:00Z'), 1).toISOString(),
    ).toBe('2026-10-05T18:30:00.000Z');
  });

  it('counts a review at 23:59 IST as that day, not the next', () => {
    // 23:59 IST on 4 Oct -> due from 00:00 IST on 5 Oct.
    expect(
      getNextReviewDate(new Date('2026-10-04T18:29:00Z'), 1).toISOString(),
    ).toBe('2026-10-04T18:30:00.000Z');
  });

  it('counts a review at 00:00 IST as the new day', () => {
    // 00:00 IST on 5 Oct -> due from 00:00 IST on 6 Oct.
    expect(
      getNextReviewDate(new Date('2026-10-04T18:30:00Z'), 1).toISOString(),
    ).toBe('2026-10-05T18:30:00.000Z');
  });

  it('adds multi-day intervals across a month boundary', () => {
    // 10:00 IST on 20 Oct + 16 days -> 00:00 IST on 5 Nov.
    expect(
      getNextReviewDate(new Date('2026-10-20T04:30:00Z'), 16).toISOString(),
    ).toBe('2026-11-04T18:30:00.000Z');
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects interval %s', interval => {
    expect(() => getNextReviewDate(new Date(), interval)).toThrow(RangeError);
  });
});
