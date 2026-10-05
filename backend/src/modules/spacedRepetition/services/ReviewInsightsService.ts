import 'reflect-metadata';
import {injectable, inject} from 'inversify';
import {NotFoundError} from 'routing-controllers';
import {GLOBAL_TYPES} from '#root/types.js';
import {COURSES_TYPES} from '#courses/types.js';
import {QUIZZES_TYPES} from '#quizzes/types.js';
import type {ICourseRepository} from '#shared/database/interfaces/ICourseRepository.js';
import type {IItemRepository} from '#shared/database/interfaces/IItemRepository.js';
import type {QuestionRepository} from '#quizzes/repositories/providers/mongodb/QuestionRepository.js';
import type {
  CourseVersionReviewTotals,
  ReviewItemRepository,
} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {SPACED_REPETITION_TYPES} from '../types.js';
import {NameLookup, RelatedVideo} from './NameLookup.js';

/** How many questions the instructor view lists. */
export const MAX_INSIGHT_QUESTIONS = 10;

export interface QuestionInsight {
  questionId: string;
  questionText: string;
  /** Students who answered it wrongly in a quiz. */
  missedInQuiz: number;
  /** Students reviewing it (misses and retention checks). */
  students: number;
  reviews: number;
  /** Review answers that were wrong. */
  forgotten: number;
  /** Share of review answers that were right, or null before any review. */
  recallRate: number | null;
  relatedVideo?: RelatedVideo;
}

export interface CourseReviewInsights {
  totals: CourseVersionReviewTotals & {recallRate: number | null};
  questions: QuestionInsight[];
}

const recallRate = (reviews: number, forgotten: number) =>
  reviews > 0
    ? Math.round(((reviews - forgotten) / reviews) * 100) / 100
    : null;

/**
 * Instructor view of a course version's reviews: which questions students
 * miss and then keep forgetting, and the video that teaches each one.
 */
@injectable()
export class ReviewInsightsService {
  constructor(
    @inject(SPACED_REPETITION_TYPES.ReviewItemRepo)
    private readonly reviewItemRepo: ReviewItemRepository,

    @inject(QUIZZES_TYPES.QuestionRepo)
    private readonly questionRepo: QuestionRepository,

    @inject(GLOBAL_TYPES.CourseRepo)
    private readonly courseRepo: ICourseRepository,

    @inject(COURSES_TYPES.ItemRepo)
    private readonly itemRepo: IItemRepository,
  ) {}

  /**
   * Statistics for one course version. Throws NotFoundError if the version
   * does not belong to the course, so access to one course can never be used
   * to read another course's data.
   */
  async getCourseInsights(
    courseId: string,
    courseVersionId: string,
  ): Promise<CourseReviewInsights> {
    const version = await this.courseRepo.readVersion(courseVersionId);
    if (!version || version.courseId?.toString() !== courseId) {
      throw new NotFoundError('Course version not found');
    }

    const {totals, questions} = await this.reviewItemRepo.statsForCourseVersion(
      courseVersionId,
      MAX_INSIGHT_QUESTIONS,
    );
    const texts = new Map(
      (await this.questionRepo.getByIds(questions.map(q => q.questionId))).map(
        q => [q._id!.toString(), q.text],
      ),
    );
    const names = new NameLookup(this.courseRepo, this.itemRepo);

    return {
      totals: {
        ...totals,
        recallRate: recallRate(totals.reviews, totals.forgotten),
      },
      questions: await Promise.all(
        questions.map(async q => ({
          questionId: q.questionId,
          questionText: texts.get(q.questionId) ?? 'Deleted question',
          missedInQuiz: q.missedInQuiz,
          students: q.students,
          reviews: q.reviews,
          forgotten: q.forgotten,
          recallRate: recallRate(q.reviews, q.forgotten),
          relatedVideo: await names.relatedVideo(
            courseVersionId,
            q.relatedVideo,
          ),
        })),
      ),
    };
  }
}
