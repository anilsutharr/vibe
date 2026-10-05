import 'reflect-metadata';
import {describe, expect, it, vi} from 'vitest';
import {ObjectId} from 'mongodb';
import {BadRequestError, NotFoundError} from 'routing-controllers';
import {ReviewService} from '../services/ReviewService.js';

const STUDENT = new ObjectId().toString();
const ITEM_ID = new ObjectId().toString();
const QUESTION_ID = new ObjectId();
const QUIZ_ID = new ObjectId();
const RIGHT_OPTION = new ObjectId();
const WRONG_OPTION = new ObjectId();

// A real single-choice question, so the actual quiz grader and renderer run.
const storedQuestion = () => ({
  _id: QUESTION_ID,
  type: 'SELECT_ONE_IN_LOT',
  text: 'Which method minimises a loss function step by step?',
  isParameterized: false,
  parameters: [],
  hint: 'Think about slopes.',
  timeLimitSeconds: 60,
  points: 1,
  priority: 'LOW',
  correctLotItem: {
    _id: RIGHT_OPTION,
    text: 'Gradient descent',
    explaination: 'It follows the negative gradient.',
  },
  incorrectLotItems: [
    {_id: WRONG_OPTION, text: 'Bagging', explaination: 'That is ensembling.'},
  ],
});

// 10:00 IST on 10 Oct 2026.
const NOW = new Date('2026-10-10T04:30:00Z');
const VIDEO = {moduleId: 'm1', sectionId: 's1', itemId: 'video1'};

const reviewItem = (overrides: Record<string, any> = {}) => ({
  _id: new ObjectId(ITEM_ID),
  userId: new ObjectId(STUDENT),
  courseId: new ObjectId(),
  courseVersionId: new ObjectId(),
  questionId: QUESTION_ID,
  quizId: QUIZ_ID,
  source: 'QUIZ_MISS',
  relatedVideo: VIDEO,
  repetitions: 0,
  easeFactor: 2.5,
  intervalDays: 1,
  nextReviewAt: new Date('2026-10-09T18:30:00Z'), // due since 00:00 IST today
  reviewCount: 0,
  lapses: 0,
  status: 'ACTIVE',
  ...overrides,
});

function buildService(
  options: {item?: any; question?: any; quiz?: any; dueItems?: any[]} = {},
) {
  const item = 'item' in options ? options.item : reviewItem();
  const question = 'question' in options ? options.question : storedQuestion();
  const quiz =
    'quiz' in options ? options.quiz : {details: {allowPartialGrading: false}};
  const reviewItemRepo = {
    findDueForUser: vi.fn(async () => options.dueItems ?? [item]),
    findOwnedById: vi.fn(async (id: string, userId: string) =>
      item && userId === STUDENT ? item : null,
    ),
    recordReview: vi.fn(async () => true),
  };
  const withoutExplanations = question && {
    ...question,
    correctLotItem: {...question.correctLotItem, explaination: undefined},
    incorrectLotItems: question.incorrectLotItems.map((o: any) => ({
      ...o,
      explaination: undefined,
    })),
  };
  const questionRepo = {
    getById: vi.fn(async () => question),
    getByIdWithoutExplanation: vi.fn(async () => withoutExplanations),
  };
  const quizRepo = {getById: vi.fn(async () => quiz)};
  const courseRepo = {
    read: vi.fn(async (_courseId: string) => ({
      name: 'Introduction to Machine Learning',
    })),
    readVersion: vi.fn(async () => ({
      modules: [
        {
          moduleId: 'm1',
          name: 'Basics',
          sections: [{sectionId: 's1', name: 'Week 1'}],
        },
      ],
    })),
  };
  const itemRepo = {
    readItem: vi.fn(async () => ({name: 'What is gradient descent?'})),
  };
  const service = new ReviewService(
    reviewItemRepo as any,
    questionRepo as any,
    quizRepo as any,
    courseRepo as any,
    itemRepo as any,
  );
  return {service, reviewItemRepo, questionRepo, courseRepo, itemRepo};
}

const answer = (
  lotItemId: ObjectId,
  confidence: 'SURE' | 'UNSURE' = 'SURE',
) => ({
  questionType: 'SELECT_ONE_IN_LOT',
  answer: {lotItemId: lotItemId.toString()},
  confidence,
});

