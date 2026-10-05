import 'reflect-metadata';
import {describe, expect, it} from 'vitest';
import {toRecallQuality} from '../utils/toRecallQuality.js';
import {isReviewableQuestion} from '../utils/isReviewableQuestion.js';
import {describeCorrectAnswer} from '../utils/describeCorrectAnswer.js';

describe('toRecallQuality', () => {
  it.each([
    ['CORRECT', 'SURE', 5],
    ['CORRECT', 'UNSURE', 3],
    ['PARTIAL', 'SURE', 2],
    ['PARTIAL', 'UNSURE', 2],
    ['INCORRECT', 'SURE', 1],
    ['INCORRECT', 'UNSURE', 1],
  ] as const)('maps %s + %s to quality %i', (status, confidence, quality) => {
    expect(toRecallQuality(status, confidence)).toBe(quality);
  });

  it('rejects an unknown status', () => {
    expect(() => toRecallQuality('SKIPPED' as never, 'SURE')).toThrow(
      RangeError,
    );
  });
});

describe('isReviewableQuestion', () => {
  const base = {
    type: 'SELECT_ONE_IN_LOT' as const,
    isParameterized: false,
  };

  it.each([
    'SELECT_ONE_IN_LOT',
    'SELECT_MANY_IN_LOT',
    'ORDER_THE_LOTS',
    'NUMERIC_ANSWER_TYPE',
  ] as const)('accepts %s questions', type => {
    expect(isReviewableQuestion({...base, type})).toBe(true);
  });

  it('accepts approved instructor and AI questions', () => {
    expect(
      isReviewableQuestion({
        ...base,
        source: 'AI_GENERATED',
        reviewStatus: 'APPROVED',
      }),
    ).toBe(true);
  });

  it.each([
    ['descriptive questions', {type: 'DESCRIPTIVE' as const}],
    ['parameterised questions', {isParameterized: true}],
    ['student-generated questions', {source: 'STUDENT_GENERATED' as const}],
    ['questions awaiting review', {reviewStatus: 'PENDING_REVIEW' as const}],
  ])('rejects %s', (_, override) => {
    expect(isReviewableQuestion({...base, ...override})).toBe(false);
  });

  it('rejects a missing question', () => {
    expect(isReviewableQuestion(null)).toBe(false);
    expect(isReviewableQuestion(undefined)).toBe(false);
  });
});

describe('describeCorrectAnswer', () => {
  const lot = (text: string, explaination = '') => ({text, explaination});

  it('gives the correct option and only its explanation for single choice', () => {
    expect(
      describeCorrectAnswer({
        type: 'SELECT_ONE_IN_LOT',
        correctLotItem: lot('Gradient descent', 'It minimises the loss.'),
      }),
    ).toEqual({
      answers: ['Gradient descent'],
      explanations: ['It minimises the loss.'],
    });
  });

  it('lists every correct option for multiple choice, skipping blank explanations', () => {
    expect(
      describeCorrectAnswer({
        type: 'SELECT_MANY_IN_LOT',
        correctLotItems: [lot('A', 'Because A.'), lot('C', '  ')],
      }),
    ).toEqual({answers: ['A', 'C'], explanations: ['Because A.']});
  });

  it('gives ordering answers in the correct order', () => {
    expect(
      describeCorrectAnswer({
        type: 'ORDER_THE_LOTS',
        ordering: [
          {order: 2, lotItem: lot('Train')},
          {order: 1, lotItem: lot('Collect data')},
          {order: 3, lotItem: lot('Evaluate')},
        ],
      }).answers,
    ).toEqual(['Collect data', 'Train', 'Evaluate']);
  });

  it('gives the exact value for a numeric answer with no tolerance', () => {
    expect(
      describeCorrectAnswer({
        type: 'NUMERIC_ANSWER_TYPE',
        value: 0.5,
        decimalPrecision: 2,
        lowerLimit: 0,
        upperLimit: 0,
      }),
    ).toEqual({answers: ['0.5'], explanations: []});
  });

  it('treats numeric limits as tolerances around the expected value, as the grader does', () => {
    // NATQuestionGrader accepts expected - lowerLimit .. expected + upperLimit.
    expect(
      describeCorrectAnswer({
        type: 'NUMERIC_ANSWER_TYPE',
        value: 3.14159,
        decimalPrecision: 2,
        lowerLimit: 0.01,
        upperLimit: 0.02,
      }).answers,
    ).toEqual(['3.14 (accepted from 3.13 to 3.16)']);
  });

  it('computes a numeric answer from its expression, which wins over the stored value', () => {
    expect(
      describeCorrectAnswer({
        type: 'NUMERIC_ANSWER_TYPE',
        expression: '2 * 3 + 1',
        value: 99,
        decimalPrecision: 0,
      }).answers,
    ).toEqual(['7']);
  });

  it('gives no numeric answer when neither value nor expression is usable', () => {
    expect(
      describeCorrectAnswer({type: 'NUMERIC_ANSWER_TYPE', expression: 'x +'})
        .answers,
    ).toEqual([]);
  });
});
