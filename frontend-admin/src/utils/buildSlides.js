function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }

// Build a flat slide list from a quiz - MUST stay in sync with frontend-slideshow's version.
// Index-based sync means both apps must produce the same slide order from the same quiz data.
export function buildSlides(quiz) {
  if (!quiz) return [];
  const slides = [];

  slides.push({
    type: 'intro',
    title: quiz.name,
    subtitle: `Quiz Code: ${quiz.code}`
  });

  (quiz.rounds || []).forEach((round) => {
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
  });

  (quiz.widgets || []).forEach((w) => {
    slides.push({
      type: 'widget',
      widgetType: w.type,
      data: typeof w.data === 'string' ? safeParse(w.data) : (w.data || {})
    });
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
