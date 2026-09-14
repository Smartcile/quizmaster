# How to Use Quiz Master — Illustrated Guide

A complete walkthrough of a quiz night, from an empty dashboard to the final scoreboard. Every step is shown with a real screenshot.

**Contents**

1. [Before you start](#1-before-you-start)
2. [Log in](#2-log-in)
3. [Add media (optional)](#3-add-media-optional)
4. [Build the question bank](#4-build-the-question-bank)
5. [Assemble rounds](#5-assemble-rounds)
6. [Build the quiz](#6-build-the-quiz)
7. [Theme it — Masters & Slides](#7-theme-it--masters--slides)
8. [Start the session & open the lobby](#8-start-the-session--open-the-lobby)
9. [Teams join](#9-teams-join)
10. [Run the quiz](#10-run-the-quiz)
11. [Who Am I?](#11-who-am-i)
12. [Review & lock a round](#12-review--lock-a-round)
13. [Reveal the answers](#13-reveal-the-answers)
14. [The scoreboard](#14-the-scoreboard)
15. [Marking answers (admin)](#15-marking-answers-admin)
16. [End the quiz & review history](#16-end-the-quiz--review-history)
17. [Widgets — rules, custom pages, answer review](#17-widgets--rules-custom-pages-answer-review)
18. [Test Quiz mode](#18-test-quiz-mode)

---

## 1. Before you start

Start the stack with Docker:

```bash
# Local (builds from source)
docker-compose up -d --build

# Production (pre-built images)
docker-compose -f docker-compose.prod.yml pull
docker-compose -f docker-compose.prod.yml up -d
```

Three surfaces come up:

| Surface | URL | Who uses it |
|---|---|---|
| Admin Dashboard | `http://your-host:3001` | You (the quiz master) |
| Slideshow Viewer | `http://your-host:3002` | The big screen / projector |
| Quizzer Portal | `http://your-host:3003` | Teams' phones |

The default admin password is `admin` — set `ADMIN_PASSWORD` in `.env` to change it.

> **Tip:** set `QUIZZER_URL` / `SLIDESHOW_URL` in `.env` to your public URLs (e.g. `https://answer.website.com`) so the join links and on-screen labels show the right address. Then `docker-compose up -d` to recreate the backend.

---

## 2. Log in

Open the Admin Dashboard (`:3001`) and enter your admin password.

![Admin login](images/admin-login.png)

You land on the **Dashboard**: a live-session card, question/round/quiz metrics, difficulty & category charts, and a list of every quiz.

![Admin dashboard](images/admin-dashboard.png)

---

## 3. Add media (optional)

If your quiz uses pictures, video or audio, upload them first in the **Media** tab. Files get usage labels (`QUESTION`, `SLIDE MASTER`) so you always know what's in use — deletion is blocked while a file is still referenced.

![Media library](images/admin-media.png)

The Media Library also has in-browser editors: **crop/resize** images, **trim + fade + normalise** audio (with a karaoke lyrics panel), and **trim** video — all saving as a new file or overwriting the original.

---

## 4. Build the question bank

Go to **Questions**. The left column is your searchable bank; the right column is the editor. Click any question to edit it, or **+ New** to start one.

![Question bank](images/admin-questions.png)

### Import a ready-made bank

Click **📥 Import CSV** to bulk-load questions. Duplicates (same question text) are detected and you choose **Overwrite / Ignore / Keep copy** per entry.

Or pull a pack straight from GitHub: **Settings → Question Repositories → + Add repository**, then **Sync**.

### Who / What Am I?

Set the **Kind** selector to *Who / What Am I?* — the editor becomes a numbered **clue list** (each clue has its own points, auto-set high → 1) plus one shared **Answer**. The longer teams wait, the fewer points are on offer.

![Who Am I editor](images/admin-questions-whoami.png)

---

## 5. Assemble rounds

Go to **Rounds** and click **+ Create Round** (or Edit an existing one). Drag questions from the left pool into the round on the right; drag back to remove; drag within the round to reorder.

![Rounds](images/admin-rounds.png)

Inside the round editor you can also:

- Set the **round colour** (the slideshow's round intro uses it)
- Switch any **🔀 T&M** ("Both" answer-mode) question to **Text** or **MCQ** *for this round*
- Switch any **🎵 NTS/FTL** audio question to **Name the Song** or **Finish the Lyrics** *for this round*

![Round editor](images/admin-rounds-edit.png)

---

## 6. Build the quiz

Go to **Quizzes**. Click a round chip to add it to the running order, then add **widgets** (Scoreboard, Rules, Custom Page, Answer Review). Drag tiles to interleave rounds and widgets freely — e.g. `Round 1 → Scoreboard → Round 2 → Scoreboard`.

![Quiz builder](images/admin-quizzes.png)

Other options on this page:

- **Master theme** dropdown — the visual style for the whole quiz (defaults to *Default Profile*)
- **Team size handicap** — gives smaller teams bonus starting points
- **Who / What Am I?** — attach one from the bottom section (one clue is revealed before each round)
- **⬇ Files** — downloads offline PDFs (answer sheet, questions & answers, marking form) plus a PowerPoint slideshow
- **Duplicate-question warning** — the Save button is disabled if a question appears twice anywhere in the quiz

---

## 7. Theme it — Masters & Slides

**Masters & Slides** defines the visual theme. Each master card can be edited, duplicated or deleted; the one marked **★ Default** is the standard for every quiz and can't be deleted.

![Masters](images/admin-masters.png)

The editor has two tabs:

- **Layout** — background colour/image, text styles (title/body/question/answer), and draggable placeholders
- **Slide Templates** — default content for intro / round / mark-answers / end / scoreboard / rules / custom slides

![Master editor](images/admin-masters-edit.png)

---

## 8. Start the session & open the lobby

Back on the **Dashboard**, click **▶ Start Session** on your quiz (or **🧪 Test Quiz** to run it with bots — see [section 18](#18-test-quiz-mode)).

![Start session](images/admin-dashboard-start.png)

The session starts in **lobby** mode. The Control page shows the join code, a live team counter and the portal quick-links.

![Control lobby](images/admin-control-lobby.png)

Open the two other surfaces now:

- **🖥 Display / Slideshow** — the big screen (also shown on the slideshow itself: big join code + QR)
- **📱 Quizzer Portal** — the link to share with teams (it's a deep link: `…/ABC123`)

---

## 9. Teams join

The slideshow lobby shows the giant join code and a QR code that opens the quizzer with the code pre-filled.

![Slideshow lobby](images/slideshow-lobby.png)

On their phones, teams enter the code (pre-filled from the link), their **team name** and **team size**, then tap **Join Quiz**.

![Quizzer join](images/quizzer-join.png)

They wait in the lobby until you begin. Team identity is remembered, so a refresh or lost connection rejoins the same team automatically.

![Quizzer waiting](images/quizzer-waiting.png)

> Joining is **find-or-create by team name** — if a team rejoins with the same name, they get their answers and scores back. In a finished session, entering the code opens a read-only review instead of creating a ghost team.

---

## 10. Run the quiz

Click **▶ Begin Quiz**. The slideshow flips to the first slide.

![Control active](images/admin-control-active.png)

Drive the show from the Control page:

- **Next → / ← Previous** buttons, or **keyboard/USB presenter** (`→`/`PageDown` forward, `←`/`PageUp` back)
- **All Slides** strip — grouped per module (Intro · Who Am I? · each round · widgets · End), click any thumbnail to jump
- **🔒 Lock Round Answers** — stops edits for the round (also happens automatically when you reveal the first answer)
- **📊 Scoreboard reveal toggles** — hide/reveal scores per surface for suspense

On the big screen:

| Intro | Round intro |
|---|---|
| ![Intro](images/slideshow-intro.png) | ![Round intro](images/slideshow-round.png) |

| Text question | Picture question |
|---|---|
| ![Question](images/slideshow-question.png) | ![Picture question](images/slideshow-question-image.png) |

**Audio questions never autoplay and never sound on phones.** On the big screen the host triggers playback — the first `Next` press on an unplayed media slide plays it instead of advancing (or use **▶ Play media / ⟳ Replay media**). The quizzer just shows a "Listen on the main screen" note.

![Audio question](images/slideshow-question-audio.png)

On the phones, the same slide appears as an answer box. Answers auto-save on every keystroke.

| Text answer | Multiple choice |
|---|---|
| ![Quizzer question](images/quizzer-question.png) | ![MCQ](images/quizzer-mcq.png) |

Teams can jump between the current round's questions with the round-nav bar at the bottom — the question you're showing on the big screen gets an **amber highlight**.

---

## 11. Who Am I?

If the quiz has a Who/What Am I?, a new clue appears on the slideshow **before each round**.

![Who Am I clue](images/slideshow-whoami.png)

Teams lock in **one guess** on their phone. The earlier they lock, the more points the clue is worth — and once locked, it can't be changed.

![Quizzer Who Am I](images/quizzer-whoami.png)

The shared answer is revealed on the final slide of the quiz.

---

## 12. Review & lock a round

After the last question of a round, `buildSlides` inserts a **Review Your Answers** slide. Teams see every answer they've given and can tap any question to edit it.

![Review answers](images/quizzer-review.png)

When you advance past this slide into the first answer reveal, the round is **locked automatically** — no more edits. (Unanswered questions are auto-scored 0 at that point so nothing is silently missing.)

---

## 13. Reveal the answers

Each answer slide shows the question and the correct answer on the big screen…

![Answer reveal](images/slideshow-answer.png)

…and on the phone the team sees their own answer with a score glow:

- **Green** — full marks
- **Yellow** — half marks
- **Red** — wrong or unanswered

| Full mark | Half mark |
|---|---|
| ![Reveal correct](images/quizzer-reveal.png) | ![Reveal half](images/quizzer-reveal-half.png) |

You can override any score at any time from **Mark Answers** (see [section 15](#15-marking-answers-admin)).

---

## 14. The scoreboard

Drop **Scoreboard** widgets anywhere in the quiz order. The scoreboard shows a column per round plus Starting (handicap), Bonus and Total, ranked 🥇🥈🥉.

![Slideshow scoreboard](images/slideshow-scoreboard.png)

On the phones the same scoreboard renders inline on the scoreboard slide.

![Quizzer scoreboard](images/quizzer-scoreboard.png)

And the host can show it on the Control screen itself with the **👁 This screen** toggle.

![Admin scoreboard](images/admin-control-scoreboard.png)

> The **🖥 Display** and **📱 Quizzers** toggles decide whether scores are revealed on the big screen / phones. Turn them off to land on the scoreboard slide with a "revealing shortly…" placeholder.

---

## 15. Marking answers (admin)

**Mark Answers** lists every question with each team's answer and the correct one. Click **0 / 0.5 / 1** to score; click the active value again to deselect it. Correct answers are auto-marked the moment they're submitted, so you usually only touch the edge cases.

![Answer marking](images/admin-marking.png)

A **Who Am I?** section appears per team when the quiz has one, letting you override the auto-marked guess.

---

## 16. End the quiz & review history

Click **⏹ End Quiz** (confirmation required) to finish. **↺ Restart Session** replays with the same teams and reset scores, or **⏸ Back to Lobby** lets more teams join mid-event.

**History** keeps every finished session with team scores, handicap, Who-Am-I points and a CSV download.

![Quiz history](images/admin-history.png)

---

## 17. Widgets — rules, custom pages, answer review

Widgets are just slides in the running order:

| Rules slide | Custom page (with image) |
|---|---|
| ![Rules](images/slideshow-rules.png) | ![Custom page](images/slideshow-custom.png) |

The **Answer Review** widget is special: on the quizzer it renders a per-team page listing every answer grouped by round **with the score awarded**, so teams can see exactly where their points came from. Tick **showOnScoreboard** when adding it to also put a **📝 View my answers** button on the quizzer's live scoreboard.

---

## 18. Test Quiz mode

Before the real thing, click **🧪 Test Quiz** next to *Start Session*. This opens the Control page with:

- Embedded **slideshow + quizzer previews** you can mirror or interact with
- A **bot engine** — bots join as teams (different sizes, so handicap scoring is exercised) and auto-answer as you advance slides
- **Auto-clean** — closing the test deletes the test session, teams and answers

Test sessions never appear as LIVE on the dashboard or in History.

![Settings](images/admin-settings.png)

Bot count/sizes, accuracy mixes, preview layout and auto-clean live in **Settings → Quiz Control & Testing**.

---

## Tips & troubleshooting

- **Join links show `localhost`** — set `QUIZZER_URL` / `SLIDESHOW_URL` in `.env` and recreate the backend (`docker-compose up -d`). Nothing is baked into the frontends.
- **502 after a redeploy** — restart the frontend containers so nginx re-resolves the backend IP (the shipped nginx configs do this per-request, but an old image won't).
- **A team refreshed / lost connection** — just rejoin with the same team name; answers and scores are restored automatically.
- **Slide index out of sync** — `buildSlides` must be identical in all three frontends; never edit one copy only.
- **Backups** — dump the database and back up the `backend_uploads` Docker volume together.
- **First-time login** — change `ADMIN_PASSWORD` and set a long random `JWT_SECRET` before exposing the dashboard.
