/**
 * Chooses which correctly answered questions to bring back as retention
 * checks after a student passes a quiz: up to `count` of them, at random,
 * skipping any the student is already reviewing.
 *
 * `random` returns a number in [0, 1); it is a parameter so tests can make
 * the choice deterministic.
 */
export function pickRetentionChecks(
  correctQuestionIds: string[],
  alreadyReviewing: ReadonlySet<string>,
  count: number,
  random: () => number = Math.random,
): string[] {
  const candidates = [...new Set(correctQuestionIds)].filter(
    id => !alreadyReviewing.has(id),
  );
  // Partial Fisher-Yates shuffle: only the first `count` places are needed.
  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const j = i + Math.floor(random() * (candidates.length - i));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  return candidates.slice(0, Math.max(0, count));
}
