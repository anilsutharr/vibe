import 'reflect-metadata';
import {injectable, inject} from 'inversify';
import {BadRequestError, NotFoundError} from 'routing-controllers';
import {QUIZZES_TYPES} from '#quizzes/types.js';
import {QuestionProcessor} from '#quizzes/question-processing/QuestionProcessor.js';
import type {QuestionRepository} from '#quizzes/repositories/providers/mongodb/QuestionRepository.js';
import type {QuizRepository} from '#quizzes/repositories/providers/mongodb/QuizRepository.js';
import type {
  CourseReviewCounts,
  ReviewItemRepository,
} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {COURSES_TYPES} from '#courses/types.js';
import type {ICourseRepository} from '#shared/database/interfaces/ICourseRepository.js';
import type {IItemRepository} from '#shared/database/interfaces/IItemRepository.js';
import {Answer} from '#quizzes/interfaces/grading.js';
import {
  ICourseVersion,
  IReviewItemVideoRef,
} from '#shared/interfaces/models.js';
import {SPACED_REPETITION_TYPES} from '../types.js';
import {
  MASTERED_INTERVAL_DAYS,
  PASSING_QUALITY,
  REVIEW_TIMEZONE,
  UPCOMING_REVIEW_DAYS,
} from '../constants.js';
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

/** The video to rewatch for a review, with names to show the student. */
export interface RelatedVideo extends IReviewItemVideoRef {
  videoName?: string;
  moduleName?: string;
  sectionName?: string;
}

export interface DueReview {
  reviewItemId: string;
  courseId: string;
  courseVersionId: string;
  courseName?: string;
  /** The question as a quiz shows it: options shuffled, no answers. */
  question: unknown;
  relatedVideo?: RelatedVideo;
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
  relatedVideo?: RelatedVideo;
}

export interface CourseReviewSummary extends CourseReviewCounts {
  courseName?: string;
}

export interface ReviewSummary {
  /** Reviews due now across all courses. */
  totalDue: number;
  courses: CourseReviewSummary[];
  /** Reviews falling due on each of the next days (IST), from tomorrow. */
  upcoming: {date: string; count: number}[];
}

/**
 * Looks up course and video names for one request, reading each course,
 * version and item at most once.
 */
class NameLookup {
  private courses = new Map<string, Promise<string | undefined>>();
  private versions = new Map<string, Promise<ICourseVersion | null>>();
  private items = new Map<string, Promise<string | undefined>>();

  constructor(
    private readonly courseRepo: ICourseRepository,
    private readonly itemRepo: IItemRepository,
  ) {}

  courseName(courseId: string): Promise<string | undefined> {
    if (!this.courses.has(courseId)) {
      this.courses.set(
        courseId,
        this.courseRepo
          .read(courseId)
          .then(course => course?.name)
          .catch(() => undefined),
      );
    }
    return this.courses.get(courseId)!;
  }

  async relatedVideo(
    courseVersionId: string,
    ref: IReviewItemVideoRef | undefined,
  ): Promise<RelatedVideo | undefined> {
    if (!ref) {
      return undefined;
    }
    if (!this.versions.has(courseVersionId)) {
      this.versions.set(
        courseVersionId,
        this.courseRepo.readVersion(courseVersionId).catch(() => null),
      );
    }
    const version = await this.versions.get(courseVersionId)!;
    const module = version?.modules.find(
      m => m.moduleId?.toString() === ref.moduleId,
    );
    const section = module?.sections.find(
      s => s.sectionId?.toString() === ref.sectionId,
    );
    const itemKey = `${courseVersionId}:${ref.itemId}`;
    if (!this.items.has(itemKey)) {
      this.items.set(
        itemKey,
        this.itemRepo
          .readItem(courseVersionId, ref.itemId)
          .then(item => item?.name)
          .catch(() => undefined),
      );
    }
    return {
      ...ref,
      videoName: await this.items.get(itemKey)!,
      moduleName: module?.name,
      sectionName: section?.name,
    };
  }
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

    @inject(GLOBAL_TYPES.CourseRepo)
    private readonly courseRepo: ICourseRepository,

    @inject(COURSES_TYPES.ItemRepo)
    private readonly itemRepo: IItemRepository,
  ) {}

  /**
   * Counts for the student's dashboard and Reviews page: what is due now,
   * learning and mastered items per course, and what falls due on each of the
   * next days.
   */
  async getSummary(
    userId: string,
    now: Date = new Date(),
  ): Promise<ReviewSummary> {
    const names = new NameLookup(this.courseRepo, this.itemRepo);
    const counts = await this.reviewItemRepo.countByCourseForUser(
      userId,
      now,
      MASTERED_INTERVAL_DAYS,
    );
    const courses = await Promise.all(
      counts.map(async c => ({
        ...c,
        courseName: await names.courseName(c.courseId),
      })),
    );
    const upcoming = await this.reviewItemRepo.countDueByDay(
      userId,
      getNextReviewDate(now, 1),
      getNextReviewDate(now, UPCOMING_REVIEW_DAYS + 1),
      REVIEW_TIMEZONE,
    );
    return {
      totalDue: courses.reduce((sum, c) => sum + c.due, 0),
      courses,
      upcoming,
    };
  }

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

    const names = new NameLookup(this.courseRepo, this.itemRepo);
    const due: DueReview[] = [];
    for (const item of items) {
      // Loaded without explanations: those would give the answer away.
      const question = await this.questionRepo.getByIdWithoutExplanation(
        item.questionId.toString(),
      );
      if (!isReviewableQuestion(question)) {
        continue;
      }
      const courseVersionId = item.courseVersionId.toString();
      due.push({
        reviewItemId: item._id!.toString(),
        courseId: item.courseId.toString(),
        courseVersionId,
        courseName: await names.courseName(item.courseId.toString()),
        // Round-trip through JSON so every ObjectId (question and option ids)
        // becomes a hex string. Left as ObjectIds, the controller's response
        // transform serialises them as {buffer: ...} objects, and the client
        // then submits an option id the grader can never match.
        question: JSON.parse(
          JSON.stringify(new QuestionProcessor(question!).render()),
        ),
        relatedVideo: await names.relatedVideo(
          courseVersionId,
          item.relatedVideo,
        ),
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
      relatedVideo: await new NameLookup(
        this.courseRepo,
        this.itemRepo,
      ).relatedVideo(item.courseVersionId.toString(), item.relatedVideo),
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
