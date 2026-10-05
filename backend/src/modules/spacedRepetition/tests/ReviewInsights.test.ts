import 'reflect-metadata';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {ObjectId} from 'mongodb';
import {ForbiddenError, NotFoundError} from 'routing-controllers';
import {appConfig} from '#root/config/app.js';
import {getCourseAbility} from '#courses/abilities/courseAbilities.js';
import {ReviewInsightsService} from '../services/ReviewInsightsService.js';
import {ReviewController} from '../controllers/ReviewController.js';

const COURSE_ID = new ObjectId().toString();
const OTHER_COURSE_ID = new ObjectId().toString();
const VERSION_ID = new ObjectId().toString();
const Q_HARD = new ObjectId();
const Q_DELETED = new ObjectId();
const VIDEO = {moduleId: 'm1', sectionId: 's1', itemId: 'video1'};

function buildService() {
  const reviewItemRepo = {
    statsForCourseVersion: vi.fn(async () => ({
      totals: {students: 4, questions: 2, reviews: 20, forgotten: 5},
      questions: [
        {
          questionId: Q_HARD.toString(),
          quizId: 'quiz1',
          relatedVideo: VIDEO,
          missedInQuiz: 3,
          students: 4,
          reviews: 8,
          forgotten: 4,
        },
        {
          questionId: Q_DELETED.toString(),
          quizId: 'quiz1',
          missedInQuiz: 1,
          students: 1,
          reviews: 0,
          forgotten: 0,
        },
      ],
    })),
  };
  const questionRepo = {
    getByIds: vi.fn(async () => [
      {_id: Q_HARD, text: 'What does gradient descent minimise?'},
    ]),
  };
  const courseRepo = {
    readVersion: vi.fn(async () => ({
      courseId: new ObjectId(COURSE_ID),
      modules: [
        {
          moduleId: 'm1',
          name: 'Basics',
          sections: [{sectionId: 's1', name: 'Week 1'}],
        },
      ],
    })),
    read: vi.fn(async () => ({name: 'Intro to ML'})),
  };
  const itemRepo = {readItem: vi.fn(async () => ({name: 'Optimisation'}))};
  const service = new ReviewInsightsService(
    reviewItemRepo as any,
    questionRepo as any,
    courseRepo as any,
    itemRepo as any,
  );
  return {service, reviewItemRepo, courseRepo};
}

describe('ReviewInsightsService.getCourseInsights', () => {
  it('lists the most forgotten questions with recall rates and the video to rewatch', async () => {
    const {service, reviewItemRepo} = buildService();
    const insights = await service.getCourseInsights(COURSE_ID, VERSION_ID);

    expect(reviewItemRepo.statsForCourseVersion).toHaveBeenCalledWith(
      VERSION_ID,
      10,
    );
    // 20 reviews, 5 forgotten -> 75% recalled.
    expect(insights.totals).toEqual({
      students: 4,
      questions: 2,
      reviews: 20,
      forgotten: 5,
      recallRate: 0.75,
    });
    expect(insights.questions[0]).toMatchObject({
      questionText: 'What does gradient descent minimise?',
      missedInQuiz: 3,
      forgotten: 4,
      recallRate: 0.5,
      relatedVideo: {
        ...VIDEO,
        videoName: 'Optimisation',
        moduleName: 'Basics',
        sectionName: 'Week 1',
      },
    });
  });

  it('shows a deleted question as such, with no recall rate before any review', async () => {
    const {service} = buildService();
    const insights = await service.getCourseInsights(COURSE_ID, VERSION_ID);
    expect(insights.questions[1]).toMatchObject({
      questionText: 'Deleted question',
      recallRate: null,
      relatedVideo: undefined,
    });
  });

  it('refuses a version that belongs to another course', async () => {
    const {service, reviewItemRepo} = buildService();
    await expect(
      service.getCourseInsights(OTHER_COURSE_ID, VERSION_ID),
    ).rejects.toThrow(NotFoundError);
    expect(reviewItemRepo.statsForCourseVersion).not.toHaveBeenCalled();
  });

  it('refuses a version that does not exist', async () => {
    const {service, courseRepo} = buildService();
    courseRepo.readVersion.mockResolvedValueOnce(null as any);
    await expect(
      service.getCourseInsights(COURSE_ID, VERSION_ID),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('ReviewController.getCourseInsights permissions', () => {
  const originalFlag = appConfig.ENABLE_SPACED_REPETITION;
  beforeEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = true;
  });
  afterEach(() => {
    appConfig.ENABLE_SPACED_REPETITION = originalFlag;
  });

  const insightsService = {getCourseInsights: vi.fn(async () => ({}))};
  const controller = new ReviewController({} as any, insightsService as any);
  const params = {courseId: COURSE_ID, versionId: VERSION_ID};
  const abilityFor = (
    role: 'STUDENT' | 'INSTRUCTOR' | 'MANAGER' | 'TA',
    courseId = COURSE_ID,
  ) =>
    getCourseAbility({
      userId: new ObjectId().toString(),
      globalRole: 'user',
      enrollments: [{courseId, versionId: VERSION_ID, role}],
    } as any);

  it.each(['INSTRUCTOR', 'MANAGER'] as const)(
    'lets a course %s see the insights',
    async role => {
      await expect(
        controller.getCourseInsights(params, {ability: abilityFor(role)}),
      ).resolves.toBeDefined();
    },
  );

  it.each(['STUDENT', 'TA'] as const)('refuses a %s', async role => {
    await expect(
      controller.getCourseInsights(params, {ability: abilityFor(role)}),
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuses an instructor of a different course', async () => {
    await expect(
      controller.getCourseInsights(params, {
        ability: abilityFor('INSTRUCTOR', OTHER_COURSE_ID),
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lets an admin see any course', async () => {
    const ability = getCourseAbility({
      userId: new ObjectId().toString(),
      globalRole: 'admin',
      enrollments: [],
    } as any);
    await expect(
      controller.getCourseInsights(params, {ability}),
    ).resolves.toBeDefined();
  });

  it('is hidden while the feature is switched off', async () => {
    appConfig.ENABLE_SPACED_REPETITION = false;
    await expect(
      controller.getCourseInsights(params, {ability: abilityFor('INSTRUCTOR')}),
    ).rejects.toThrow(NotFoundError);
  });
});
