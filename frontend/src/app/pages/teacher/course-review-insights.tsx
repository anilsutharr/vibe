import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeft, PlayCircle, Repeat } from "lucide-react";
import MathRenderer from "@/components/math-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCourseStore } from "@/store/course-store";
import { useCourseReviewInsights } from "@/hooks/review-hooks";
import { ReviewApiError } from "@/lib/api/reviews";
import { cn, preprocessMathContent } from "@/utils/utils";
import type { QuestionInsight } from "@/types/review.types";

function formatRate(rate: number | null) {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function rateTone(rate: number | null) {
  if (rate === null) return "bg-muted";
  if (rate < 0.5) return "bg-red-500";
  if (rate < 0.75) return "bg-amber-500";
  return "bg-emerald-500";
}

/**
 * Instructor view of spaced repetition reviews (#1047): which questions
 * students get wrong in quizzes and then keep forgetting, and which video
 * teaches each one.
 */
export default function CourseReviewInsightsPage() {
  const navigate = useNavigate();
  const currentCourse = useCourseStore(state => state.currentCourse);
  const courseId = currentCourse?.courseId || "";
  const versionId = currentCourse?.versionId || "";
  const insights = useCourseReviewInsights(courseId, versionId);

  useEffect(() => {
    if (!courseId || !versionId) {
      navigate({ to: "/teacher/courses/enrollments" });
    }
  }, [courseId, versionId, navigate]);

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        className="flex items-center gap-2"
        onClick={() => navigate({ to: "/teacher/courses/enrollments" })}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Enrollments
      </Button>

      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Repeat className="h-5 w-5 text-primary" />
            Review Insights
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            What students keep forgetting. Questions answered wrongly in quizzes come back as spaced repetition
            reviews; the ones still forgotten in reviews may need a clearer explanation or video.
          </p>
        </CardHeader>
        <CardContent>
          {insights.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-48 w-full" />
            </div>
          ) : insights.isError ? (
            <InsightsError error={insights.error} />
          ) : insights.data!.totals.students === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No review data yet. Reviews start when students get quiz questions wrong, or after they pass a quiz.
            </p>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="Students reviewing" value={insights.data!.totals.students} />
                <Stat label="Questions in review" value={insights.data!.totals.questions} />
                <Stat label="Review answers" value={insights.data!.totals.reviews} />
                <Stat
                  label="Remembered"
                  value={formatRate(insights.data!.totals.recallRate)}
                  hint="Share of review answers that were right"
                />
              </div>

              <div>
                <h3 className="mb-1 text-sm font-semibold">Most forgotten questions</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Ranked by wrong answers in reviews, then by students who missed them in the quiz.
                </p>
                <ol className="grid gap-2">
                  {insights.data!.questions.map((question, index) => (
                    <QuestionRow key={question.questionId} rank={index + 1} question={question} />
                  ))}
                </ol>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="rounded-xl border p-4" title={hint}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function QuestionRow({ rank, question }: { rank: number; question: QuestionInsight }) {
  const video = question.relatedVideo;
  const where = [video?.moduleName, video?.sectionName].filter(Boolean).join(" › ");
  return (
    <li className="rounded-xl border p-4">
      <div className="flex gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums">
          {rank}
        </span>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="text-sm font-medium break-words">
            <MathRenderer>{preprocessMathContent(question.questionText)}</MathRenderer>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground tabular-nums">
            <span>
              <strong className="text-foreground">{question.missedInQuiz}</strong> missed in quiz
            </span>
            <span>
              <strong className="text-foreground">{question.forgotten}</strong> forgotten in review
            </span>
            <span>
              <strong className="text-foreground">{question.reviews}</strong> review answers
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
              <div
                className={cn("h-full rounded-full", rateTone(question.recallRate))}
                style={{ width: `${Math.round((question.recallRate ?? 0) * 100)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {question.recallRate === null ? "Not reviewed yet" : `${formatRate(question.recallRate)} remembered`}
            </span>
          </div>
          {video && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PlayCircle className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate">
                Taught in: {video.videoName ?? "the video before the quiz"}
                {where && ` (${where})`}
              </span>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

function InsightsError({ error }: { error: Error }) {
  const status = error instanceof ReviewApiError ? error.status : undefined;
  const message =
    status === 404
      ? "Spaced repetition reviews are switched off on this server, or this course version was not found."
      : status === 403
        ? "Only this course's instructors and admins can see its review insights."
        : error.message;
  return <p className="py-10 text-center text-sm text-muted-foreground">{message}</p>;
}
