# Slide & Master Data Model

## Overview

The slide system uses two tables: **`slide_masters`** and **`slides`**. Their responsibilities are strictly separated — a master owns the visual frame and slide-type defaults, a slide owns only the Fabric.js content typed into that frame.

Quizzes can optionally reference a master via `quizzes.master_id`. When they do, the QuizBuilder presents the master's custom pages as pre-filled widget options.

---

## Tables

### `slide_masters` — the visual template

A master defines everything that is *shared* across all slides that use it.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(255) | Human label (e.g. "Quiz Night Default") |
| `background_color` | VARCHAR(7) | Hex colour, e.g. `#1a1a2e` |
| `background_image_url` | VARCHAR(500) | Path to a background image (optional) |
| `styles` | JSONB | Named text style definitions (see below) |
| `placeholders` | JSONB | Array of positioned placeholder boxes (see below) |
| `templates` | JSONB | Per-slide-type content defaults (see below) |
| `created_at` / `updated_at` | TIMESTAMP | |

#### `styles` JSONB shape

A flat object keyed by style name. Common names: `"title"`, `"body"`, `"answer"`, `"question"`.

```json
{
  "title": {
    "fontFamily": "Inter, sans-serif",
    "fontSize": 64,
    "color": "#00f0ff",
    "fontWeight": "bold"
  },
  "body": {
    "fontFamily": "Inter, sans-serif",
    "fontSize": 32,
    "color": "#e8efff",
    "fontWeight": "normal"
  },
  "question": {
    "fontFamily": "Inter, sans-serif",
    "fontSize": 40,
    "color": "#e8efff",
    "fontWeight": "normal"
  },
  "answer": {
    "fontFamily": "Inter, sans-serif",
    "fontSize": 48,
    "color": "#ffe600",
    "fontWeight": "bold"
  }
}
```

#### `placeholders` JSONB shape

An array of positioned boxes. Each box maps a screen region to a style and a semantic role. Coordinates are in 1920×1080 space; the editor canvas scales them by 0.5 (to 960×540).

```json
[
  {
    "id": "ph-title",
    "x": 80,
    "y": 60,
    "width": 1760,
    "height": 120,
    "styleName": "title",
    "role": "title"
  },
  {
    "id": "ph-body",
    "x": 80,
    "y": 240,
    "width": 1760,
    "height": 480,
    "styleName": "question",
    "role": "question"
  },
  {
    "id": "ph-answer",
    "x": 80,
    "y": 780,
    "width": 1760,
    "height": 200,
    "styleName": "answer",
    "role": "answer"
  }
]
```

| Field | Description |
|---|---|
| `id` | Stable identifier referenced by slide content layers |
| `x`, `y`, `width`, `height` | Canvas coordinates (pixels at 1920×1080 base) |
| `styleName` | Key into the master's `styles` object |
| `role` | Semantic hint: `"question"` / `"answer"` / `"title"` / `"body"` / `"decoration"` |

#### `templates` JSONB shape

Stores default content for each slide type. Edited via **Masters & Slides → [select master] → Slide Templates tab** in the Admin Dashboard.

```json
{
  "intro": {
    "title": "",
    "subtitle": ""
  },
  "round_intro": {
    "label": "Next Round"
  },
  "mark_answers": {
    "heading": "Mark Your Answers",
    "subtitle": "Last chance to submit before answers are revealed."
  },
  "end": {
    "title": "Quiz Complete!",
    "subtitle": "Thanks for playing."
  },
  "scoreboard": {
    "title": "Leaderboard",
    "bgColor": "#0a0e1f"
  },
  "rules": {
    "title": "Rules",
    "body": "1. No phones\n2. No shouting answers\n3. Have fun!",
    "bgColor": "#0a0e1f"
  },
  "custom": [
    {
      "id": "cp-1234567890",
      "name": "Half-time Break",
      "title": "Half Time!",
      "body": "Grab a drink. Results so far on the screen.",
      "imageUrl": "",
      "bgColor": "#0a0e1f"
    }
  ]
}
```

The `custom` array items become available as pre-filled widget options in QuizBuilder when a quiz uses this master (via `quizzes.master_id`). Clicking one adds it to the quiz order as a `type: "custom"` widget pre-populated with the page's content.

---

### `slides` — the per-quiz content layer

