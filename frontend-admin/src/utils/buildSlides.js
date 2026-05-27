function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Build a flat slide list from a quiz.
// MUST stay in sync with frontend-slideshow and frontend-quizzer copies.
// Index-based sync: WebSocket sends only a slide index; all three apps must
// independently produce the exact same slide array from the same quiz object.
//
// Rounds and widgets can be freely interleaved. The quiz API returns
// quiz.items — a unified ordered array of { kind:'round'|'widget', ...fields }.
// Older quiz objects that pre-date the items field fall back to rounds-first.
export function buildSlides(quiz) {
  if (!quiz) return [];
  const slides = [];

  slides.push({
    type: 'intro',
    title: quiz.name,
    subtitle: `Quiz Code: ${quiz.code}`
  });

  // Unified item sequence: rounds and widgets can appear in any order
  const items = quiz.items || [
    ...(quiz.rounds  || []).map(r => ({ kind: 'round',  ...r })),
    ...(quiz.widgets || []).map(w => ({ kind: 'widget', ...w }))
  ];

  items.forEach(item => {
    if (item.kind === 'round') {
      const round = item;
      slides.push({
        type: 'round_intro',
        roundId: round.id,
        title: round.name,
        background: round.background_color
      });

      const questions = (round.questions || []).filter(q => q && q.id);

      questions.forEach((q, i) => {
        slides.push({
          type: 'question',
          roundId: round.id,
          questionId: q.id,
          questionNumber: i + 1,
          totalInRound: questions.length,
          roundName: round.name,
          text: q.text,
          questionType: q.type,
          mediaUrl: q.media_url,
          options: q.options || [],
          points: q.points
        });
      });

      // Mark-answers slide — sits between the round's last question and its
      // first answer reveal. Quizzers can still submit until the admin advances
      // past it (which auto-locks the round).
      if (questions.length > 0) {
        slides.push({
          type: 'mark_answers',
          roundId: round.id,
          roundName: round.name,
          totalInRound: questions.length
        });
      }

      questions.forEach((q, i) => {
        slides.push({
          type: 'answer',
          roundId: round.id,
          questionId: q.id,
          questionNumber: i + 1,
          roundName: round.name,
          text: q.text,
          answer: q.answer,
          points: q.points
        });
      });

    } else if (item.kind === 'widget') {
      const w = item;
      slides.push({
        type: 'widget',
        widgetType: w.type,
        data: typeof w.data === 'string' ? safeParse(w.data) : (w.data || {})
      });
    }
  });

  slides.push({
    type: 'end',
    title: 'Quiz Complete!',
    subtitle: 'Thanks for playing'
  });

  return slides;
}

export function slideShortLabel(slide) {
  if (!slide) return '';
  switch (slide.type) {
    case 'intro': return 'Title';
    case 'round_intro': return `Round: ${slide.title}`;
    case 'question': return `Q${slide.questionNumber} — ${slide.roundName}`;
    case 'mark_answers': return `Mark Answers — ${slide.roundName}`;
    case 'answer': return `Answer Q${slide.questionNumber} — ${slide.roundName}`;
    case 'widget': return `Widget: ${slide.widgetType}`;
    case 'end': return 'End';
    default: return slide.type;
  }
}
