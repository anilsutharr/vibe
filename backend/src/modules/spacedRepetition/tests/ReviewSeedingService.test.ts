import 'reflect-metadata';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ObjectId} from 'mongodb';
import {appConfig} from '#root/config/app.js';
import {ReviewSeedingService} from '../services/ReviewSeedingService.js';
import {INITIAL_EASE_FACTOR} from '../constants.js';

const USER_ID = new ObjectId().toString();
const COURSE_ID = new ObjectId().toString();
const VERSION_ID = new ObjectId().toString();
const QUIZ_ID = new ObjectId().toString();
const GROUP_ID = new ObjectId().toString();

const Q_WRONG = new ObjectId().toString();
const Q_PARTIAL = new ObjectId().toString();
const Q_RIGHT = new ObjectId().toString();
const Q_RIGHT_2 = new ObjectId().toString();
const Q_RIGHT_3 = new ObjectId().toString();
const Q_DESCRIPTIVE = new ObjectId().toString();

const question = (id: string, type = 'SELECT_ONE_IN_LOT') => ({
  _id: new ObjectId(id),
  type,
  isParameterized: false,
});

// 10:00 IST on 5 Oct 2026; the first review is due from 00:00 IST on 6 Oct.
const NOW = new Date('2026-10-05T04:30:00Z');
const TOMORROW = new Date('2026-10-05T18:30:00Z');
const VIDEO = {moduleId: 'm1', sectionId: 's1', itemId: 'video1'};

function buildService(overrides: Record<string, any> = {}) {
  const reviewItemRepo = {
    upsertQuizMiss: vi.fn(async () => {}),
    findReviewedQuestionIds: vi.fn(async () => new Set<string>()),
    insertRetentionCheck: vi.fn(async () => true),
  };
  const questionRepo = {
    getByIds: vi.fn(async (ids: string[]) =>
      [
        question(Q_WRONG),
        question(Q_PARTIAL, 'SELECT_MANY_IN_LOT'),
        question(Q_RIGHT),
        question(Q_RIGHT_2),
        question(Q_RIGHT_3),
        question(Q_DESCRIPTIVE, 'DESCRIPTIVE'),
      ].filter(q => ids.includes(q._id.toString())),
    ),
  };
  const itemRepo = {
    findItemsGroupByItemId: vi.fn(async () => ({_id: new ObjectId(GROUP_ID)})),
  };
  const courseRepo = {
    findVersionByItemGroupId: vi.fn(async () => ({
      _id: new ObjectId(VERSION_ID),
      modules: [
        {
          moduleId: 'm1',
          sections: [{sectionId: 's1', itemsGroupId: new ObjectId(GROUP_ID)}],
        },
      ],
    })),
  };
  const progressService = {
    getPreviousVideoItem: vi.fn(async () => VIDEO),
  };
  const deps = {
    reviewItemRepo,
    questionRepo,
    itemRepo,
    courseRepo,
    progressService,
    ...overrides,
  };
  const service = new ReviewSeedingService(
    deps.reviewItemRepo as any,
    deps.questionRepo as any,
    deps.itemRepo as any,
    deps.courseRepo as any,
    deps.progressService as any,
  );
  return {service, ...deps};
}

const input = (
  feedback: {questionId: string; status: 'CORRECT' | 'INCORRECT' | 'PARTIAL'}[],
  passed = false,
) => ({
  userId: USER_ID,
  courseId: COURSE_ID,
  courseVersionId: VERSION_ID,
  quizId: QUIZ_ID,
  feedback,
  passed,
});

