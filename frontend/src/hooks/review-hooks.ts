import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';
import {
  answerReview,
  getDueReviews,
  getReviewSummary,
  ReviewApiError,
} from '@/lib/api/reviews';
import type {AnswerReviewInput} from '@/types/review.types';

const reviewKeys = {
  all: ['reviews'] as const,
  summary: ['reviews', 'summary'] as const,
  due: ['reviews', 'due'] as const,
};

/**
 * Review counts for the dashboard, sidebar and Reviews page.
 *
 * `isAvailable` is false when the server has reviews switched off (404), so
 * callers can hide the feature instead of showing an error.
 */
export function useReviewSummary(enabled = true) {
  const query = useQuery({
    queryKey: reviewKeys.summary,
    queryFn: getReviewSummary,
    enabled,
    staleTime: 60_000,
    // A 404 means "feature off", not a transient failure worth retrying.
    retry: (count, error) =>
      !(error instanceof ReviewApiError && error.status === 404) && count < 2,
  });
  const isDisabled =
    query.error instanceof ReviewApiError && query.error.status === 404;
  return {...query, isAvailable: query.isSuccess && !isDisabled};
}

/**
 * The due reviews for one session. Not refetched in the background, so the
 * list does not change while the student is working through it.
 */
export function useDueReviews(enabled = true) {
  return useQuery({
    queryKey: reviewKeys.due,
    queryFn: () => getDueReviews(20),
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useAnswerReview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      reviewItemId,
      input,
    }: {
      reviewItemId: string;
      input: AnswerReviewInput;
    }) => answerReview(reviewItemId, input),
    onSuccess: () => {
      // Counts changed; the due list is kept until the session ends.
      queryClient.invalidateQueries({queryKey: reviewKeys.summary});
    },
  });
}

/** Starts a fresh session: refetches what is due now. */
export function useRefreshReviews() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({queryKey: reviewKeys.all});
}
