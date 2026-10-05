import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowRight,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  CircleDashed,
  Lightbulb,
  Loader2,
  PlayCircle,
  Repeat,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import MathRenderer from "@/components/math-renderer";
import { ReviewAnswerInput } from "@/components/reviews/ReviewAnswerInput";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, preprocessMathContent } from "@/utils/utils";
import {
  useAnswerReview,
  useDueReviews,
  useRefreshReviews,
  useReviewSummary,
} from "@/hooks/review-hooks";
import type {
  DueReview,
  RelatedVideo,
  ReviewAnswer,
  ReviewAnswerResult,
  ReviewConfidence,
  ReviewSummary,
} from "@/types/review.types";

const panel =
  "rounded-3xl border border-neutral-200/70 bg-white p-6 shadow-sm ring-1 ring-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.03] dark:ring-white/[0.04] sm:p-7";

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function describeInterval(days: number) {
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/**
 * Spaced repetition reviews (#1047): questions the student got wrong in
 * quizzes, brought back at growing intervals. Practice only; answers here
 * never change quiz scores or course progress.
 */
export default function ReviewsPage() {
  const summary = useReviewSummary();
  const due = useDueReviews(summary.isAvailable);
  const refresh = useRefreshReviews();

  if (summary.isLoading) {
    return (
      <div className="space-y-4">
        <ReviewsHeader />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <Skeleton className="h-72 w-full rounded-3xl" />
      </div>
    );
  }

  if (!summary.isAvailable) {
    return (
      <div className="space-y-4">
        <ReviewsHeader />
        <section className={cn(panel, "text-center")}>
          <Repeat className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
          <p className="font-semibold">Reviews aren't available yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.error && !(summary.error as { status?: number }).status
              ? summary.error.message
              : "Your institution hasn't switched on spaced repetition reviews."}
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ReviewsHeader />
      <SummaryPanel summary={summary.data!} />
      {due.isLoading ? (
        <Skeleton className="h-72 w-full rounded-3xl" />
      ) : due.isError ? (
        <section className={cn(panel, "text-center")}>
          <p className="font-semibold">Couldn't load your reviews</p>
          <p className="mt-1 text-sm text-muted-foreground">{due.error.message}</p>
          <Button className="mt-4 rounded-xl" onClick={() => refresh()}>
            Try again
          </Button>
        </section>
      ) : (
        <ReviewSession
          key={due.dataUpdatedAt}
          reviews={due.data ?? []}
          summary={summary.data!}
          onRestart={() => refresh()}
        />
      )}
    </div>
  );
}

function ReviewsHeader() {
  return (
    <PageHeader
      title="Reviews"
      description="Questions you missed in quizzes come back at growing intervals, so what you learn stays learned."
    />
  );
}

function SummaryPanel({ summary }: { summary: ReviewSummary }) {
  if (summary.courses.length === 0) {
    return null;
  }
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Due today</p>
          <p className="text-3xl font-bold tabular-nums">{summary.totalDue}</p>
        </div>
        <p className="text-xs text-muted-foreground">
          Mastered means you'll next see it 3 weeks or more from now.
        </p>
      </div>
      <ul className="mt-4 grid gap-2">
        {summary.courses.map(course => (
          <li
            key={course.courseVersionId}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-neutral-200/70 bg-neutral-50/60 px-4 py-3 dark:border-white/[0.06] dark:bg-white/[0.03]"
          >
            <span className="flex min-w-0 flex-1 items-center gap-2 text-sm font-medium">
              <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{course.courseName ?? "Course"}</span>
            </span>
            <span className="flex flex-wrap gap-2 text-xs tabular-nums">
              <Badge variant={course.due > 0 ? "default" : "secondary"}>{course.due} due</Badge>
              <Badge variant="secondary">{course.learning} learning</Badge>
              <Badge variant="outline">{course.mastered} mastered</Badge>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ReviewSession({
  reviews,
  summary,
  onRestart,
}: {
  reviews: DueReview[];
  summary: ReviewSummary;
  onRestart: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);

  if (reviews.length === 0 || index >= reviews.length) {
    return (
      <CaughtUp
        reviewed={index}
        correct={correctCount}
        upcoming={summary.upcoming}
        hasAnyReviews={summary.courses.length > 0}
        onRestart={onRestart}
      />
    );
  }

  return (
    <ReviewCard
      key={reviews[index].reviewItemId}
      review={reviews[index]}
      position={index + 1}
      total={reviews.length}
      onAnswered={result => result.status === "CORRECT" && setCorrectCount(c => c + 1)}
      onNext={() => setIndex(i => i + 1)}
    />
  );
}

function ReviewCard({
  review,
  position,
  total,
  onAnswered,
  onNext,
}: {
  review: DueReview;
  position: number;
  total: number;
  onAnswered: (result: ReviewAnswerResult) => void;
  onNext: () => void;
}) {
  const [answer, setAnswer] = useState<ReviewAnswer | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [result, setResult] = useState<ReviewAnswerResult | null>(null);
  const answerMutation = useAnswerReview();
  const { question } = review;

  const submit = (confidence: ReviewConfidence) => {
    if (!answer) {
      return;
    }
    answerMutation.mutate(
      {
        reviewItemId: review.reviewItemId,
        input: { questionType: question.type, answer, confidence },
      },
      {
        onSuccess: data => {
          setResult(data);
          onAnswered(data);
        },
        onError: error => toast.error(error.message || "Couldn't save your answer. Please try again."),
      },
    );
  };

  return (
    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="truncate">{review.courseName ?? "Course"}</span>
        <span className="tabular-nums">
          Question {position} of {total}
        </span>
      </div>
      <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${((position - (result ? 0 : 1)) / total) * 100}%` }}
        />
      </div>

      <h2 className="whitespace-pre-wrap text-lg font-semibold leading-snug">
        <MathRenderer>{preprocessMathContent(question.text.replace(/\\n/g, "\n"))}</MathRenderer>
      </h2>

      {question.hint && !result && (
        <div className="mt-3">
          {showHint ? (
            <p className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
              <strong>Hint:</strong> <MathRenderer>{preprocessMathContent(question.hint)}</MathRenderer>
            </p>
          ) : (
            <Button variant="ghost" size="sm" className="gap-1.5 px-2" onClick={() => setShowHint(true)}>
              <Lightbulb className="h-4 w-4" />
              Show hint
            </Button>
          )}
        </div>
      )}

      <div className="mt-5">
        <ReviewAnswerInput
          question={question}
          disabled={!!result || answerMutation.isPending}
          onChange={setAnswer}
        />
      </div>

      {result ? (
        <ReviewResult result={result} onNext={onNext} isLast={position === total} />
      ) : (
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <p className="text-xs text-muted-foreground sm:mr-auto">
            {answer ? "How sure are you?" : "Choose your answer, then say how sure you are."}
          </p>
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!answer || answerMutation.isPending}
            onClick={() => submit("UNSURE")}
          >
            Not sure
          </Button>
          <Button
            className="gap-1.5 rounded-xl"
            disabled={!answer || answerMutation.isPending}
            onClick={() => submit("SURE")}
          >
            {answerMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            I'm sure
          </Button>
        </div>
      )}
    </section>
  );
}

const RESULT_STYLE = {
  CORRECT: {
    label: "Correct",
    icon: CheckCircle2,
    className: "border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-700 dark:text-emerald-300",
  },
  PARTIAL: {
    label: "Partly correct",
    icon: CircleDashed,
    className: "border-amber-500/30 bg-amber-500/[0.06] text-amber-700 dark:text-amber-300",
  },
  INCORRECT: {
    label: "Not quite",
    icon: XCircle,
    className: "border-red-500/30 bg-red-500/[0.06] text-red-700 dark:text-red-300",
  },
} as const;

function ReviewResult({
  result,
  onNext,
  isLast,
}: {
  result: ReviewAnswerResult;
  onNext: () => void;
  isLast: boolean;
}) {
  const style = RESULT_STYLE[result.status];
  const Icon = style.icon;
  const { answers, explanations } = result.correctAnswer;

  return (
    <div className="mt-6 space-y-3">
      <div className={cn("rounded-2xl border p-4", style.className)}>
        <p className="flex items-center gap-2 font-semibold">
          <Icon className="h-5 w-5" />
          {style.label}
        </p>
        {answers.length > 0 && (
          <div className="mt-2 text-sm text-foreground">
            <span className="font-medium">Correct answer: </span>
            {answers.length === 1 ? (
              <MathRenderer>{preprocessMathContent(answers[0])}</MathRenderer>
            ) : (
              <ol className="mt-1 list-decimal space-y-0.5 pl-5">
                {answers.map(text => (
                  <li key={text}>
                    <MathRenderer>{preprocessMathContent(text)}</MathRenderer>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        {explanations.map(text => (
          <p key={text} className="mt-2 text-sm text-muted-foreground">
            <MathRenderer>{preprocessMathContent(text)}</MathRenderer>
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 shrink-0" />
          You'll see this again {describeInterval(result.intervalDays)} ({formatDay(result.nextReviewAt)}).
        </p>
        <Button className="gap-1.5 rounded-xl" onClick={onNext}>
          {isLast ? "Finish" : "Next question"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>

      {result.relatedVideo && result.status !== "CORRECT" && (
        <RewatchHint video={result.relatedVideo} />
      )}
    </div>
  );
}

/**
 * Points the student at the lesson that teaches this question. The course
 * page always resumes from the student's own progress, so this names the
 * video instead of jumping straight to it.
 */
function RewatchHint({ video }: { video: RelatedVideo }) {
  const navigate = useNavigate();
  const where = [video.moduleName, video.sectionName].filter(Boolean).join(" › ");
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200/70 bg-neutral-50/60 p-4 sm:flex-row sm:items-center dark:border-white/[0.06] dark:bg-white/[0.03]">
      <PlayCircle className="h-6 w-6 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Rewatch: {video.videoName ?? "the video before this quiz"}</p>
        {where && <p className="truncate text-xs text-muted-foreground">{where}</p>}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="rounded-xl"
        onClick={() => navigate({ to: "/student/courses" })}
      >
        Go to my courses
      </Button>
    </div>
  );
}

function CaughtUp({
  reviewed,
  correct,
  upcoming,
  hasAnyReviews,
  onRestart,
}: {
  reviewed: number;
  correct: number;
  upcoming: ReviewSummary["upcoming"];
  hasAnyReviews: boolean;
  onRestart: () => void;
}) {
  const nextDays = useMemo(() => upcoming.slice(0, 7), [upcoming]);

  return (
    <section className={panel}>
      <div className="text-center">
        <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-primary" />
        {reviewed > 0 ? (
          <>
            <p className="text-lg font-semibold">Session complete</p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              You got {correct} of {reviewed} right.
            </p>
          </>
        ) : hasAnyReviews ? (
          <>
            <p className="text-lg font-semibold">You're all caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">Nothing is due right now.</p>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">No reviews yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              When you get a quiz question wrong, it will come back here the next day, then less and less often as
              you get it right.
            </p>
          </>
        )}
      </div>

      {nextDays.length > 0 && (
        <div className="mx-auto mt-6 max-w-sm">
          <p className="mb-2 text-xs font-semibold text-muted-foreground">Coming up</p>
          <ul className="grid gap-1.5">
            {nextDays.map(day => (
              <li
                key={day.date}
                className="flex items-center justify-between rounded-xl border border-neutral-200/70 px-3 py-2 text-sm dark:border-white/[0.06]"
              >
                <span>{formatDay(`${day.date}T00:00:00+05:30`)}</span>
                <span className="tabular-nums text-muted-foreground">
                  {day.count} review{day.count === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {reviewed > 0 && (
        <div className="mt-6 text-center">
          <Button variant="outline" className="rounded-xl" onClick={onRestart}>
            Check for more
          </Button>
        </div>
      )}
    </section>
  );
}