describe('ReviewSeedingService.seedFromQuizGrading', () => {
  const originalFlag = appConfig.ENABLE_SPACED_REPETITION;
  beforeEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = true;
  });
  afterEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = originalFlag;
    vi.restoreAllMocks();
  });

  it('does nothing while the feature is switched off', async () => {
    appConfig.ENABLE_SPACED_REPETITION = false;
    const {service, questionRepo, reviewItemRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input([{questionId: Q_WRONG, status: 'INCORRECT'}]),
      NOW,
    );
    expect(count).toBe(0);
    expect(questionRepo.getByIds).not.toHaveBeenCalled();
    expect(reviewItemRepo.upsertQuizMiss).not.toHaveBeenCalled();
  });

  it('schedules incorrect and partly correct questions for tomorrow, with the video before the quiz', async () => {
    const {service, reviewItemRepo, progressService} = buildService();
    const count = await service.seedFromQuizGrading(
      input([
        {questionId: Q_WRONG, status: 'INCORRECT'},
        {questionId: Q_PARTIAL, status: 'PARTIAL'},
        {questionId: Q_RIGHT, status: 'CORRECT'},
      ]),
      NOW,
    );

    expect(count).toBe(2);
    expect(progressService.getPreviousVideoItem).toHaveBeenCalledWith(
      expect.anything(),
      'm1',
      's1',
      QUIZ_ID,
    );
    const scheduled = reviewItemRepo.upsertQuizMiss.mock.calls.map(
      (call: any[]) => call[0].questionId,
    );
    expect(scheduled.sort()).toEqual([Q_WRONG, Q_PARTIAL].sort());
    expect(reviewItemRepo.upsertQuizMiss).toHaveBeenCalledWith(
      {
        userId: USER_ID,
        courseId: COURSE_ID,
        courseVersionId: VERSION_ID,
        cohortId: undefined,
        questionId: Q_WRONG,
        quizId: QUIZ_ID,
        relatedVideo: VIDEO,
      },
      TOMORROW,
      INITIAL_EASE_FACTOR,
      NOW,
    );
  });

  it('does not look anything up when every answer was correct', async () => {
    const {service, questionRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input([{questionId: Q_RIGHT, status: 'CORRECT'}]),
      NOW,
    );
    expect(count).toBe(0);
    expect(questionRepo.getByIds).not.toHaveBeenCalled();
  });

  it('skips question types that reviews do not support yet', async () => {
    const {service, reviewItemRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input([{questionId: Q_DESCRIPTIVE, status: 'INCORRECT'}]),
      NOW,
    );
    expect(count).toBe(0);
    expect(reviewItemRepo.upsertQuizMiss).not.toHaveBeenCalled();
  });

  it('schedules each question once even if it appears twice', async () => {
    const {service, questionRepo, reviewItemRepo} = buildService();
    await service.seedFromQuizGrading(
      input([
        {questionId: Q_WRONG, status: 'INCORRECT'},
        {questionId: Q_WRONG, status: 'INCORRECT'},
      ]),
      NOW,
    );
    expect(questionRepo.getByIds).toHaveBeenCalledWith([Q_WRONG]);
    expect(reviewItemRepo.upsertQuizMiss).toHaveBeenCalledTimes(1);
  });

  it('still schedules the review when the related video cannot be found', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const {service, reviewItemRepo} = buildService({
      itemRepo: {
        findItemsGroupByItemId: vi.fn(async () => {
          throw new Error('database hiccup');
        }),
      },
    });
    const count = await service.seedFromQuizGrading(
      input([{questionId: Q_WRONG, status: 'INCORRECT'}]),
      NOW,
    );
    expect(count).toBe(1);
    const [scheduled] = reviewItemRepo.upsertQuizMiss.mock.calls[0] as any[];
    expect(scheduled.relatedVideo).toBeUndefined();
  });

  it('never throws, so a quiz submission cannot fail because of reviews', async () => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const {service} = buildService({
      reviewItemRepo: {
        upsertQuizMiss: vi.fn(async () => {
          throw new Error('write failed');
        }),
      },
    });
    await expect(
      service.seedFromQuizGrading(
        input([{questionId: Q_WRONG, status: 'INCORRECT'}]),
        NOW,
      ),
    ).resolves.toBe(0);
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('ReviewSeedingService retention checks', () => {
  const originalFlag = appConfig.ENABLE_SPACED_REPETITION;
  beforeEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = true;
  });
  afterEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = originalFlag;
    vi.restoreAllMocks();
  });

  // 00:00 IST on 12 Oct: seven days after a quiz taken on 5 Oct.
  const IN_A_WEEK = new Date('2026-10-11T18:30:00Z');
  const allCorrect = [
    {questionId: Q_RIGHT, status: 'CORRECT' as const},
    {questionId: Q_RIGHT_2, status: 'CORRECT' as const},
    {questionId: Q_RIGHT_3, status: 'CORRECT' as const},
  ];

  it('brings back two correctly answered questions a week after a passed quiz', async () => {
    const {service, reviewItemRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input(allCorrect, true),
      NOW,
      () => 0,
    );

    expect(count).toBe(2);
    expect(reviewItemRepo.upsertQuizMiss).not.toHaveBeenCalled();
    expect(reviewItemRepo.insertRetentionCheck).toHaveBeenCalledTimes(2);
    expect(reviewItemRepo.insertRetentionCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        questionId: Q_RIGHT,
        quizId: QUIZ_ID,
        relatedVideo: VIDEO,
      }),
      // Starts as two correct recalls, so a correct check grows to ~18 days.
      {repetitions: 2, easeFactor: INITIAL_EASE_FACTOR, intervalDays: 7},
      IN_A_WEEK,
      NOW,
    );
  });

  it('adds no retention checks when the quiz was not passed', async () => {
    const {service, reviewItemRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input(allCorrect, false),
      NOW,
    );
    expect(count).toBe(0);
    expect(reviewItemRepo.insertRetentionCheck).not.toHaveBeenCalled();
  });

  it('schedules misses as usual and checks only the correct answers in a passed quiz', async () => {
    const {service, reviewItemRepo} = buildService();
    const count = await service.seedFromQuizGrading(
      input(
        [{questionId: Q_WRONG, status: 'INCORRECT' as const}, ...allCorrect],
        true,
      ),
      NOW,
      () => 0,
    );
    expect(count).toBe(3);
    expect(reviewItemRepo.upsertQuizMiss).toHaveBeenCalledTimes(1);
    const checked = reviewItemRepo.insertRetentionCheck.mock.calls.map(
      (call: any[]) => call[0].questionId,
    );
    expect(checked).not.toContain(Q_WRONG);
    expect(checked).toHaveLength(2);
  });

  it('skips questions the student is already reviewing', async () => {
    const {service, reviewItemRepo} = buildService();
    reviewItemRepo.findReviewedQuestionIds.mockResolvedValueOnce(
      new Set([Q_RIGHT, Q_RIGHT_2]),
    );
    await service.seedFromQuizGrading(input(allCorrect, true), NOW);
    const checked = reviewItemRepo.insertRetentionCheck.mock.calls.map(
      (call: any[]) => call[0].questionId,
    );
    expect(checked).toEqual([Q_RIGHT_3]);
  });

  it('does not count a check that already existed', async () => {
    const {service, reviewItemRepo} = buildService();
    reviewItemRepo.insertRetentionCheck.mockResolvedValue(false);
    expect(
      await service.seedFromQuizGrading(input(allCorrect, true), NOW),
    ).toBe(0);
  });

  it('never throws when adding a retention check fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const {service, reviewItemRepo} = buildService();
    reviewItemRepo.insertRetentionCheck.mockRejectedValue(
      new Error('write failed'),
    );
    await expect(
      service.seedFromQuizGrading(input(allCorrect, true), NOW),
    ).resolves.toBe(0);
  });
});
