import {isPendingReview} from '#quizzes/utils/functions/isPendingReview.js';
import {IQuestion} from '#shared/interfaces/quiz.js';

/** Question types that can be graded automatically and shown on their own. */
const REVIEWABLE_TYPES = new Set<string>([
  'SELECT_ONE_IN_LOT',
  'SELECT_MANY_IN_LOT',
  'ORDER_THE_LOTS',
  'NUMERIC_ANSWER_TYPE',
]);

/**
 * Whether a question can be used in spaced repetition reviews.
 *
 * The first version leaves out descriptive answers (not auto-graded),
 * parameterised questions (their values are generated per quiz attempt),
 * student-generated crowd questions, and questions still awaiting review.
 */
export function isReviewableQuestion(
  question:
    | Pick<IQuestion, 'type' | 'isParameterized' | 'source' | 'reviewStatus'>
    | null
    | undefined,
): boolean {
  if (!question) {
    return false;
  }
  return (
    REVIEWABLE_TYPES.has(question.type) &&
    !question.isParameterized &&
    question.source !== 'STUDENT_GENERATED' &&
    !isPendingReview(question)
  );
}
