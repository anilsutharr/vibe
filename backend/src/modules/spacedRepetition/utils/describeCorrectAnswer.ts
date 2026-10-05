import {evaluate} from 'mathjs';
import {ILotItem} from '#shared/interfaces/quiz.js';

/** The parts of a stored question that hold its correct answer. */
export interface QuestionSolutionFields {
  type: string;
  correctLotItem?: ILotItem;
  correctLotItems?: ILotItem[];
  ordering?: {lotItem: ILotItem; order: number}[];
  value?: number;
  expression?: string;
  decimalPrecision?: number;
  /** Numeric tolerance below the expected value (not a lower bound). */
  lowerLimit?: number;
  /** Numeric tolerance above the expected value (not an upper bound). */
  upperLimit?: number;
}

export interface CorrectAnswerSummary {
  /** The correct option(s) in order, or the accepted numeric answer. */
  answers: string[];
  /** Explanations the instructor wrote for the correct option(s). */
  explanations: string[];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The expected numeric answer, computed the way NATQuestionGrader does: the
 * expression wins over the stored value, rounded to the question's precision.
 * Only non-parameterised questions are reviewed, so the expression needs no
 * parameter values.
 */
function expectedNumber(question: QuestionSolutionFields): number | undefined {
  const decimals = question.decimalPrecision ?? 0;
  if (question.expression) {
    try {
      const result = evaluate(question.expression);
      return typeof result === 'number' ? round(result, decimals) : undefined;
    } catch {
      return undefined;
    }
  }
  return typeof question.value === 'number'
    ? round(question.value, decimals)
    : undefined;
}

function describeNumber(question: QuestionSolutionFields): string | undefined {
  const expected = expectedNumber(question);
  if (expected === undefined) {
    return undefined;
  }
  const below = question.lowerLimit ?? 0;
  const above = question.upperLimit ?? 0;
  if (below === 0 && above === 0) {
    return String(expected);
  }
  const decimals = question.decimalPrecision ?? 0;
  // Rounded so floating-point noise (e.g. 2.9000000000000004) never shows.
  const low = round(expected - below, decimals + 6);
  const high = round(expected + above, decimals + 6);
  return `${expected} (accepted from ${low} to ${high})`;
}

/**
 * Describes a question's correct answer for showing to a student after they
 * answer a review. Only the correct option's explanation is included; the
 * explanations of wrong options are left out.
 */
export function describeCorrectAnswer(
  question: QuestionSolutionFields,
): CorrectAnswerSummary {
  let items: ILotItem[] = [];
  switch (question.type) {
    case 'SELECT_ONE_IN_LOT':
      items = question.correctLotItem ? [question.correctLotItem] : [];
      break;
    case 'SELECT_MANY_IN_LOT':
      items = question.correctLotItems ?? [];
      break;
    case 'ORDER_THE_LOTS':
      items = [...(question.ordering ?? [])]
        .sort((a, b) => a.order - b.order)
        .map(o => o.lotItem);
      break;
    case 'NUMERIC_ANSWER_TYPE': {
      const answer = describeNumber(question);
      return {answers: answer ? [answer] : [], explanations: []};
    }
    default:
      return {answers: [], explanations: []};
  }
  return {
    answers: items.map(item => item.text),
    explanations: items
      .map(item => item.explaination?.trim())
      .filter((text): text is string => Boolean(text)),
  };
}
