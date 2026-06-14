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

  // A quiz may carry one "Who Am I?" — a widget with a shared answer + a list of
  // clues. One clue is revealed before each round (round i → clue i); the answer
  // is revealed on the end slide. Skip rendering it as a normal widget slide.
  const whoami = parseWhoami(items);
  let roundIndex = 0;

  items.forEach(item => {
    if (item.kind === 'round') {
      if (whoami && roundIndex < whoami.clues.length) {
        const clue = whoami.clues[roundIndex] || {};
        slides.push({
          type: 'whoami_clue',
          clueIndex: roundIndex,
          totalClues: whoami.clues.length,
          title: whoami.title,
          text: clue.text || '',
          points: clue.points,
          revealed: whoami.clues.slice(0, roundIndex + 1)
        });
      }
      roundIndex++;

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
          points: q.points,
          audioForm: q.audio_form || null,
          audioStop: q.audio_stop_seconds != null ? Number(q.audio_stop_seconds) : null,
          mediaArtist: q.media_artist || null,
          mediaTitle: q.media_title || null
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
          points: q.points,
          audioForm: q.audio_form || null,
          mediaArtist: q.media_artist || null,
          mediaTitle: q.media_title || null
        });
      });

    } else if (item.kind === 'widget') {
      if (item.type === 'whoami') return; // distributed as clue slides above
      const w = item;
      slides.push({ type: 'widget', widgetType: w.type, data: w.data || {} });
    }
  });

  slides.push({
    type: 'end',
    title: 'Quiz Complete!',
    subtitle: 'Thanks for playing',
    whoami: whoami ? { title: whoami.title, answer: whoami.answer } : null
  });

  return slides;
}

// Extract the single Who-Am-I config from a quiz's items (or null).
// MUST behave identically across all three frontend copies.
function parseWhoami(items) {
  const item = (items || []).find(i => i.kind === 'widget' && i.type === 'whoami');
  if (!item) return null;
  let d = item.data || {};
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = {}; } }
  return {
    title:  d.title  || 'Who Am I?',
    answer: d.answer || '',
    clues:  Array.isArray(d.clues) ? d.clues : []
  };
}
