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
import {INITIAL_EASE_FACTOR} from '../constants.js';
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
}

/**
 * Turns questions a student got wrong in a quiz into spaced repetition review
 * items, due the next day.
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
   * Schedules every reviewable question graded INCORRECT or PARTIAL.
   *
   * Called after a quiz submission is saved. It never throws: reviews are an
   * extra, and a problem here must not affect the student's quiz result.
   * Returns how many questions were scheduled.
   */
  async seedFromQuizGrading(
    input: QuizGradingInput,
    now: Date = new Date(),
  ): Promise<number> {
    if (!appConfig.ENABLE_SPACED_REPETITION) {
      return 0;
    }
    try {
      const missedIds = [
        ...new Set(
          input.feedback
            .filter(f => f.status === 'INCORRECT' || f.status === 'PARTIAL')
            .map(f => f.questionId.toString()),
        ),
      ];
      if (missedIds.length === 0) {
        return 0;
      }

      const questions = await this.questionRepo.getByIds(missedIds);
      const reviewableIds = questions
        .filter(q => isReviewableQuestion(q))
        .map(q => q._id!.toString());
      if (reviewableIds.length === 0) {
        return 0;
      }

      const relatedVideo = await this.findRelatedVideo(input.quizId);
      const nextReviewAt = getNextReviewDate(now, 1);
      for (const questionId of reviewableIds) {
        await this.reviewItemRepo.upsertQuizMiss(
          {
            userId: input.userId,
            courseId: input.courseId,
            courseVersionId: input.courseVersionId,
            cohortId: input.cohortId,
            questionId,
            quizId: input.quizId,
            relatedVideo,
          },
          nextReviewAt,
          INITIAL_EASE_FACTOR,
          now,
        );
      }
      return reviewableIds.length;
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