describe('ReviewService.getDueReviews', () => {
  it('shows each due question as a quiz does, without answers or explanations', async () => {
    const {service, reviewItemRepo} = buildService();
    const [due] = await service.getDueReviews(STUDENT, {}, NOW);

    expect(reviewItemRepo.findDueForUser).toHaveBeenCalledWith(STUDENT, NOW, {
      courseVersionId: undefined,
      limit: 20,
    });
    expect(due).toMatchObject({
      reviewItemId: ITEM_ID,
      relatedVideo: VIDEO,
      repetitions: 0,
    });
    const shown = JSON.stringify(due.question);
    expect(shown).toContain('Gradient descent');
    expect(shown).toContain('Bagging');
    expect(shown).not.toContain('correctLotItem');
    expect(shown).not.toContain('negative gradient');
  });

  it('names the course and the video to rewatch, reading each only once', async () => {
    const versionId = new ObjectId();
    const {service, courseRepo, itemRepo} = buildService({
      dueItems: [
        reviewItem({courseVersionId: versionId}),
        reviewItem({_id: new ObjectId(), courseVersionId: versionId}),
      ],
    });
    const due = await service.getDueReviews(STUDENT, {}, NOW);

    expect(due).toHaveLength(2);
    expect(due[0]).toMatchObject({
      courseName: 'Introduction to Machine Learning',
      relatedVideo: {
        ...VIDEO,
        videoName: 'What is gradient descent?',
        moduleName: 'Basics',
        sectionName: 'Week 1',
      },
    });
    expect(courseRepo.readVersion).toHaveBeenCalledTimes(1);
    expect(itemRepo.readItem).toHaveBeenCalledTimes(1);
  });

  it('still returns a review when the video name cannot be read', async () => {
    const {service, itemRepo} = buildService();
    itemRepo.readItem.mockRejectedValueOnce(new Error('item deleted'));
    const [due] = await service.getDueReviews(STUDENT, {}, NOW);
    expect(due.relatedVideo).toMatchObject({...VIDEO, videoName: undefined});
  });

  it('returns question and option ids as plain strings a client can send back', async () => {
    const {service} = buildService();
    const [due] = await service.getDueReviews(STUDENT, {}, NOW);
    const question = due.question as {
      _id: unknown;
      lotItems: {_id: unknown}[];
    };
    expect(question._id).toBe(QUESTION_ID.toString());
    expect(question.lotItems.map(o => o._id).sort()).toEqual(
      [RIGHT_OPTION.toString(), WRONG_OPTION.toString()].sort(),
    );
  });

  it('grades an option id taken from the due list as correct', async () => {
    // Regression: ids used to reach the client as {buffer: ...} objects, so a
    // correct choice was always graded INCORRECT.
    const {service} = buildService();
    const [due] = await service.getDueReviews(STUDENT, {}, NOW);
    const shown = (due.question as {lotItems: {_id: string; text: string}[]})
      .lotItems;
    const chosen = shown.find(o => o.text === 'Gradient descent')!;
    const result = await service.answerReview(
      STUDENT,
      ITEM_ID,
      {
        questionType: 'SELECT_ONE_IN_LOT',
        answer: {lotItemId: chosen._id},
        confidence: 'SURE',
      },
      NOW,
    );
    expect(result.status).toBe('CORRECT');
  });

  it('skips items whose question was deleted', async () => {
    const {service} = buildService({question: null});
    expect(await service.getDueReviews(STUDENT, {}, NOW)).toEqual([]);
  });

  it('caps how many reviews are returned', async () => {
    const {service, reviewItemRepo} = buildService();
    await service.getDueReviews(STUDENT, {limit: 500}, NOW);
    expect(reviewItemRepo.findDueForUser).toHaveBeenCalledWith(STUDENT, NOW, {
      courseVersionId: undefined,
      limit: 50,
    });
  });
});

