import {REVIEW_DAY_UTC_OFFSET_MINUTES} from '../constants.js';

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * Returns when an item reviewed at `now` next falls due: the start of the
 * review-timezone calendar day `intervalDays` days later.
 *
 * Due dates are whole days so that a review done late in the evening and one
 * done early the next morning are treated as different days, as a student
 * would expect.
 */
export function getNextReviewDate(now: Date, intervalDays: number): Date {
  if (!Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new RangeError(
      `Review interval must be a whole number of days >= 1, got ${intervalDays}`,
    );
  }
  const offsetMs = REVIEW_DAY_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
  const localDayIndex = Math.floor((now.getTime() + offsetMs) / MS_PER_DAY);
  return new Date((localDayIndex + intervalDays) * MS_PER_DAY - offsetMs);
}
