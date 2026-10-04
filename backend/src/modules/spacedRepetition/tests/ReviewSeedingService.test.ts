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
  const reviewItemRepo = {upsertQuizMiss: vi.fn(async () => {})};
  const questionRepo = {
    getByIds: vi.fn(async (ids: string[]) =>
      [
        question(Q_WRONG),
        question(Q_PARTIAL, 'SELECT_MANY_IN_LOT'),
        question(Q_RIGHT),
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
) => ({
  userId: USER_ID,
  courseId: COURSE_ID,
  courseVersionId: VERSION_ID,
  quizId: QUIZ_ID,
  feedback,
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
