import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupBackend } from './helpers/backend.js';

const { db, controller } = setupBackend('../../backend/websocket/handlers.js');
const { setupWebSocketHandlers } = controller;

// Register the connection handler against a fake io/socket and return the
// per-event handlers the connection closure attached to the socket.
function connect() {
  const roomEmit = vi.fn();
  const io = { on: vi.fn(), to: vi.fn(() => ({ emit: roomEmit })) };
  setupWebSocketHandlers(io);
  const onConnection = io.on.mock.calls.find(c => c[0] === 'connection')[1];

  const handlers = {};
  const socket = {
    id: 's1',
    join: vi.fn(),
    emit: vi.fn(),
    on: vi.fn((ev, fn) => { handlers[ev] = fn; }),
  };
  onConnection(socket);
  return { io, roomEmit, socket, handlers };
}

beforeEach(() => {
  db.query.mockReset().mockResolvedValue({ rows: [] });
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

const emitted = (socket) => socket.emit.mock.calls;
const roomEmitted = (emit, event) => emit.mock.calls.filter(c => c[0] === event);

describe('join_quiz', () => {
  it('joins the room and replays the full session state (defaults filled in)', async () => {
    db.query.mockResolvedValue({ rows: [{ current_slide_index: 3, status: 'active', locked_round_ids: [2], scoreboard_visibility: { slideshow: false } }] });
    const { socket, roomEmit, handlers } = connect();
    await handlers.join_quiz({ sessionId: 5, teamId: 1, teamName: 'Alpha', role: 'quizzer' });

    expect(socket.join).toHaveBeenCalledWith('quiz-5');
    expect(emitted(socket)).toContainEqual(['session_state', expect.objectContaining({
      slideIndex: 3, status: 'active', lockedRoundIds: [2], scoreboardVisibility: { slideshow: false },
    })]);
    expect(roomEmitted(roomEmit, 'team_joined')[0][1]).toMatchObject({ teamId: 1, teamName: 'Alpha' });
  });

  it('emits no session_state when the session row is missing', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const { socket, handlers } = connect();
    await handlers.join_quiz({ sessionId: 5, role: 'slideshow' });
    expect(emitted(socket).some(c => c[0] === 'session_state')).toBe(false);
  });
});

// ── submit_answer: the live auto-mark path ───────────────────────────────────
function submitDb({ existingAnswer = false, score = null, question } = {}) {
  db.query.mockImplementation(async (sql) => {
    if (/SELECT id FROM answers/i.test(sql)) return { rows: existingAnswer ? [{ id: 1 }] : [] };
    if (/INSERT INTO answers/i.test(sql) || /UPDATE answers SET/i.test(sql)) return { rows: [] };
    if (/SELECT id, auto_marked, points_awarded FROM scores/i.test(sql)) return { rows: score ? [score] : [] };
    if (/SELECT q\.answer, q\.points, q\.audio_form/i.test(sql)) return { rows: question ? [question] : [] };
    return { rows: [] };
  });
}

describe('submit_answer', () => {
  it('auto-marks a correct answer with the full point value', async () => {
    submitDb({ question: { answer: 'Paris', points: '2', audio_form: null, media_artist: null, media_title: null } });
    const { roomEmit, handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'Paris' });

    const ins = db.query.mock.calls.find(c => /INSERT INTO scores/i.test(c[0]));
    expect(ins[1][2]).toBe(2);
    expect(roomEmitted(roomEmit, 'answer_submitted')).toHaveLength(1);
    expect(roomEmitted(roomEmit, 'answer_marked')[0][1]).toMatchObject({ teamId: 1, questionId: 9, points: 2, autoMarked: true });
  });

  it('does not create a score for a wrong answer (but still broadcasts the submit)', async () => {
    submitDb({ question: { answer: 'Paris', points: '2', audio_form: null, media_artist: null, media_title: null } });
    const { roomEmit, handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'London' });
    expect(db.query.mock.calls.some(c => /INSERT INTO scores/i.test(c[0]))).toBe(false);
    expect(roomEmitted(roomEmit, 'answer_submitted')).toHaveLength(1);
    expect(roomEmitted(roomEmit, 'answer_marked')).toHaveLength(0);
  });

  it('never touches a manually-marked score', async () => {
    submitDb({ score: { id: 7, auto_marked: false, points_awarded: '0.5' } });
    const { roomEmit, handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'Paris' });
    // Never even loads the question / writes a score
    expect(db.query.mock.calls.some(c => /INSERT INTO scores/i.test(c[0]) || /UPDATE scores/i.test(c[0]))).toBe(false);
    expect(roomEmitted(roomEmit, 'answer_marked')).toHaveLength(0);
  });

  it('scores Name the Song as half for artist + half for song (metadata match)', async () => {
    submitDb({ question: { answer: '', points: '2', audio_form: 'name_the_song', media_artist: 'Queen', media_title: 'Bohemian Rhapsody' } });
    const { handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'Queen — Bohemian Rhapsody' });
    const ins = db.query.mock.calls.find(c => /INSERT INTO scores/i.test(c[0]));
    expect(ins[1][2]).toBe(2);
  });

  it('scores a Name the Song partial (artist only) at half value', async () => {
    submitDb({ question: { answer: '', points: '2', audio_form: 'name_the_song', media_artist: 'Queen', media_title: 'Bohemian Rhapsody' } });
    const { handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'Queen' });
    const ins = db.query.mock.calls.find(c => /INSERT INTO scores/i.test(c[0]));
    expect(ins[1][2]).toBe(1);
  });

  it('resets an auto score to 0 when a correct answer is broken', async () => {
    submitDb({
      score: { id: 7, auto_marked: true, points_awarded: '2' },
      question: { answer: 'Paris', points: '2', audio_form: null, media_artist: null, media_title: null },
    });
    const { handlers } = connect();
    await handlers.submit_answer({ sessionId: 5, teamId: 1, questionId: 9, roundId: 1, answer: 'London' });
    const upd = db.query.mock.calls.find(c => /UPDATE scores SET points_awarded/i.test(c[0]));
    expect(upd[1][0]).toBe(0);
  });
});

