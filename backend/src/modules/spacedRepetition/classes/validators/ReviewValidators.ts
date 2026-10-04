import 'reflect-metadata';
import {Type} from 'class-transformer';
import {JSONSchema} from 'class-validator-jsonschema';
import {
  IsIn,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsObject,
  IsOptional,
  Max,
  Min,
} from 'class-validator';
import {Answer} from '#quizzes/interfaces/grading.js';
import {ReviewConfidence} from '../../utils/toRecallQuality.js';
import {MAX_DUE_REVIEWS} from '../../services/ReviewService.js';

const REVIEW_QUESTION_TYPES = [
  'SELECT_ONE_IN_LOT',
  'SELECT_MANY_IN_LOT',
  'ORDER_THE_LOTS',
  'NUMERIC_ANSWER_TYPE',
];

export class DueReviewsQuery {
  @JSONSchema({
    description: 'Only return reviews from this course version',
    type: 'string',
  })
  @IsOptional()
  @IsMongoId()
  courseVersionId?: string;

  @JSONSchema({
    description: `How many due reviews to return (1-${MAX_DUE_REVIEWS}, default 20)`,
    type: 'integer',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_DUE_REVIEWS)
  limit?: number;
}

export class ReviewItemIdParams {
  @JSONSchema({description: 'The review item being answered', type: 'string'})
  @IsMongoId()
  @IsNotEmpty()
  reviewItemId: string;
}

export class AnswerReviewBody {
  @JSONSchema({
    description: 'Type of the question being answered',
    type: 'string',
    enum: REVIEW_QUESTION_TYPES,
    example: 'SELECT_ONE_IN_LOT',
  })
  @IsIn(REVIEW_QUESTION_TYPES)
  questionType: string;

  @JSONSchema({
    description:
      'The answer, in the same shape as a quiz answer for this question type',
    type: 'object',
    example: {lotItemId: '60d21b4667d0d8992e610c03'},
  })
  @IsObject()
  answer: Answer;

  @JSONSchema({
    description:
      'How sure the student was: SURE ("Got it") or UNSURE. Only changes the schedule when the answer is correct.',
    type: 'string',
    enum: ['SURE', 'UNSURE'],
    example: 'SURE',
  })
  @IsIn(['SURE', 'UNSURE'])
  confidence: ReviewConfidence;
}

export const SPACED_REPETITION_VALIDATORS = [
  DueReviewsQuery,
  ReviewItemIdParams,
  AnswerReviewBody,
];
