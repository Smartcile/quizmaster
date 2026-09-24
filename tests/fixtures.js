// Shared fixture: a quiz that exercises every buildSlides branch —
// standard round, intermission, textlist (order + match), widgets, and a
// 3-clue Who Am I? distributed across 4 rounds.
export function makeQuiz() {
  return {
    id: 1,
    name: 'Fixture Quiz',
    code: 'ABC123',
    items: [
      {
        kind: 'round', id: 10, name: 'Round One', style: 'standard', background_color: '#111111',
        questions: [
          { id: 101, text: 'Q1', type: 'text', answer: 'A1', points: 1, answer_mode: 'text' },
          { id: 102, text: 'Q2', type: 'text', answer: 'A2', points: 2, answer_mode: 'mcq', options: ['A', 'B'] },
        ],
      },
      { kind: 'widget', id: 500, type: 'scoreboard', data: { title: 'Leaderboard' } },
      {
        kind: 'round', id: 20, name: 'Picture Round', style: 'intermission', display_title: 'Name the Picture', grid_columns: 4,
        questions: [
          { id: 201, text: 'p1', type: 'image', media_url: '/u/1.jpg', answer: 'cat', points: 1 },
          { id: 202, text: 'p2', type: 'image', media_url: '/u/2.jpg', answer: 'dog', points: 1 },
        ],
      },
      {
        kind: 'round', id: 30, name: 'Order Round', style: 'textlist', display_title: 'Order by size', list_mode: 'order', list_options: [],
        questions: [
          { id: 301, text: 'Canada', type: 'text', answer: '2', points: 1 },
          { id: 302, text: 'Malta', type: 'text', answer: '3', points: 1 },
        ],
      },
      {
        kind: 'round', id: 40, name: 'Match Round', style: 'textlist', list_mode: 'match', list_options: ['Small', 'Large'],
        questions: [
          { id: 401, text: 'Luxembourg', type: 'text', answer: 'Small', points: 1 },
        ],
      },
      {
        kind: 'widget', id: 501, type: 'whoami',
        data: { title: 'Who Am I?', answer: 'Einstein', clues: [{ text: 'C1', points: 5 }, { text: 'C2', points: 3 }, { text: 'C3', points: 1 }] },
      },
    ],
  };
}

export const EXPECTED_TYPES = [
  'intro',
  'whoami_clue',
  'round_intro', 'question', 'question', 'mark_answers', 'answer', 'answer',
  'widget',
  'whoami_clue', 'intermission', 'mark_answers', 'answer', 'answer',
  'whoami_clue', 'textlist', 'mark_answers', 'answer', 'answer',
  'textlist', 'mark_answers', 'answer',
  'end',
];
