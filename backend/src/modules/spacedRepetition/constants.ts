/** SM-2 starting easiness factor for a new review item. */
export const INITIAL_EASE_FACTOR = 2.5;

/** SM-2 never lets the easiness factor drop below this. */
export const MIN_EASE_FACTOR = 1.3;

/** Recall quality is a whole number from 0 (blackout) to 5 (perfect). */
export const MIN_QUALITY = 0;
export const MAX_QUALITY = 5;

/** Answers with at least this quality count as recalled. */
export const PASSING_QUALITY = 3;

/**
 * Reviews fall due at the start of a calendar day in India Standard Time,
 * matching the timezone the existing cron jobs run in. IST is UTC+05:30 all
 * year (no daylight saving), so a fixed offset is exact.
 */
export const REVIEW_DAY_UTC_OFFSET_MINUTES = 330;
