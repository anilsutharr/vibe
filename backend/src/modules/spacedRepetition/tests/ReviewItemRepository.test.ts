import {describe, it, expect, beforeAll, afterAll, beforeEach} from 'vitest';
import {ObjectId} from 'mongodb';
import {MongoDatabase} from '#shared/database/providers/mongo/MongoDatabase.js';
import {
  QuizMissInput,
  ReviewItemRepository,
} from '#shared/database/providers/mongo/repositories/ReviewItemRepository.js';
import {IReviewItem} from '#shared/interfaces/models.js';
import {INITIAL_EASE_FACTOR} from '../constants.js';

/**
 * Repository-level tests for spaced repetition review items. Runs against the
 * in-memory Mongo replica set started in test/globalSetup.ts.
 */
describe('ReviewItemRepository', () => {
  let db: MongoDatabase;
  let repo: ReviewItemRepository;

  const student = new ObjectId().toString();
  const otherStudent = new ObjectId().toString();
  const courseId = new ObjectId().toString();
  const courseVersionId = new ObjectId().toString();
  const otherVersionId = new ObjectId().toString();
  const quizId = new ObjectId().toString();
  const questionId = new ObjectId().toString();

  const miss = (overrides: Partial<QuizMissInput> = {}): QuizMissInput => ({
    userId: student,
    courseId,
    courseVersionId,
    questionId,
    quizId,
    ...overrides,
  });

  const day = (iso: string) => new Date(`${iso}T18:30:00.000Z`);
  const firstMissAt = new Date('2026-10-05T04:30:00Z');

  const allItems = async () =>
    (await db.getCollection<IReviewItem>('reviewItems')).find({}).toArray();

  beforeAll(async () => {
    db = new MongoDatabase(process.env.DB_URL, 'review_item_repository_test');
    await db.connect();
    repo = new ReviewItemRepository(db);
  });

  beforeEach(async () => {
    await (await db.getCollection('reviewItems')).deleteMany({});
  });

  afterAll(async () => {
    await db.disconnect?.();
  });

  it('creates a fresh SM-2 item for a first miss', async () => {
    const relatedVideo = {moduleId: 'm1', sectionId: 's1', itemId: 'v1'};
    await repo.upsertQuizMiss(
      miss({relatedVideo}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );

    const [item] = await allItems();
    expect(item).toMatchObject({
      source: 'QUIZ_MISS',
      status: 'ACTIVE',
      repetitions: 0,
      easeFactor: INITIAL_EASE_FACTOR,
      intervalDays: 1,
      nextReviewAt: day('2026-10-05'),
      reviewCount: 0,
      lapses: 0,
      relatedVideo,
      createdAt: firstMissAt,
    });
    expect(item.userId).toEqual(new ObjectId(student));
    expect(item.questionId).toEqual(new ObjectId(questionId));
  });

  it('restarts an existing item when the same question is missed again', async () => {
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    const [created] = await allItems();
    // Simulate a few good reviews that grew the interval and the EF.
    await repo.recordReview(created._id!.toString(), student, {
      repetitions: 3,
      easeFactor: 2.8,
      intervalDays: 16,
      nextReviewAt: day('2026-10-28'),
      quality: 5,
      reviewedAt: new Date('2026-10-12T05:00:00Z'),
      isLapse: false,
    });

    const missedAgainAt = new Date('2026-10-20T05:00:00Z');
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-20'),
      INITIAL_EASE_FACTOR,
      missedAgainAt,
    );

    const items = await allItems();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      repetitions: 0,
      intervalDays: 1,
      nextReviewAt: day('2026-10-20'),
      // Kept from before: the easiness factor and the review history.
      easeFactor: 2.8,
      reviewCount: 1,
      createdAt: firstMissAt,
      updatedAt: missedAgainAt,
    });
  });

  it('keeps separate items per course version', async () => {
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    await repo.upsertQuizMiss(
      miss({courseVersionId: otherVersionId}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    expect(await allItems()).toHaveLength(2);
  });

  it('finds only due, active items for the student, oldest first', async () => {
    const q1 = new ObjectId().toString();
    const q2 = new ObjectId().toString();
    const q3 = new ObjectId().toString();
    await repo.upsertQuizMiss(
      miss({questionId: q1}),
      day('2026-10-06'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    await repo.upsertQuizMiss(
      miss({questionId: q2}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    // Not due yet.
    await repo.upsertQuizMiss(
      miss({questionId: q3}),
      day('2026-10-30'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    // Another student's due item.
    await repo.upsertQuizMiss(
      miss({userId: otherStudent}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );

    const due = await repo.findDueForUser(
      student,
      new Date('2026-10-07T00:00:00Z'),
    );
    expect(due.map(i => i.questionId.toString())).toEqual([q2, q1]);

    const limited = await repo.findDueForUser(
      student,
      new Date('2026-10-07T00:00:00Z'),
      {limit: 1},
    );
    expect(limited).toHaveLength(1);
  });

  it('never returns or updates another student’s item', async () => {
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    const [item] = await allItems();
    const id = item._id!.toString();

    expect(await repo.findOwnedById(id, otherStudent)).toBeNull();
    expect(await repo.findOwnedById(id, student)).not.toBeNull();

    const updated = await repo.recordReview(id, otherStudent, {
      repetitions: 1,
      easeFactor: 2.6,
      intervalDays: 1,
      nextReviewAt: day('2026-10-06'),
      quality: 5,
      reviewedAt: new Date('2026-10-06T05:00:00Z'),
      isLapse: false,
    });
    expect(updated).toBe(false);
    expect((await allItems())[0].reviewCount).toBe(0);
  });

  it('counts a missed review as a lapse', async () => {
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    const [item] = await allItems();
    await repo.recordReview(item._id!.toString(), student, {
      repetitions: 0,
      easeFactor: 2.5,
      intervalDays: 1,
      nextReviewAt: day('2026-10-06'),
      quality: 1,
      reviewedAt: new Date('2026-10-06T05:00:00Z'),
      isLapse: true,
    });
    expect((await allItems())[0]).toMatchObject({
      reviewCount: 1,
      lapses: 1,
      lastQuality: 1,
    });
  });
});