describe('answer_locked / answer_unlocked', () => {
  it('persists the lock and auto-zeros unanswered teams', async () => {
    db.query.mockImplementation(async (sql) => {
      if (/CROSS JOIN round_questions/i.test(sql)) return { rows: [{ team_id: 1, question_id: 9 }, { team_id: 2, question_id: 9 }] };
      return { rows: [] };
    });
    const { roomEmit, handlers } = connect();
    await handlers.answer_locked({ sessionId: 5, roundId: 3 });
    expect(roomEmitted(roomEmit, 'answer_locked')[0][1]).toMatchObject({ roundId: 3 });
    expect(roomEmitted(roomEmit, 'answer_marked')).toHaveLength(2);
    expect(roomEmitted(roomEmit, 'answer_marked')[0][1]).toMatchObject({ points: 0, autoMarked: true });
  });

  it('broadcasts an unlock', async () => {
    const { roomEmit, handlers } = connect();
    await handlers.answer_unlocked({ sessionId: 5, roundId: 3 });
    expect(roomEmitted(roomEmit, 'answer_unlocked')[0][1]).toMatchObject({ roundId: 3 });
  });
});

describe('mark_answer / slide_changed / media_play / session_status_changed', () => {
  it('mark_answer upserts and broadcasts the points', async () => {
    const { roomEmit, handlers } = connect();
    await handlers.mark_answer({ sessionId: 5, teamId: 1, questionId: 9, points: 1 });
    expect(db.query.mock.calls.some(c => /INSERT INTO scores/i.test(c[0]))).toBe(true);
    expect(roomEmitted(roomEmit, 'answer_marked')[0][1]).toMatchObject({ points: 1 });
  });

  it('slide_changed persists and broadcasts', async () => {
    const { roomEmit, handlers } = connect();
    await handlers.slide_changed({ sessionId: 5, slideIndex: 4 });
    expect(roomEmitted(roomEmit, 'slide_changed')[0][1]).toMatchObject({ slideIndex: 4 });
  });

  it('media_play is ephemeral (no DB) and re-broadcasts the nonce', () => {
    const { roomEmit, handlers } = connect();
    handlers.media_play({ sessionId: 5, slideIndex: 4, nonce: 2 });
    expect(db.query).not.toHaveBeenCalled();
    expect(roomEmitted(roomEmit, 'media_play')[0][1]).toMatchObject({ slideIndex: 4, nonce: 2 });
  });

  it('session_status_changed ignores an invalid status', async () => {
    const { roomEmit, handlers } = connect();
    await handlers.session_status_changed({ sessionId: 5, status: 'paused' });
    expect(db.query).not.toHaveBeenCalled();
    expect(roomEmitted(roomEmit, 'session_status_changed')).toHaveLength(0);
  });

  it('session_status_changed persists a valid status and broadcasts', async () => {
    const { roomEmit, handlers } = connect();
    await handlers.session_status_changed({ sessionId: 5, status: 'active', currentSlideIndex: 2 });
    expect(roomEmitted(roomEmit, 'session_status_changed')[0][1]).toMatchObject({ status: 'active', currentSlideIndex: 2 });
  });

  it('disconnect removes the socket from the registry without throwing', () => {
    const { handlers } = connect();
    expect(() => handlers.disconnect('client left')).not.toThrow();
  });
});