A slide stores only what is *unique* to that slide: Fabric.js objects (text boxes, images) placed on top of the master's layout.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | |
| `quiz_id` | INT FK → `quizzes.id` | Which quiz owns this slide |
| `master_id` | INT FK → `slide_masters.id` | Template composited under this slide (nullable — `SET NULL` on master delete) |
| `type` | `slide_type` enum | `question` / `answer` / `intro` / `custom` / `widget` |
| `"order"` | INT | Ascending sequence within the quiz |
| `content` | JSONB | Fabric.js object array — slide-owned layers only |
| `created_at` / `updated_at` | TIMESTAMP | |

#### `content` JSONB shape

An array of serialised Fabric.js objects. **Only slide-owned layers go here** — typed text, images dragged onto the slide, free-text boxes, etc. Master layers (background, placeholder boxes) are never stored here.

```json
[
  {
    "type": "textbox",
    "text": "Welcome to Quiz Night!",
    "left": 80,
    "top": 240,
    "width": 760,
    "fontSize": 48,
    "fill": "#ffffff",
    "isSlideOwned": true,
    "autoShrink": true
  }
]
```

---

### `quizzes` — master theme association

Quizzes have an optional `master_id` column:

| Column | Type | Purpose |
|---|---|---|
| `master_id` | INT FK → `slide_masters.id` (nullable) | The master theme chosen for this quiz |

When `master_id` is set, the QuizBuilder reads that master's `templates.custom` array and presents the custom pages as additional widget buttons so they can be added to the quiz order.

---

## The Render-Time Composition Contract

```
Rendered frame = master background
              + master placeholders (geometry + styles from slide_masters)
              + slide content layers (from slides.content)
```

**Master layers are resolved by JOIN, not by copy.** The renderer:

1. Fetches the slide row.
2. Joins `slide_masters` on `slides.master_id`.
3. Draws the master background (colour or image).
4. Draws each master placeholder as an empty, styled region.
5. Draws each object from `slides.content` on top.

Nothing from the master is ever written into `slides.content`. The slide record only grows when the user types text or adds free elements.

### Why this matters

| Scenario | Result |
|---|---|
| Admin edits master font size | Every slide using that master re-renders with the new size on the next load — zero slide records touched |
| Admin swaps master background image | All linked slides immediately show the new image |
| Admin changes a placeholder's position | All linked slides reflow their content into the new region |
| Slide content is saved | Only `slides.content` is written — master is untouched |

---

## buildSlides — the Slide Index Contract

The three frontends (admin, slideshow, quizzer) all call `buildSlides(quiz)` independently to construct a flat array of slide descriptors. The WebSocket only broadcasts a **slide index** (integer). All clients must produce the exact same array from the same quiz data.

The slide types produced, in order:

| Type | When present | Key fields |
|---|---|---|
| `intro` | Always (first slide) | `title`, `subtitle` |
| `round_intro` | Once per round | `roundId`, `title` |
| `question` | Once per question in the round | `roundId`, `questionId`, `questionNumber`, `totalInRound`, `text`, `answer`, `points`, `mediaUrl`, `options`, `answerMode` |
| `mark_answers` | Once per round (after questions, before answers) | `roundId`, `roundName`, `totalInRound` |
| `answer` | Once per question in the round | `roundId`, `questionId`, `questionNumber`, `text`, `answer` |
| `widget` | Once per quiz widget | `widgetType`, `data` |
| `end` | Always (last slide) | `title`, `subtitle` |

**The `mark_answers` slide is always present for rounds that have at least one question.** Removing it from any one frontend without updating all three will break sync.

---

## `questions` Table Additions

Columns added to the existing `questions` table (all additive):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `category` | VARCHAR(100) | `NULL` | Free-text category, managed via the `categories` table |
| `options` | JSONB | `[]` | MCQ answer options array |
| `difficulty` | VARCHAR(20) | `'medium'` | Constrained to `easy` / `medium` / `hard` |
| `answer_mode` | VARCHAR(20) | `'text'` | `text` / `mcq` / `both` — drives quizzer input rendering |
| `approved` | BOOLEAN | `FALSE` | Human sign-off flag (stored, not yet enforced in quiz flow) |
| `question_format` | enum | `'standard'` | `standard` / `multichoice` / `both` — for slide editor integration |

---

## `categories` Table

Promoted from a derived list to a managed table:

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(100) UNIQUE | Category label |
| `sort_order` | INT | Display order |
| `created_at` | TIMESTAMP | |

Seeded with 14 defaults on every startup (`ON CONFLICT (name) DO NOTHING`). Renaming a category via `PUT /api/categories/:id` propagates the new name to all `questions.category` rows.

---

## Schema Location

All changes are in [`backend/schema.sql`](../backend/schema.sql). The file is idempotent — safe to run on every container start. New columns use `ADD COLUMN IF NOT EXISTS`; new types and constraints use `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
