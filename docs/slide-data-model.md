# Slide Data Model

## Overview

The slide system uses two tables: **`slide_masters`** and **`slides`**. Their responsibilities are strictly separated — a master owns the visual frame, a slide owns only the content typed into that frame.

---

## Tables

### `slide_masters` — the visual template

A master defines everything that is *shared* across all slides that use it:

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | |
| `name` | VARCHAR(255) | Human label (e.g. "Quiz Night Default") |
| `background_color` | VARCHAR(7) | Hex colour, e.g. `#1a1a2e` |
| `background_image_url` | VARCHAR(500) | Path to a background image (optional) |
| `styles` | JSONB | Named text style definitions (see below) |
| `placeholders` | JSONB | Array of positioned placeholder boxes (see below) |
| `created_at` / `updated_at` | TIMESTAMP | |

#### `styles` JSONB shape

A flat object keyed by style name. Common names: `"title"`, `"body"`, `"answer"`.

```json
{
  "title": {
    "fontFamily": "Inter",
    "fontSize": 64,
    "color": "#ffffff",
    "fontWeight": "bold"
  },
  "body": {
    "fontFamily": "Inter",
    "fontSize": 32,
    "color": "#e0e0e0",
    "fontWeight": "normal"
  },
  "answer": {
    "fontFamily": "Inter",
    "fontSize": 40,
    "color": "#ffd700",
    "fontWeight": "bold"
  }
}
```

#### `placeholders` JSONB shape

An array of positioned boxes. Each box maps a screen region to a style and a semantic role.

```json
[
  {
    "id": "ph-title-1",
    "x": 80,
    "y": 60,
    "width": 1760,
    "height": 120,
    "styleName": "title",
    "role": "title"
  },
  {
    "id": "ph-question-1",
    "x": 80,
    "y": 240,
    "width": 1760,
    "height": 480,
    "styleName": "body",
    "role": "question"
  },
  {
    "id": "ph-answer-1",
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
| `role` | Semantic hint: `"question"` / `"answer"` / `"title"` |

---

### `slides` — the content layer

A slide stores only what is *unique* to that slide: text typed into placeholders and any free-form elements added on top.

| Column | Type | Purpose |
|---|---|---|
| `id` | SERIAL PK | |
| `quiz_id` | INT FK → `quizzes.id` | Which quiz owns this slide |
| `master_id` | INT FK → `slide_masters.id` | Template to composite under this slide (nullable — `SET NULL` on master delete) |
| `type` | `slide_type` enum | `question` / `answer` / `intro` / `custom` / `widget` |
| `"order"` | INT | Ascending sequence within the quiz |
| `content` | JSONB | Fabric.js object array — slide-owned layers only |
| `created_at` / `updated_at` | TIMESTAMP | |

#### `content` JSONB shape

An array of serialised Fabric.js objects. **Only slide-owned layers go here** — typed text bound to a placeholder, images dragged onto the slide, free-text boxes, etc.

```json
[
  {
    "type": "textbox",
    "placeholderId": "ph-question-1",
    "text": "Which planet is closest to the Sun?",
    "left": 80,
    "top": 240,
    "width": 1760
  },
  {
    "type": "image",
    "src": "/uploads/solar-system.png",
    "left": 1400,
    "top": 300,
    "scaleX": 0.5,
    "scaleY": 0.5
  }
]
```

The `placeholderId` field links a content layer back to the master's placeholder — it tells the renderer *which* placeholder this text fills, but does **not** duplicate the placeholder's position or style into the slide record.

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
5. Draws each object from `slides.content` on top, applying master styles where `placeholderId` matches.

Nothing from the master is ever written into `slides.content`. The slide record only grows when the user types text or adds free elements.

### Why this matters

| Scenario | Result |
|---|---|
| Admin edits master font size | Every slide using that master re-renders with the new size on the next load — zero slide records touched |
| Admin swaps master background image | All linked slides immediately show the new image |
| Admin changes a placeholder's position | All linked slides reflow their content into the new region |
| Slide content is saved | Only `slides.content` is written — master is untouched |

This is the core invariant: **the master is the single source of truth for visual structure; the slide is the single source of truth for content.**

---

## `questions` Table Additions

Three columns added to the existing `questions` table (all additive, all existing rows preserved):

| Column | Type | Default | Purpose |
|---|---|---|---|
| `approved` | BOOLEAN | `FALSE` | Requires explicit sign-off before a question enters a live quiz |
| `question_format` | `question_format` enum | `'standard'` | `standard` = open text; `multichoice` = MCQ options; `both` = either mode |
| `difficulty` | VARCHAR(20) (existing) | `'medium'` | Now constrained to `easy` / `medium` / `hard` via CHECK |

`question_format` is distinct from the legacy `answer_mode` column (`text`/`mcq`/`both`). Both columns coexist — `answer_mode` drives the existing quizzer rendering; `question_format` will drive the new slide editor.

---

## Schema Location

All changes are in [`backend/schema.sql`](../backend/schema.sql). The file is idempotent — safe to run on every container start. New columns use `ADD COLUMN IF NOT EXISTS`; new types and constraints use `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
