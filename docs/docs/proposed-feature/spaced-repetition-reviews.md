---
title: Spaced Repetition Reviews
sidebar_position: 1
---

# Spaced Repetition Reviews

- **Author:** Anil Suthar S (internship project, Vicharanashala Lab)
- **Issue:** [#1047 feat: implement spaced repetition (SM-2) for post-course retention reviews](https://github.com/vicharanashala/vibe/issues/1047)
- **Code:** branch [`feat/spaced-repetition`](https://github.com/anilsutharr/vibe/tree/feat/spaced-repetition) on [anilsutharr/vibe](https://github.com/anilsutharr/vibe)
- **Status:** built and tested locally, behind the `ENABLE_SPACED_REPETITION` flag (off by default)

---

## What the feature is

When a student answers a quiz question wrongly, ViBe now brings that question back to them later, as a short **review**: first the next day, then after 6 days, then at longer and longer intervals as long as they keep getting it right. If they get it wrong again, it comes back the next day.

Students see what is due on their dashboard and in the sidebar, and answer their reviews on a new **Reviews** page. After each answer they see whether they were right, the correct answer with its explanation, when the question will come back, and which video to rewatch if they missed it.

The intervals are set by **SM-2**, the spaced repetition algorithm behind tools like Anki, implemented exactly as specified in issue #1047.

## Why it matters

- **Memory fades quickly after a lesson.** Without reinforcement, most of what a student learns is forgotten within days (the *forgetting curve*). Reviewing at growing intervals is one of the best-studied ways to make learning last.
- **It targets each student's weak spots.** Reviews are built from the questions *that student* got wrong, not from random questions, so a few minutes of review is spent where it helps most.
- **It fits ViBe's goal of real mastery.** Quizzes check understanding during a course; reviews keep checking it afterwards, so concepts are retained, not just passed.
- **It links practice back to teaching.** Each review knows the video that teaches the concept, so a student who misses a question is pointed straight at what to rewatch.
- **It costs nothing to run.** It reuses the course's existing questions and the existing quiz graders. There are no AI calls and no new external services.
- **It is safe.** Reviews are practice only: they never change quiz scores, course progress, HP points or the student's position in the course. The whole feature is behind a switch that is off by default.

## How it works

```text
 Student submits a quiz
          │
          ▼
 Existing quiz grader marks each question CORRECT / PARTIAL / INCORRECT
          │  (INCORRECT and PARTIAL questions)
          ▼
 A review item is created, due 00:00 IST the next day,
 linked to the video before the quiz
          │
          ▼
 Dashboard card + sidebar badge: "3 questions to review"
          │
          ▼
 Reviews page: student answers and says "I'm sure" or "Not sure"
          │
          ▼
 Same grader checks the answer ──► recall quality (5 / 3 / 2 / 1)
          │
          ▼
 SM-2 picks the next date: 1 day → 6 days → longer and longer,
 or back to 1 day after a miss
```

### Recall quality

The student's answer and how sure they were become an SM-2 quality score, following the issue's *Got it / Unsure / Missed it* = 5 / 3 / 1 mapping:

| Answer | "I'm sure" | "Not sure" |
|---|---|---|
| Correct | 5 | 3 |
| Partly correct | 2 | 2 |
| Wrong | 1 | 1 |

### SM-2

```text
if quality >= 3:
  interval = 1 on the first success, 6 on the second, else round(interval × EF)
  repetitions = repetitions + 1
  EF = max(1.3, EF + (0.1 − (5 − q) × (0.08 + (5 − q) × 0.02)))
else:
  repetitions = 0, interval = 1
next review = 00:00 IST, `interval` days later
```

Starting from EF = 2.5, a student who keeps answering correctly and sure sees a question again on **days 1, 7, 23, 68 and 199**. One who is always unsure sees it on days 1, 7, 20, 47 and 99.

## What I changed in the code

### Backend: new module `backend/src/modules/spacedRepetition/`

| File | What it does |
|---|---|
| `utils/applySm2.ts` | The SM-2 update as a pure function, exactly as specified in the issue |
| `utils/getNextReviewDate.ts` | Turns an interval into a due date at the start of an IST calendar day |
| `utils/toRecallQuality.ts` | Maps the graded answer and the student's confidence to a quality of 0–5 |
| `utils/isReviewableQuestion.ts` | Decides which questions can be reviewed (auto-graded, approved, not parameterised or crowd-sourced) |
| `utils/describeCorrectAnswer.ts` | Builds the correct answer and its explanation shown after answering, mirroring how each grader accepts answers |
| `services/ReviewSeedingService.ts` | Turns questions answered wrongly in a quiz into review items and finds the video to rewatch. Never throws |
| `services/ReviewService.ts` | Lists due reviews, grades answers with the existing quiz graders, applies SM-2, and builds the summary |
| `controllers/ReviewController.ts` | `GET /reviews/summary`, `GET /reviews/due`, `POST /reviews/:reviewItemId/answer` |
| `classes/validators/ReviewValidators.ts` | Request validation and OpenAPI documentation |
| `constants.ts`, `types.ts`, `container.ts`, `index.ts` | Settings, dependency injection and module wiring |
| `tests/*` | 79 tests: SM-2 tables, IST date boundaries, repository tests on an in-memory MongoDB, service tests |

New repository `shared/database/providers/mongo/repositories/ReviewItemRepository.ts` stores review items in a new `reviewItems` collection, one per student, question and course version, and counts them for the summary.

### Backend: changes to existing files

| File | Change |
|---|---|
| `modules/quizzes/services/AttemptService.ts` | After a quiz submission is graded and saved, calls `ReviewSeedingService` without waiting for it. The dependency is optional, so nothing breaks where the module is not loaded |
| `modules/quizzes/index.ts` | Loads the spaced repetition container with the quizzes module |
| `modules/quizzes/tests/AttemptService.peerQuestions.test.ts` | Passes the new constructor argument |
| `shared/interfaces/models.ts` | Adds `IReviewItem` and related types |
| `config/app.ts` | Adds the `ENABLE_SPACED_REPETITION` switch, off by default |

### Frontend

| File | What it does |
|---|---|
| `app/pages/student/ReviewsPage.tsx` (new) | The Reviews page: summary per course, the review session, results, rewatch hint, end-of-session summary |
| `components/reviews/ReviewAnswerInput.tsx` (new) | Answer controls for single choice, multiple choice, ordering and numeric questions |
| `components/reviews/ReviewsDueCard.tsx` (new) | The "Reviews due" dashboard card, shown only when something is due |
| `lib/api/reviews.ts`, `hooks/review-hooks.ts`, `types/review.types.ts` (new) | API calls, React Query hooks and types |
| `app/pages/student/dashboard.tsx` | Shows the Reviews due card |
| `components/student-sidebar/nav-items.tsx`, `StudentSidebar.tsx` | Adds the Reviews item with the number due, hidden when the feature is off |
| `app/routes/router.tsx` | Adds the `/student/reviews` route |

### Docs

A Module Breakdown page, *8. Spaced Repetition*, under System Design & Architecture, and this page.

## API

All routes need a signed-in student, only act on that student's own reviews, and return 404 while the feature is switched off.

| Route | Purpose |
|---|---|
| `GET /reviews/summary` | Reviews due now, learning and mastered counts per course, and reviews due on each of the next 14 days |
| `GET /reviews/due` | The due questions, shown as in a quiz without their answers, with the course and video names |
| `POST /reviews/:reviewItemId/answer` | Grades the answer, schedules the next review and returns the result |

## Design decisions

- **Can never break a quiz submission.** Scheduling runs after the submission is saved, is not awaited, and catches every error.
- **Practice only.** Answers are graded with the same graders as the quiz, including partial-grading settings, but no quiz attempt is created.
- **No answer leaks.** Due questions are loaded without option explanations; the correct answer is only returned after answering.
- **No duplicates.** Missing a question again restarts the existing review instead of adding a second one.
- **Switched off by default.** `ENABLE_SPACED_REPETITION=true` turns on scheduling, the API and the pages; while it is off, the frontend hides the feature.

## Testing

- **79 automated tests** for the new module, all passing. The quizzes test suite and the frontend type check have exactly the same pre-existing failures with and without this work.
- **Tested end to end locally** with the Firebase emulator and a local MongoDB: a student took quizzes in the browser, wrong answers became reviews linked to the right videos, and answering them on the Reviews page rescheduled them correctly.
- Two bugs were found and fixed during testing: option ids reaching the browser in a form the grader could not match (every answer was graded wrong), and numeric answers being described with the wrong range. Both have regression tests.

## How to try it

1. Run ViBe locally (see *Local Setup on Windows* under Getting Started) with `ENABLE_SPACED_REPETITION=true` in `backend/.env`.
2. As a teacher, add a quiz after a video in a course; as a student, take it and answer some questions wrongly.
3. The next day (or after moving the review dates forward in a local database), open the dashboard: the Reviews due card and the sidebar badge appear. Click **Start reviewing**.

## Demo video

A one-minute silent demo recorded on a local setup: the dashboard card and sidebar badge, answering three due reviews (correct and sure, wrong, correct but unsure), the rewatch hint after a miss, the end-of-session summary, and the dashboard once nothing is due.

<video controls width="100%" src={require('./spaced-repetition-demo.mp4').default} />

[Download or open the demo video (spaced-repetition-demo.mp4)](./spaced-repetition-demo.mp4)

## Limitations and future work

- **Rewatch names the video but does not open it.** The course page always resumes from the student's own progress, so the Reviews page shows the video's name and where it is in the course.
- **No reminders.** Students see due reviews when they open ViBe; email or in-app reminders with an opt-out could be added later.
- **Course-completion top-up.** Adding questions from the course's question bank when a student finishes a course is left for later.
- **Question types.** Descriptive, parameterised and crowd-sourced questions are not reviewed yet.
