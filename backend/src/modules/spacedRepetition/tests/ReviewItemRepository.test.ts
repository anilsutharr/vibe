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

  it('counts due, learning and mastered items per course version', async () => {
    const now = new Date('2026-10-10T04:30:00Z');
    const schedule = async (
      questionId: string,
      versionId: string,
      intervalDays: number,
      nextReviewAt: Date,
    ) => {
      await repo.upsertQuizMiss(
        miss({questionId, courseVersionId: versionId}),
        day('2026-10-05'),
        INITIAL_EASE_FACTOR,
        firstMissAt,
      );
      const item = (await allItems()).find(
        i => i.questionId.toString() === questionId,
      )!;
      await repo.recordReview(item._id!.toString(), student, {
        repetitions: 2,
        easeFactor: 2.5,
        intervalDays,
        nextReviewAt,
        quality: 5,
        reviewedAt: firstMissAt,
        isLapse: false,
      });
    };
    const q = () => new ObjectId().toString();
    // Version 1: one overdue, one learning (6 days), one mastered (30 days).
    await schedule(q(), courseVersionId, 1, day('2026-10-08'));
    await schedule(q(), courseVersionId, 6, day('2026-10-15'));
    await schedule(q(), courseVersionId, 30, day('2026-11-05'));
    // Version 2: one learning item only.
    await schedule(q(), otherVersionId, 1, day('2026-10-12'));

    const counts = await repo.countByCourseForUser(student, now, 21);
    const v1 = counts.find(c => c.courseVersionId === courseVersionId)!;
    const v2 = counts.find(c => c.courseVersionId === otherVersionId)!;
    expect(v1).toMatchObject({
      courseId,
      due: 1,
      learning: 1,
      mastered: 1,
      nextDueAt: day('2026-10-15'),
    });
    expect(v2).toMatchObject({due: 0, learning: 1, mastered: 0});
    // The course with something due comes first.
    expect(counts[0].courseVersionId).toBe(courseVersionId);
    expect(await repo.countByCourseForUser(otherStudent, now, 21)).toEqual([]);
  });

  it('counts items falling due on each IST day in a range', async () => {
    const q = () => new ObjectId().toString();
    const add = (nextReviewAt: Date) =>
      repo.upsertQuizMiss(
        miss({questionId: q()}),
        nextReviewAt,
        INITIAL_EASE_FACTOR,
        firstMissAt,
      );
    // 00:00 IST and 23:59 IST on 6 Oct fall on the same IST day.
    await add(day('2026-10-05'));
    await add(new Date('2026-10-06T18:29:00Z'));
    await add(day('2026-10-07'));
    // Outside the range.
    await add(day('2026-10-20'));

    expect(
      await repo.countDueByDay(
        student,
        day('2026-10-05'),
        day('2026-10-10'),
        'Asia/Kolkata',
      ),
    ).toEqual([
      {date: '2026-10-06', count: 2},
      {date: '2026-10-08', count: 1},
    ]);
  });

  it('adds a retention check only when the student has no item for the question', async () => {
    const state = {repetitions: 2, easeFactor: 2.5, intervalDays: 7};
    const inAWeek = day('2026-10-11');

    // New question: created as a retention check.
    const fresh = new ObjectId().toString();
    expect(
      await repo.insertRetentionCheck(
        miss({questionId: fresh}),
        state,
        inAWeek,
        firstMissAt,
      ),
    ).toBe(true);

    // Question already missed: the miss is kept untouched.
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    expect(
      await repo.insertRetentionCheck(miss(), state, inAWeek, firstMissAt),
    ).toBe(false);

    const items = await allItems();
    const check = items.find(i => i.questionId.toString() === fresh)!;
    const missed = items.find(i => i.questionId.toString() === questionId)!;
    expect(check).toMatchObject({
      source: 'RETENTION_CHECK',
      repetitions: 2,
      intervalDays: 7,
      nextReviewAt: inAWeek,
      status: 'ACTIVE',
      reviewCount: 0,
      lapses: 0,
    });
    expect(missed).toMatchObject({
      source: 'QUIZ_MISS',
      repetitions: 0,
      intervalDays: 1,
      nextReviewAt: day('2026-10-05'),
    });
  });

  it('reports which questions the student is already reviewing', async () => {
    const other = new ObjectId().toString();
    await repo.upsertQuizMiss(
      miss(),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    // Same question for another student, and in another version.
    await repo.upsertQuizMiss(
      miss({questionId: other, userId: otherStudent}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );
    await repo.upsertQuizMiss(
      miss({questionId: other, courseVersionId: otherVersionId}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );

    const reviewed = await repo.findReviewedQuestionIds(
      student,
      courseVersionId,
      [questionId, other],
    );
    expect([...reviewed]).toEqual([questionId]);
    expect(
      await repo.findReviewedQuestionIds(student, courseVersionId, []),
    ).toEqual(new Set());
  });

  it('ranks questions in a course version by how often students forgot them', async () => {
    const qOften = new ObjectId().toString();
    const qOnce = new ObjectId().toString();
    const thirdStudent = new ObjectId().toString();
    const answer = async (userId: string, qid: string, lapses: number) => {
      const item = (await allItems()).find(
        i => i.userId.toString() === userId && i.questionId.toString() === qid,
      )!;
      for (let i = 0; i < 2; i++) {
        await repo.recordReview(item._id!.toString(), userId, {
          repetitions: 0,
          easeFactor: 2.5,
          intervalDays: 1,
          nextReviewAt: day('2026-10-06'),
          quality: i < lapses ? 1 : 5,
          reviewedAt: firstMissAt,
          isLapse: i < lapses,
        });
      }
    };
    // qOften: missed by two students in quizzes, forgotten 3 times in reviews.
    for (const userId of [student, otherStudent]) {
      await repo.upsertQuizMiss(
        miss({userId, questionId: qOften}),
        day('2026-10-05'),
        INITIAL_EASE_FACTOR,
        firstMissAt,
      );
    }
    await answer(student, qOften, 2);
    await answer(otherStudent, qOften, 1);
    // qOnce: a retention check for a third student, forgotten once.
    await repo.insertRetentionCheck(
      miss({userId: thirdStudent, questionId: qOnce}),
      {repetitions: 2, easeFactor: 2.5, intervalDays: 7},
      day('2026-10-11'),
      firstMissAt,
    );
    await answer(thirdStudent, qOnce, 1);
    // Another course version must not be counted.
    await repo.upsertQuizMiss(
      miss({courseVersionId: otherVersionId, questionId: qOften}),
      day('2026-10-05'),
      INITIAL_EASE_FACTOR,
      firstMissAt,
    );

    const {totals, questions} = await repo.statsForCourseVersion(
      courseVersionId,
      10,
    );
    expect(totals).toEqual({
      students: 3,
      questions: 2,
      reviews: 6,
      forgotten: 4,
    });
    expect(
      questions.map(q => [
        q.questionId,
        q.missedInQuiz,
        q.students,
        q.reviews,
        q.forgotten,
      ]),
    ).toEqual([
      [qOften, 2, 2, 4, 3],
      [qOnce, 0, 1, 2, 1],
    ]);

    const empty = await repo.statsForCourseVersion(
      new ObjectId().toString(),
      10,
    );
    expect(empty).toEqual({
      totals: {students: 0, questions: 0, reviews: 0, forgotten: 0},
      questions: [],
    });
  });
});