describe('ReviewService.answerReview', () => {
  it('grades a sure correct answer as quality 5 and schedules the next review', async () => {
    const {service, reviewItemRepo} = buildService();
    const result = await service.answerReview(
      STUDENT,
      ITEM_ID,
      answer(RIGHT_OPTION, 'SURE'),
      NOW,
    );

    expect(result).toMatchObject({
      status: 'CORRECT',
      quality: 5,
      intervalDays: 1,
      // Due from 00:00 IST on 11 Oct.
      nextReviewAt: new Date('2026-10-10T18:30:00Z'),
      relatedVideo: VIDEO,
      correctAnswer: {
        answers: ['Gradient descent'],
        explanations: ['It follows the negative gradient.'],
      },
    });
    expect(reviewItemRepo.recordReview).toHaveBeenCalledWith(ITEM_ID, STUDENT, {
      repetitions: 1,
      easeFactor: 2.6,
      intervalDays: 1,
      nextReviewAt: new Date('2026-10-10T18:30:00Z'),
      quality: 5,
      reviewedAt: NOW,
      isLapse: false,
    });
  });

  it('grows the interval for an item already reviewed twice', async () => {
    const {service} = buildService({
      item: reviewItem({repetitions: 2, easeFactor: 2.7, intervalDays: 6}),
    });
    const result = await service.answerReview(
      STUDENT,
      ITEM_ID,
      answer(RIGHT_OPTION, 'UNSURE'),
      NOW,
    );
    // round(6 * 2.7) = 16 days; "Unsure" is quality 3.
    expect(result).toMatchObject({quality: 3, intervalDays: 16});
  });

  it('restarts a wrong answer at 1 day and counts it as a lapse, even if the student was sure', async () => {
    const {service, reviewItemRepo} = buildService({
      item: reviewItem({repetitions: 3, easeFactor: 2.8, intervalDays: 16}),
    });
    const result = await service.answerReview(
      STUDENT,
      ITEM_ID,
      answer(WRONG_OPTION, 'SURE'),
      NOW,
    );
    expect(result).toMatchObject({
      status: 'INCORRECT',
      quality: 1,
      intervalDays: 1,
    });
    expect(reviewItemRepo.recordReview).toHaveBeenCalledWith(
      ITEM_ID,
      STUDENT,
      expect.objectContaining({repetitions: 0, easeFactor: 2.8, isLapse: true}),
    );
  });

  it("hides another student's review", async () => {
    const {service, reviewItemRepo} = buildService();
    await expect(
      service.answerReview(
        new ObjectId().toString(),
        ITEM_ID,
        answer(RIGHT_OPTION),
        NOW,
      ),
    ).rejects.toThrow(NotFoundError);
    expect(reviewItemRepo.recordReview).not.toHaveBeenCalled();
  });

  it('rejects a retired review', async () => {
    const {service} = buildService({item: reviewItem({status: 'RETIRED'})});
    await expect(
      service.answerReview(STUDENT, ITEM_ID, answer(RIGHT_OPTION), NOW),
    ).rejects.toThrow(NotFoundError);
  });

  it('rejects a review that is not due yet', async () => {
    const {service, reviewItemRepo} = buildService({
      item: reviewItem({nextReviewAt: new Date('2026-10-10T18:30:00Z')}),
    });
    await expect(
      service.answerReview(STUDENT, ITEM_ID, answer(RIGHT_OPTION), NOW),
    ).rejects.toThrow('This review is not due yet');
    expect(reviewItemRepo.recordReview).not.toHaveBeenCalled();
  });

  it('rejects an answer for a different question type', async () => {
    const {service} = buildService();
    await expect(
      service.answerReview(
        STUDENT,
        ITEM_ID,
        {...answer(RIGHT_OPTION), questionType: 'NUMERIC_ANSWER_TYPE'},
        NOW,
      ),
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects an answer of the wrong shape instead of failing with a server error', async () => {
    const {service, reviewItemRepo} = buildService();
    await expect(
      service.answerReview(
        STUDENT,
        ITEM_ID,
        {
          questionType: 'SELECT_ONE_IN_LOT',
          answer: {} as any,
          confidence: 'SURE',
        },
        NOW,
      ),
    ).rejects.toThrow(BadRequestError);
    expect(reviewItemRepo.recordReview).not.toHaveBeenCalled();
  });

  it('reports a question deleted since it was scheduled', async () => {
    const {service} = buildService({question: null});
    await expect(
      service.answerReview(STUDENT, ITEM_ID, answer(RIGHT_OPTION), NOW),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('ReviewService.getSummary', () => {
  it('adds course names, totals what is due and counts the next 14 days from tomorrow', async () => {
    const {service, reviewItemRepo, courseRepo} = buildService();
    const courseA = new ObjectId().toString();
    const courseB = new ObjectId().toString();
    (reviewItemRepo as any).countByCourseForUser = vi.fn(async () => [
      {
        courseId: courseA,
        courseVersionId: 'v1',
        due: 3,
        learning: 2,
        mastered: 1,
        nextDueAt: null,
      },
      {
        courseId: courseB,
        courseVersionId: 'v2',
        due: 1,
        learning: 0,
        mastered: 4,
        nextDueAt: null,
      },
    ]);
    (reviewItemRepo as any).countDueByDay = vi.fn(async () => [
      {date: '2026-10-11', count: 2},
    ]);
    courseRepo.read.mockImplementation(async (id: string) => ({
      name: id === courseA ? 'Course A' : 'Course B',
    }));

    const summary = await service.getSummary(STUDENT, NOW);

    expect(summary.totalDue).toBe(4);
    expect(summary.courses.map(c => [c.courseName, c.due])).toEqual([
      ['Course A', 3],
      ['Course B', 1],
    ]);
    expect(summary.upcoming).toEqual([{date: '2026-10-11', count: 2}]);
    expect((reviewItemRepo as any).countByCourseForUser).toHaveBeenCalledWith(
      STUDENT,
      NOW,
      21,
    );
    // From 00:00 IST on 11 Oct up to 00:00 IST on 25 Oct (14 days).
    expect((reviewItemRepo as any).countDueByDay).toHaveBeenCalledWith(
      STUDENT,
      new Date('2026-10-10T18:30:00Z'),
      new Date('2026-10-24T18:30:00Z'),
      'Asia/Kolkata',
    );
  });
});
