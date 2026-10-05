import 'reflect-metadata';
import {inject, injectable} from 'inversify';
import {
  Authorized,
  Body,
  CurrentUser,
  Get,
  HttpCode,
  JsonController,
  NotFoundError,
  Params,
  Post,
  QueryParams,
} from 'routing-controllers';
import {OpenAPI} from 'routing-controllers-openapi';
import {appConfig} from '#root/config/app.js';
import {IUser} from '#shared/interfaces/models.js';
import {SPACED_REPETITION_TYPES} from '../types.js';
import {ReviewService} from '../services/ReviewService.js';
import {
  AnswerReviewBody,
  DueReviewsQuery,
  ReviewItemIdParams,
} from '../classes/validators/ReviewValidators.js';

/**
 * Spaced repetition reviews for the signed-in student (#1047). The student is
 * always the caller: no route accepts a user id, so nobody can read or answer
 * someone else's reviews.
 */
@OpenAPI({tags: ['Spaced Repetition Reviews']})
@JsonController('/reviews', {transformResponse: true})
@injectable()
export class ReviewController {
  constructor(
    @inject(SPACED_REPETITION_TYPES.ReviewService)
    private readonly reviewService: ReviewService,
  ) {}

  @OpenAPI({
    summary: 'Review summary',
    description:
      'Reviews due now, learning and mastered counts per course, and how many reviews fall due on each of the next 14 days. Returns 404 while spaced repetition is switched off, which clients can use to hide the feature.',
  })
  @Authorized()
  @Get('/summary')
  @HttpCode(200)
  async getSummary(@CurrentUser() user: IUser) {
    this.ensureEnabled();
    return this.reviewService.getSummary(user._id.toString());
  }

  @OpenAPI({
    summary: 'List due reviews',
    description:
      'Questions the student got wrong in quizzes and is due to review, oldest first. Each question is shown as in a quiz, without its answer.',
  })
  @Authorized()
  @Get('/due')
  @HttpCode(200)
  async getDueReviews(
    @CurrentUser() user: IUser,
    @QueryParams() query: DueReviewsQuery,
  ) {
    this.ensureEnabled();
    const reviews = await this.reviewService.getDueReviews(
      user._id.toString(),
      {courseVersionId: query.courseVersionId, limit: query.limit},
    );
    return {reviews};
  }

  @OpenAPI({
    summary: 'Answer a review',
    description:
      'Grades the answer, schedules the next review with SM-2 and returns the result with the correct answer. Does not affect quiz scores or course progress.',
  })
  @Authorized()
  @Post('/:reviewItemId/answer')
  @HttpCode(200)
  async answerReview(
    @CurrentUser() user: IUser,
    @Params() params: ReviewItemIdParams,
    @Body() body: AnswerReviewBody,
  ) {
    this.ensureEnabled();
    return this.reviewService.answerReview(
      user._id.toString(),
      params.reviewItemId,
      {
        questionType: body.questionType,
        answer: body.answer,
        confidence: body.confidence,
      },
    );
  }

  /** The routes stay hidden until the feature is switched on. */
  private ensureEnabled() {
    if (!appConfig.ENABLE_SPACED_REPETITION) {
      throw new NotFoundError('Not found');
    }
  }
}
