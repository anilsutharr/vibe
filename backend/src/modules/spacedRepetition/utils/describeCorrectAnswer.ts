import {ILotItem} from '#shared/interfaces/quiz.js';

/** The parts of a stored question that hold its correct answer. */
export interface QuestionSolutionFields {
  type: string;
  correctLotItem?: ILotItem;
  correctLotItems?: ILotItem[];
  ordering?: {lotItem: ILotItem; order: number}[];
  value?: number;
  lowerLimit?: number;
  upperLimit?: number;
}

export interface CorrectAnswerSummary {
  /** The correct option(s) in order, or the accepted numeric answer. */
  answers: string[];
  /** Explanations the instructor wrote for the correct option(s). */
  explanations: string[];
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
      const {value, lowerLimit, upperLimit} = question;
      const answer =
        value !== undefined && value !== null
          ? String(value)
          : lowerLimit !== undefined && upperLimit !== undefined
            ? `${lowerLimit} to ${upperLimit}`
            : undefined;
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
