import 'reflect-metadata';
import {injectable, inject} from 'inversify';
import {appConfig} from '#root/config/app.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {COURSES_TYPES} from '#courses/types.js';
import {QUIZZES_TYPES} from '#quizzes/types.js';
import {USERS_TYPES} from '#users/types.js';
import type {ICourseRepository} from '#shared/database/interfaces/ICourseRepository.js';
import type {IItemRepository} from '#shared/database/interfaces/IItemRepository.js';
import type {QuestionRepository} from '#quizzes/repositories/providers/mongodb/QuestionRepository.js';
import type {ProgressService} from '#users/services/ProgressService.js';
import type {ReviewItemRepository} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {IReviewItemVideoRef} from '#shared/interfaces/models.js';
import {SPACED_REPETITION_TYPES} from '../types.js';
import {
  INITIAL_EASE_FACTOR,
  RETENTION_CHECK_DAYS,
  RETENTION_CHECK_REPETITIONS,
  RETENTION_CHECKS_PER_QUIZ,
} from '../constants.js';
import {pickRetentionChecks} from '../utils/pickRetentionChecks.js';
import {getNextReviewDate} from '../utils/getNextReviewDate.js';
import {isReviewableQuestion} from '../utils/isReviewableQuestion.js';

/** One graded question from a quiz submission. */
export interface GradedQuestion {
  questionId: {toString(): string};
  status: 'CORRECT' | 'INCORRECT' | 'PARTIAL';
}

export interface QuizGradingInput {
  userId: string;
  courseId: string;
  courseVersionId: string;
  cohortId?: string;
  quizId: string;
  feedback: GradedQuestion[];
  /** Whether the attempt passed the quiz; enables retention checks. */
  passed?: boolean;
}

/**
 * Turns quiz results into spaced repetition review items: questions answered
 * wrongly are due the next day, and after a passed quiz a couple of correctly
 * answered questions come back a week later as retention checks.
 */
@injectable()
export class ReviewSeedingService {
  constructor(
    @inject(SPACED_REPETITION_TYPES.ReviewItemRepo)
    private readonly reviewItemRepo: ReviewItemRepository,

    @inject(QUIZZES_TYPES.QuestionRepo)
    private readonly questionRepo: QuestionRepository,

    @inject(COURSES_TYPES.ItemRepo)
    private readonly itemRepo: IItemRepository,

    @inject(GLOBAL_TYPES.CourseRepo)
    private readonly courseRepo: ICourseRepository,

    @inject(USERS_TYPES.ProgressService)
    private readonly progressService: ProgressService,
  ) {}

  /**
   * Schedules every reviewable question graded INCORRECT or PARTIAL for the
   * next day. If the attempt passed, also schedules up to
   * RETENTION_CHECKS_PER_QUIZ correctly answered questions the student is not
   * already reviewing, a week later.
   *
   * Called after a quiz submission is saved. It never throws: reviews are an
   * extra, and a problem here must not affect the student's quiz result.
   * Returns how many review items were created or restarted.
   */
  async seedFromQuizGrading(
    input: QuizGradingInput,
    now: Date = new Date(),
    random: () => number = Math.random,
  ): Promise<number> {
    if (!appConfig.ENABLE_SPACED_REPETITION) {
      return 0;
    }
    try {
      const idsWith = (statuses: GradedQuestion['status'][]) => [
        ...new Set(
          input.feedback
            .filter(f => statuses.includes(f.status))
            .map(f => f.questionId.toString()),
        ),
      ];
      const missedIds = idsWith(['INCORRECT', 'PARTIAL']);
      const correctIds = input.passed ? idsWith(['CORRECT']) : [];
      if (missedIds.length === 0 && correctIds.length === 0) {
        return 0;
      }

      const questions = await this.questionRepo.getByIds([
        ...missedIds,
        ...correctIds,
      ]);
      const reviewable = new Set(
        questions
          .filter(q => isReviewableQuestion(q))
          .map(q => q._id!.toString()),
      );
      const reviewableMisses = missedIds.filter(id => reviewable.has(id));
      const reviewableCorrect = correctIds.filter(id => reviewable.has(id));
      if (reviewableMisses.length === 0 && reviewableCorrect.length === 0) {
        return 0;
      }

      const relatedVideo = await this.findRelatedVideo(input.quizId);
      const target = (questionId: string) => ({
        userId: input.userId,
        courseId: input.courseId,
        courseVersionId: input.courseVersionId,
        cohortId: input.cohortId,
        questionId,
        quizId: input.quizId,
        relatedVideo,
      });

      const missDueAt = getNextReviewDate(now, 1);
      for (const questionId of reviewableMisses) {
        await this.reviewItemRepo.upsertQuizMiss(
          target(questionId),
          missDueAt,
          INITIAL_EASE_FACTOR,
          now,
        );
      }

      let created = reviewableMisses.length;
      if (reviewableCorrect.length > 0) {
        const alreadyReviewing =
          await this.reviewItemRepo.findReviewedQuestionIds(
            input.userId,
            input.courseVersionId,
            reviewableCorrect,
          );
        const checks = pickRetentionChecks(
          reviewableCorrect,
          alreadyReviewing,
          RETENTION_CHECKS_PER_QUIZ,
          random,
        );
        const checkDueAt = getNextReviewDate(now, RETENTION_CHECK_DAYS);
        for (const questionId of checks) {
          const inserted = await this.reviewItemRepo.insertRetentionCheck(
            target(questionId),
            {
              repetitions: RETENTION_CHECK_REPETITIONS,
              easeFactor: INITIAL_EASE_FACTOR,
              intervalDays: RETENTION_CHECK_DAYS,
            },
            checkDueAt,
            now,
          );
          if (inserted) {
            created++;
          }
        }
      }
      return created;
    } catch (error) {
      console.error(
        `[spacedRepetition] Failed to schedule reviews for quiz ${input.quizId}, user ${input.userId}:`,
        error,
      );
      return 0;
    }
  }

  /**
   * The video a student should rewatch for this quiz: the nearest video
   * before the quiz in course order. Undefined if there is none or it cannot
   * be resolved; the review still works without it.
   */
  private async findRelatedVideo(
    quizId: string,
  ): Promise<IReviewItemVideoRef | undefined> {
    try {
      const itemsGroup = await this.itemRepo.findItemsGroupByItemId(quizId);
      if (!itemsGroup?._id) {
        return undefined;
      }
      const groupId = itemsGroup._id.toString();
      const courseVersion =
        await this.courseRepo.findVersionByItemGroupId(groupId);
      if (!courseVersion) {
        return undefined;
      }
      for (const mod of courseVersion.modules) {
        const section = mod.sections.find(
          s => s.itemsGroupId?.toString() === groupId,
        );
        if (section) {
          const video = await this.progressService.getPreviousVideoItem(
            courseVersion,
            mod.moduleId!.toString(),
            section.sectionId!.toString(),
            quizId,
          );
          return video ?? undefined;
        }
      }
      return undefined;
    } catch (error) {
      console.warn(
        `[spacedRepetition] Could not find the video before quiz ${quizId}:`,
        error,
      );
      return undefined;
    }
  }
}
