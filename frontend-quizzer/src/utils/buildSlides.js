// Mirror of slideshow/admin buildSlides. MUST produce the same indexes.
export function buildSlides(quiz) {
  if (!quiz) return [];
  const slides = [];

  slides.push({ type: 'intro', title: quiz.name, subtitle: `Quiz Code: ${quiz.code}` });

  (quiz.rounds || []).forEach((round) => {
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
    slides.push({ type: 'widget', widgetType: w.type, data: w.data || {} });
  });

  slides.push({ type: 'end', title: 'Quiz Complete!', subtitle: 'Thanks for playing' });

  return slides;
}
