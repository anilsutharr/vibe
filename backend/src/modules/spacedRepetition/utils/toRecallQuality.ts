/** How sure the student was when they submitted a review answer. */
export type ReviewConfidence = 'SURE' | 'UNSURE';

/** The grader's verdict on one answer. */
export type GradedStatus = 'CORRECT' | 'INCORRECT' | 'PARTIAL';

/**
 * Turns a graded review answer into an SM-2 recall quality (0-5), using the
 * issue's "Got it / Unsure / Missed it" mapping of 5 / 3 / 1:
 *
 * - correct and sure ("Got it") -> 5
 * - correct but unsure          -> 3
 * - partly correct              -> 2 (a miss, but the answer was familiar)
 * - incorrect ("Missed it")     -> 1
 *
 * Confidence only matters for a correct answer: being sure of a wrong answer
 * is still a miss.
 */
export function toRecallQuality(
  status: GradedStatus,
  confidence: ReviewConfidence,
): number {
  switch (status) {
    case 'CORRECT':
      return confidence === 'SURE' ? 5 : 3;
    case 'PARTIAL':
      return 2;
    case 'INCORRECT':
      return 1;
    default:
      throw new RangeError(`Unknown graded status: ${status}`);
  }
}
