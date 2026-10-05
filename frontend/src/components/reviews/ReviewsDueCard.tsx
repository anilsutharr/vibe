import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useReviewSummary } from "@/hooks/review-hooks";

/**
 * Dashboard nudge for spaced repetition reviews (#1047). Renders nothing
 * unless reviews are switched on and at least one is due.
 */
export function ReviewsDueCard() {
  const navigate = useNavigate();
  const { data, isAvailable } = useReviewSummary();

  if (!isAvailable || !data || data.totalDue === 0) {
    return null;
  }

  const courseCount = data.courses.filter(course => course.due > 0).length;

  return (
    <section className="flex flex-col gap-4 rounded-3xl border border-neutral-200/70 bg-white p-5 shadow-sm ring-1 ring-black/[0.02] sm:flex-row sm:items-center sm:justify-between sm:p-6 dark:border-white/[0.06] dark:bg-white/[0.03] dark:ring-white/[0.04]">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <Repeat className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">Reviews due</p>
          <p className="text-base font-bold text-foreground">
            {data.totalDue} question{data.totalDue === 1 ? "" : "s"} to review
            {courseCount > 1 ? ` across ${courseCount} courses` : ""}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A few minutes now helps you remember what you learned.
          </p>
        </div>
      </div>
      <Button
        className="shrink-0 gap-1.5 rounded-xl"
        onClick={() => navigate({ to: "/student/reviews" })}
      >
        Start reviewing
        <ArrowRight className="h-4 w-4" />
      </Button>
    </section>
  );
}
