# Quiz Master — Roadmap

Ideas that are wanted but not built yet. Anything in here is a **proposal**, not
current behaviour — check `CLAUDE.md` for what actually ships today.

---

## Rich answer reveals — descriptions + photos on answers

**Status:** not started
**Why:** the answer slide is the moment the room is paying most attention. Right
now it can only show the answer text (plus the picture for an intermission
round), so any explanation has to be read out from the host's notes and there's
nothing to look at.

**What's wanted**

- An optional **description / explanation** per question, shown on the answer
  reveal — the bit of colour that makes the answer satisfying ("…it was the only
  Best Picture winner shot entirely on location").
- An optional **answer image**, separate from the question's media, shown on the
  answer reveal. The motivating example: a **"guess the movie" round** where the
  answer slide shows the film's poster.

**Where it would surface**

| Surface | Behaviour |
|---|---|
| Slideshow answer slide | Poster/photo alongside the answer, description underneath |
| Quizzer answer reveal | Same, sized for a phone (reuse the tap-to-enlarge lightbox) |
| Questions & Answers PDF | Description printed under the answer for the host to read out |
| Answer Review page | Description included so teams can see why they were wrong |

**Sketch of the work**

1. Schema (additive): `questions.answer_description TEXT`,
   `questions.answer_media_url VARCHAR(500)`.
2. Question editor: a "Answer reveal" block — description textarea + the shared
   `MediaPicker` for the image. Only worth showing for standard questions.
3. `loadQuizWithRoundsAndWidgets`: include both fields on the question payload.
4. **`buildSlides` (all three copies — the One Rule):** add
   `answerDescription` / `answerMediaUrl` to the `answer` slide. No new slides,
   so slide indexes are unaffected.
5. Render on slideshow + quizzer answer slides; add to the Q&A PDF generator and
   `AnswerReviewView`.

**Open questions**

- Should the description be visible to teams on their own review page, or is it
  host-only material?
- Reuse the question's existing media when no answer image is set (e.g. show the
  film still again), or leave it blank?
- Per-round default ("always show posters in this round") or purely per-question?
