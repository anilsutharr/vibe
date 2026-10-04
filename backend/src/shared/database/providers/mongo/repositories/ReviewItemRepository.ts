import 'reflect-metadata';
import {injectable, inject} from 'inversify';
import {ClientSession, Collection, ObjectId} from 'mongodb';
import {MongoDatabase} from '../MongoDatabase.js';
import {GLOBAL_TYPES} from '#root/types.js';
import {
  IReviewItem,
  IReviewItemVideoRef,
} from '#root/shared/interfaces/models.js';

/** What the quiz grader tells us about a question a student got wrong. */
export interface QuizMissInput {
  userId: string;
  courseId: string;
  courseVersionId: string;
  cohortId?: string;
  questionId: string;
  quizId: string;
  relatedVideo?: IReviewItemVideoRef;
}

/** SM-2 state and review details to save after a student answers a review. */
export interface ReviewOutcome {
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  nextReviewAt: Date;
  quality: number;
  reviewedAt: Date;
  /** True when the answer was a miss; counted in `lapses`. */
  isLapse: boolean;
}

@injectable()
export class ReviewItemRepository {
  private reviewItemCollection: Collection<IReviewItem>;
  private initialized = false;

  constructor(@inject(GLOBAL_TYPES.Database) private db: MongoDatabase) {}

  private async init() {
    if (this.initialized) {
      return;
    }
    this.reviewItemCollection =
      await this.db.getCollection<IReviewItem>('reviewItems');

    // One item per student per question per course version: missing the same
    // question again resets that item instead of adding a duplicate.
    await this.reviewItemCollection.createIndex(
      {userId: 1, courseVersionId: 1, questionId: 1},
      {unique: true},
    );
    // Serves "what is due for this student" and the daily reminder job.
    await this.reviewItemCollection.createIndex({
      userId: 1,
      status: 1,
      nextReviewAt: 1,
    });

    this.initialized = true;
  }

  /**
   * Schedules a question the student just got wrong in a quiz for review on
   * `nextReviewAt`. A new item starts with fresh SM-2 state. An existing item
   * is restarted (its streak and interval reset), keeping its easiness
   * factor, review history and original source.
   */
  async upsertQuizMiss(
    miss: QuizMissInput,
    nextReviewAt: Date,
    initialEaseFactor: number,
    now: Date,
    session?: ClientSession,
  ): Promise<void> {
    await this.init();
    await this.reviewItemCollection.updateOne(
      {
        userId: new ObjectId(miss.userId),
        courseVersionId: new ObjectId(miss.courseVersionId),
        questionId: new ObjectId(miss.questionId),
      },
      {
        $set: {
          quizId: new ObjectId(miss.quizId),
          ...(miss.cohortId ? {cohortId: new ObjectId(miss.cohortId)} : {}),
          ...(miss.relatedVideo ? {relatedVideo: miss.relatedVideo} : {}),
          repetitions: 0,
          intervalDays: 1,
          nextReviewAt,
          status: 'ACTIVE',
          updatedAt: now,
        },
        $setOnInsert: {
          courseId: new ObjectId(miss.courseId),
          source: 'QUIZ_MISS',
          easeFactor: initialEaseFactor,
          reviewCount: 0,
          lapses: 0,
          createdAt: now,
        },
      },
      {upsert: true, session},
    );
  }

  /** Active items due at or before `now` for one student, oldest first. */
  async findDueForUser(
    userId: string,
    now: Date,
    options: {courseVersionId?: string; limit?: number} = {},
    session?: ClientSession,
  ): Promise<IReviewItem[]> {
    await this.init();
    return this.reviewItemCollection
      .find(
        {
          userId: new ObjectId(userId),
          status: 'ACTIVE',
          nextReviewAt: {$lte: now},
          ...(options.courseVersionId
            ? {courseVersionId: new ObjectId(options.courseVersionId)}
            : {}),
        },
        {session},
      )
      .sort({nextReviewAt: 1, _id: 1})
      .limit(options.limit ?? 0)
      .toArray();
  }

  /**
   * Looks an item up by id, but only if it belongs to `userId`, so one
   * student can never read or answer another student's review.
   */
  async findOwnedById(
    reviewItemId: string,
    userId: string,
    session?: ClientSession,
  ): Promise<IReviewItem | null> {
    await this.init();
    return this.reviewItemCollection.findOne(
      {_id: new ObjectId(reviewItemId), userId: new ObjectId(userId)},
      {session},
    );
  }

  /** Saves the result of one review. Returns false if no owned item matched. */
  async recordReview(
    reviewItemId: string,
    userId: string,
    outcome: ReviewOutcome,
    session?: ClientSession,
  ): Promise<boolean> {
    await this.init();
    const result = await this.reviewItemCollection.updateOne(
      {_id: new ObjectId(reviewItemId), userId: new ObjectId(userId)},
      {
        $set: {
          repetitions: outcome.repetitions,
          easeFactor: outcome.easeFactor,
          intervalDays: outcome.intervalDays,
          nextReviewAt: outcome.nextReviewAt,
          lastQuality: outcome.quality,
          lastReviewedAt: outcome.reviewedAt,
          updatedAt: outcome.reviewedAt,
        },
        $inc: {reviewCount: 1, lapses: outcome.isLapse ? 1 : 0},
      },
      {session},
    );
    return result.matchedCount === 1;
  }
}
