import 'reflect-metadata';
import {injectable, inject} from 'inversify';
import {BadRequestError, NotFoundError} from 'routing-controllers';
import {QUIZZES_TYPES} from '#quizzes/types.js';
import {QuestionProcessor} from '#quizzes/question-processing/QuestionProcessor.js';
import type {QuestionRepository} from '#quizzes/repositories/providers/mongodb/QuestionRepository.js';
import type {QuizRepository} from '#quizzes/repositories/providers/mongodb/QuizRepository.js';
import type {ReviewItemRepository} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {Answer} from '#quizzes/interfaces/grading.js';
import {IReviewItemVideoRef} from '#shared/interfaces/models.js';
import {SPACED_REPETITION_TYPES} from '../types.js';
import {PASSING_QUALITY} from '../constants.js';
import {applySm2} from '../utils/applySm2.js';
import {getNextReviewDate} from '../utils/getNextReviewDate.js';
import {isReviewableQuestion} from '../utils/isReviewableQuestion.js';
import {
  ReviewConfidence,
  GradedStatus,
  toRecallQuality,
} from '../utils/toRecallQuality.js';
import {
  CorrectAnswerSummary,
  QuestionSolutionFields,
  describeCorrectAnswer,
} from '../utils/describeCorrectAnswer.js';

/** At most this many due reviews are returned at once. */
export const MAX_DUE_REVIEWS = 50;

export interface DueReview {
  reviewItemId: string;
  courseId: string;
  courseVersionId: string;
  /** The question as a quiz shows it: options shuffled, no answers. */
  question: unknown;
  relatedVideo?: IReviewItemVideoRef;
  /** Correct reviews in a row so far. */
  repetitions: number;
  dueAt: Date;
}

export interface ReviewAnswerInput {
  questionType: string;
  answer: Answer;
  confidence: ReviewConfidence;
}

export interface ReviewAnswerResult {
  status: GradedStatus;
  quality: number;
  correctAnswer: CorrectAnswerSummary;
  intervalDays: number;
  nextReviewAt: Date;
  relatedVideo?: IReviewItemVideoRef;
}

/**
 * A student's spaced repetition reviews: what is due, and recording answers.
 *
 * Reviews are practice only. Answers are graded with the same graders as the
 * original quiz, but no quiz attempt is created, so quiz scores, course
 * progress and HP are never affected.
 */
@injectable()
export class ReviewService {
  constructor(
    @inject(SPACED_REPETITION_TYPES.ReviewItemRepo)
    private readonly reviewItemRepo: ReviewItemRepository,

    @inject(QUIZZES_TYPES.QuestionRepo)
    private readonly questionRepo: QuestionRepository,

    @inject(QUIZZES_TYPES.QuizRepo)
    private readonly quizRepo: QuizRepository,
  ) {}

  /**
   * The student's due reviews, oldest first. Items whose question has since
   * been deleted or become unsuitable are skipped.
   */
  async getDueReviews(
    userId: string,
    options: {courseVersionId?: string; limit?: number} = {},
    now: Date = new Date(),
  ): Promise<DueReview[]> {
    const limit = Math.min(options.limit ?? 20, MAX_DUE_REVIEWS);
    const items = await this.reviewItemRepo.findDueForUser(userId, now, {
      courseVersionId: options.courseVersionId,
      limit,
    });

    const due: DueReview[] = [];
    for (const item of items) {
      // Loaded without explanations: those would give the answer away.
      const question = await this.questionRepo.getByIdWithoutExplanation(
        item.questionId.toString(),
      );
      if (!isReviewableQuestion(question)) {
        continue;
      }
      due.push({
        reviewItemId: item._id!.toString(),
        courseId: item.courseId.toString(),
        courseVersionId: item.courseVersionId.toString(),
        question: new QuestionProcessor(question!).render(),
        relatedVideo: item.relatedVideo,
        repetitions: item.repetitions,
        dueAt: item.nextReviewAt,
      });
    }
    return due;
  }

  /**
   * Grades a review answer, reschedules the item with SM-2 and returns the
   * result together with the correct answer.
   */
  async answerReview(
    userId: string,
    reviewItemId: string,
    input: ReviewAnswerInput,
    now: Date = new Date(),
  ): Promise<ReviewAnswerResult> {
    const item = await this.reviewItemRepo.findOwnedById(reviewItemId, userId);
    if (!item || item.status !== 'ACTIVE') {
      throw new NotFoundError('Review not found');
    }
    if (item.nextReviewAt.getTime() > now.getTime()) {
      throw new BadRequestError('This review is not due yet');
    }

    const question = await this.questionRepo.getById(
      item.questionId.toString(),
    );
    if (!question || !isReviewableQuestion(question)) {
      throw new NotFoundError('This review question is no longer available');
    }
    if (input.questionType !== question.type) {
      throw new BadRequestError(
        `Answer is for a ${input.questionType} question, but this question is ${question.type}`,
      );
    }
    const quiz = await this.quizRepo.getById(item.quizId.toString());
    if (!quiz) {
      throw new NotFoundError('This review question is no longer available');
    }

    const status = await this.grade(question, input.answer, quiz);
    const quality = toRecallQuality(status, input.confidence);
    const next = applySm2(
      {
        repetitions: item.repetitions,
        easeFactor: item.easeFactor,
        intervalDays: item.intervalDays,
      },
      quality,
    );
    const nextReviewAt = getNextReviewDate(now, next.intervalDays);

    const saved = await this.reviewItemRepo.recordReview(reviewItemId, userId, {
      ...next,
      nextReviewAt,
      quality,
      reviewedAt: now,
      isLapse: quality < PASSING_QUALITY,
    });
    if (!saved) {
      throw new NotFoundError('Review not found');
    }

    return {
      status,
      quality,
      correctAnswer: describeCorrectAnswer(
        question as unknown as QuestionSolutionFields,
      ),
      intervalDays: next.intervalDays,
      nextReviewAt,
      relatedVideo: item.relatedVideo,
    };
  }

  private async grade(
    question: NonNullable<Awaited<ReturnType<QuestionRepository['getById']>>>,
    answer: Answer,
    quiz: NonNullable<Awaited<ReturnType<QuizRepository['getById']>>>,
  ): Promise<GradedStatus> {
    try {
      const feedback = await new QuestionProcessor(question).grade(
        answer,
        quiz,
      );
      return feedback.status;
    } catch (error) {
      // Graders read fields straight off the answer, so an answer of the
      // wrong shape throws a TypeError rather than grading as wrong.
      if (error instanceof TypeError) {
        throw new BadRequestError('The answer is not valid for this question');
      }
      throw error;
    }
  }
}
