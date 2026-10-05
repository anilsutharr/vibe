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

/** The same timezone by name, for date grouping in MongoDB. */
export const REVIEW_TIMEZONE = 'Asia/Kolkata';

/**
 * An item reviewed at an interval of this many days or more counts as
 * mastered (Anki's threshold for a "mature" card).
 */
export const MASTERED_INTERVAL_DAYS = 21;

/** How many days ahead the upcoming-review counts cover. */
export const UPCOMING_REVIEW_DAYS = 14;

/**
 * After a student passes a quiz, this many of the questions they answered
 * correctly come back as retention checks, so students who got everything
 * right still have their memory checked.
 */
export const RETENTION_CHECKS_PER_QUIZ = 2;

/** Days until a retention check is due. */
export const RETENTION_CHECK_DAYS = 7;

/**
 * SM-2 state a retention check starts with: the quiz counts as two correct
 * recalls in a row, so a correct check moves on to round(7 × EF) days rather
 * than dropping back to SM-2's opening 1-day and 6-day steps.
 */
export const RETENTION_CHECK_REPETITIONS = 2;
