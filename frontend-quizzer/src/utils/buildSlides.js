// Mirror of slideshow/admin buildSlides. MUST produce the same indexes.
// Rounds and widgets can be freely interleaved via quiz.items.
export function buildSlides(quiz) {
  if (!quiz) return [];
  const slides = [];

  slides.push({ type: 'intro', title: quiz.name, subtitle: `Quiz Code: ${quiz.code}` });

  // Unified item sequence: rounds and widgets can appear in any order
  const items = quiz.items || [
    ...(quiz.rounds  || []).map(r => ({ kind: 'round',  ...r })),
    ...(quiz.widgets || []).map(w => ({ kind: 'widget', ...w }))
  ];

  items.forEach(item => {
    if (item.kind === 'round') {
      const round = item;
      slides.push({ type: 'round_intro', roundId: round.id, title: round.name });

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
          answerMode: q.answer_mode || (q.type === 'mcq' ? 'mcq' : 'text'),
          mediaUrl: q.media_url,
          options: q.options || [],
          points: q.points
        });
      });

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
      slides.push({ type: 'widget', widgetType: w.type, data: w.data || {} });
    }
  });

  slides.push({ type: 'end', title: 'Quiz Complete!', subtitle: 'Thanks for playing' });

  return slides;
}
