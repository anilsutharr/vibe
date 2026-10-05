/** Spaced repetition reviews (#1047). Mirrors the backend /reviews responses. */

export type ReviewQuestionType =
  | 'SELECT_ONE_IN_LOT'
  | 'SELECT_MANY_IN_LOT'
  | 'ORDER_THE_LOTS'
  | 'NUMERIC_ANSWER_TYPE';

export type ReviewConfidence = 'SURE' | 'UNSURE';

export type ReviewGradeStatus = 'CORRECT' | 'INCORRECT' | 'PARTIAL';

/** One answer option, as a quiz shows it (no correctness, no explanation). */
export interface ReviewOption {
  _id: string;
  text: string;
}

/** A question rendered for a review, without its answer. */
export interface ReviewQuestion {
  _id: string;
  type: ReviewQuestionType;
  text: string;
  hint?: string;
  lotItems?: ReviewOption[];
  decimalPrecision?: number;
}

/** The video to rewatch for a review. Names are missing if they could not be read. */
export interface RelatedVideo {
  moduleId: string;
  sectionId: string;
  itemId: string;
  videoName?: string;
  moduleName?: string;
  sectionName?: string;
}

export interface DueReview {
  reviewItemId: string;
  courseId: string;
  courseVersionId: string;
  courseName?: string;
  question: ReviewQuestion;
  relatedVideo?: RelatedVideo;
  /** Missed in a quiz, or answered correctly and brought back to check it stuck. */
  source: 'QUIZ_MISS' | 'RETENTION_CHECK';
  repetitions: number;
  dueAt: string;
}

/** The answer payload, in the same shape as a quiz answer for each type. */
export type ReviewAnswer =
  | {lotItemId: string}
  | {lotItemIds: string[]}
  | {orders: {order: number; lotItemId: string}[]}
  | {value: number};

export interface AnswerReviewInput {
  questionType: ReviewQuestionType;
  answer: ReviewAnswer;
  confidence: ReviewConfidence;
}

export interface ReviewAnswerResult {
  status: ReviewGradeStatus;
  quality: number;
  correctAnswer: {answers: string[]; explanations: string[]};
  intervalDays: number;
  nextReviewAt: string;
  relatedVideo?: RelatedVideo;
}

export interface CourseReviewSummary {
  courseId: string;
  courseVersionId: string;
  courseName?: string;
  due: number;
  learning: number;
  mastered: number;
  nextDueAt: string | null;
}

export interface ReviewSummary {
  totalDue: number;
  courses: CourseReviewSummary[];
  upcoming: {date: string; count: number}[];
}
