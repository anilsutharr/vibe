import type {
  AnswerReviewInput,
  CourseReviewInsights,
  DueReview,
  ReviewAnswerResult,
  ReviewSummary,
} from '@/types/review.types';

/**
 * Spaced repetition review endpoints (#1047).
 *
 * Hand-rolled rather than going through the typed `api` client, for the same
 * reason as lib/api/share-links.ts: regenerating schema.ts would delete
 * existing types.
 */
const BASE_URL = `${import.meta.env.VITE_BASE_URL}/reviews`;

function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem('firebase-auth-token');
  return {
    'Content-Type': 'application/json',
    ...(token ? {Authorization: `Bearer ${token}`} : {}),
  };
}

/** An error from the reviews API, keeping the HTTP status. */
export class ReviewApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...options,
      headers: {...getAuthHeaders(), ...(options?.headers || {})},
      credentials: 'include',
    });
  } catch {
    throw new ReviewApiError(
      `Could not reach the ViBe server at ${import.meta.env.VITE_BASE_URL}. Check that it is running.`,
      0,
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ReviewApiError(
      body.message || `Request failed (${res.status})`,
      res.status,
    );
  }
  return res.json();
}

/**
 * Due counts per course and for the coming days. A 404 means reviews are
 * switched off on this server; callers use that to hide the feature.
 */
export function getReviewSummary(): Promise<ReviewSummary> {
  return apiFetch<ReviewSummary>(`${BASE_URL}/summary`);
}

export async function getDueReviews(limit = 20): Promise<DueReview[]> {
  const {reviews} = await apiFetch<{reviews: DueReview[]}>(
    `${BASE_URL}/due?limit=${limit}`,
  );
  return reviews;
}

export function answerReview(
  reviewItemId: string,
  input: AnswerReviewInput,
): Promise<ReviewAnswerResult> {
  return apiFetch<ReviewAnswerResult>(
    `${BASE_URL}/${encodeURIComponent(reviewItemId)}/answer`,
    {method: 'POST', body: JSON.stringify(input)},
  );
}

/** Instructor view: what students of a course version miss and forget. */
export function getCourseReviewInsights(
  courseId: string,
  versionId: string,
): Promise<CourseReviewInsights> {
  return apiFetch<CourseReviewInsights>(
    `${BASE_URL}/insights/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(versionId)}`,
  );
}
