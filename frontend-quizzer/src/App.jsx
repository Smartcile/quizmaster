import { useState, useEffect, useRef, useMemo } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import JoinQuiz from './pages/JoinQuiz';
import QuizParticipant, { AnswerReviewView } from './pages/QuizParticipant';
import { buildSlides } from './utils/buildSlides';
import { api } from './services/api';

// ── Persistent device identity ────────────────────────────────────────────────
// A browser can't read a MAC address and IPs collide on shared wifi, so rejoin
// is keyed on a client-generated UUID kept in localStorage (survives tabs,
// sessions and the back button). Sent with every join; the backend stores it
// on the team so this device can silently reconnect to it later.
const DEVICE_KEY = 'qm_device_id';
function getDeviceId() {
  let id = null;
  try { id = localStorage.getItem(DEVICE_KEY); } catch { /* storage blocked */ }
  if (!id) {
    id = (window.crypto?.randomUUID)
      ? window.crypto.randomUUID()
      : `qm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    try { localStorage.setItem(DEVICE_KEY, id); } catch { /* storage blocked */ }
  }
  return id;
}

// Stored join identity — localStorage (not sessionStorage) so back/refresh and
// new tabs land the guest straight back in their session. Reads the legacy
// sessionStorage value as a migration fallback.
const TEAM_STORE_KEY = 'quizTeam';
function readTeamStore() {
  const raw = localStorage.getItem(TEAM_STORE_KEY) || sessionStorage.getItem(TEAM_STORE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { clearTeamStore(); return null; }
}
function saveTeamStore(obj) {
  try { localStorage.setItem(TEAM_STORE_KEY, JSON.stringify(obj)); } catch { /* storage blocked */ }
}
function clearTeamStore() {
  localStorage.removeItem(TEAM_STORE_KEY);
  sessionStorage.removeItem(TEAM_STORE_KEY);
}

// Read deep-link context from the URL once. Supports test-mode params:
//   ?session=<id>  → target a specific session (bypass active-session lookup)
//   ?team=<name>&size=<n>&autojoin=1 → auto-join as that team (bot mirror pane)
function getUrlContext() {
  const params = new URLSearchParams(window.location.search);
  const segs = window.location.pathname.split('/').filter(Boolean);
  const last = segs[segs.length - 1];
  const code = params.get('code') || (last && /^[A-Za-z0-9]{4,8}$/.test(last) ? last : null);
  const sid = params.get('session');
  const size = params.get('size');
  return {
    code: code ? code.toUpperCase() : null,
    forcedSessionId: sid ? parseInt(sid) : null,
    autoTeam: params.get('team') || null,
    autoSize: size ? parseInt(size) : null,
  };
}

function App() {
  const [phase, setPhase] = useState('join'); // join | prelobby | waiting | playing | finished
  const [quiz, setQuiz] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState('lobby');
  const [team, setTeam] = useState(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [error, setError] = useState(null);
  // Whether the scoreboard SLIDE reveals scores on the quizzer. Default true;
  // the host can toggle it off from Control to keep scores hidden for suspense.
  const [scoreboardVisible, setScoreboardVisible] = useState(true);
  const [ctx] = useState(getUrlContext);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [backNote, setBackNote] = useState(false);
  // A valid code scanned BEFORE the host started a session — hold the team's
  // details and auto-join the moment the lobby opens.
  const [pendingJoin, setPendingJoin] = useState(null); // { code, teamName, teamSize }
  const autoJoinedRef = useRef(false);
  const socket = useWebSocket();
  // 'online' | 'offline' | 'back' — drives the connection bar. Socket.io queues
  // outgoing answers while offline and flushes them on reconnect, so this is
  // reassurance: it stops guests force-reloading when the wifi blips.
  const [conn, setConn] = useState('online');

  // ── Back-button hardening (Android especially) ────────────────────────────
  // Browsers can't disable Back and popup-blockers rule out forcing a new tab,
  // so instead: once in the quiz we replace the join-form history entry and
  // push a sentinel entry. Pressing Back pops the sentinel — the popstate
  // handler immediately pushes it again, so the guest stays in the app (a
  // brief note confirms nothing was lost). Team identity survives a real
  // refresh/navigation anyway via the stored rejoin info.
  const inQuiz = phase !== 'join';
  useEffect(() => {
    if (!inQuiz) return;
    window.history.replaceState({ qmQuiz: true }, '');
    window.history.pushState({ qmQuiz: true }, '');
    let noteTimer;
    const onPop = () => {
      window.history.pushState({ qmQuiz: true }, '');
      setBackNote(true);
      clearTimeout(noteTimer);
      noteTimer = setTimeout(() => setBackNote(false), 2500);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      clearTimeout(noteTimer);
      window.removeEventListener('popstate', onPop);
    };
  }, [inQuiz]);

  // ── Connection status bar ─────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    let backTimer;
    const onDisconnect = () => { clearTimeout(backTimer); setConn('offline'); };
    const onConnect = () => {
      setConn(prev => {
        if (prev === 'online') return prev;      // first connect — say nothing
        clearTimeout(backTimer);
        backTimer = setTimeout(() => setConn('online'), 2500);
        return 'back';
      });
    };
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    if (!socket.connected) setConn('offline');
    return () => {
      clearTimeout(backTimer);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
    };
  }, [socket]);

  // Confirm before closing/reloading the tab while the quiz is live.
  const guardUnload = phase === 'playing' && !!team;
  useEffect(() => {
    if (!guardUnload) return;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [guardUnload]);

  // Does this quiz have an Answer Review widget configured to show on the scoreboard?
  const reviewOnScoreboard = useMemo(() => {
    const items = quiz?.items || [];
    return items.some(i => i.kind === 'widget' && i.type === 'review'
      && i.data && typeof i.data !== 'string' && i.data.showOnScoreboard);
  }, [quiz]);

  // Enter a session as an identified team (shared by join, restore and the
  // silent device pickup).
  const enterSession = (teamData, quizData, session) => {
    setTeam(teamData);
    setQuiz(quizData);
    setSessionId(session.id);
    setSessionStatus(session.status || 'lobby');
    setCurrentSlide(session.current_slide_index || 0);
    if (session.status === 'active')        setPhase('playing');
    else if (session.status === 'finished') setPhase('finished');
    else                                    setPhase('waiting');
  };

  // ── Restore team identity after refresh/back — then silent device pickup ──
  useEffect(() => {
    if (ctx.autoTeam) return; // test mirror pane auto-joins below; don't restore
    (async () => {
      // 1) Stored identity from a previous join (localStorage — survives the
      //    back button, refreshes and new tabs)
      const parsed = readTeamStore();
      const joinCode = parsed?.code || parsed?.quizCode;
      if (parsed?.teamId && joinCode) {
        try {
          const [teamData, resolved] = await Promise.all([
            api.get(`/teams/${parsed.teamId}`),
            api.get(`/quizzes/resolve/${joinCode}`)
          ]);
          const quizData = resolved.quiz;
          const session = resolved.session;
          if (!quizData || !session) throw new Error('stale');
          const codes = [session.code, quizData.code]
            .filter(Boolean).map(c => String(c).toUpperCase());
          // If the URL deep-links to a DIFFERENT quiz, don't hijack it with the
          // stored session — fall through to device pickup / the join form.
          const differentQuiz = ctx.code && !codes.includes(ctx.code);
          if (!differentQuiz) {
            // Only drop back into a finished session when the URL explicitly
            // points at it (review lookup) — not silently days later.
            if (session.status === 'finished' && !ctx.code) throw new Error('stale');
            enterSession(teamData, quizData, session);
            return;
          }
        } catch {
          clearTeamStore(); // stored session is stale
        }
      }

      // 2) Silent device pickup: the URL carries a code (QR / deep link) and
      //    this device already has a team in that session — reconnect straight
      //    to it. No form, and never a duplicate team.
      if (!ctx.code || ctx.forcedSessionId) return;
      try {
        const resolved = await api.get(`/quizzes/resolve/${ctx.code}`);
        const session = resolved?.session;
        if (!resolved?.quiz || !session || session.status === 'finished') return;
        const teamData = await api.get(
          `/teams/session/${session.id}/device/${encodeURIComponent(getDeviceId())}`
        );
        if (!teamData?.id) return;
        enterSession(teamData, resolved.quiz, session);
        saveTeamStore({ teamId: teamData.id, code: session.code || ctx.code });
      } catch { /* no team for this device yet — stay on the join form */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleJoin = async (code, teamName, teamSize) => {
    setError(null);
    try {
      // Resolve the code → quiz + session. A test iframe targets a specific
      // session id; otherwise the resolver matches a session code (any status,
      // so finished codes work for history lookup) or falls back to the quiz
      // code → its current live session.
      let quizData, session;
      if (ctx.forcedSessionId) {
        quizData = await api.get(`/quizzes/by-code/${code}`);
        try { session = await api.get(`/quizzes/sessions/${ctx.forcedSessionId}`); }
        catch { setError('Test session not found.'); return; }
      } else {
        const resolved = await api.get(`/quizzes/resolve/${code}`).catch(() => null);
        if (!resolved || !resolved.quiz) { setError(`Code "${code}" not found.`); return; }
        quizData = resolved.quiz;
        session  = resolved.session;
        if (!session) {
          // Valid quiz, no session yet (e.g. printed QR scanned early) — wait
          // in a friendly holding state and join automatically when it opens.
          setQuiz(quizData);
          setPendingJoin({ code, teamName, teamSize });
          setPhase('prelobby');
          return true;
        }
      }

      // Register/rejoin the team for THIS session. Find-or-create matches on a
      // fuzzy-normalised name and this device's persistent id, so a returning
      // guest always reconnects to their existing team — never a duplicate.
      const deviceId = getDeviceId();
      let teamData = await api.post('/teams/join', {
        sessionId: session.id,
        name: teamName,
        size: teamSize,
        deviceId
      });

      // Close-but-not-exact name (or this device already has a team here):
      // the server won't guess — confirm with the guest. YES reconnects to the
      // EXISTING team; NO creates a genuinely new one.
      if (teamData?.needsConfirm && teamData.suggestion) {
        const yes = window.confirm(
          `Is this your team?\n\n"${teamData.suggestion.name}"\n\nOK = yes, reconnect us · Cancel = no, we're a new team`
        );
        teamData = await api.post('/teams/join', {
          sessionId: session.id,
          name: teamName,
          size: teamSize,
          deviceId,
          ...(yes ? { confirmTeamId: teamData.suggestion.id } : { forceNew: true })
        });
      }

      enterSession(teamData, quizData, session);

      // Persist the SESSION code so a refresh/back/new tab rejoins this exact
      // session. Never for the test mirror pane (?team=…&autojoin=1) — a bot
      // identity must not stick to this browser's real join flow.
      if (!ctx.autoTeam) {
        saveTeamStore({ teamId: teamData.id, code: session.code || code });
      }

      if (teamData.rejoined) {
        console.info(`Reconnected to existing team "${teamData.name}"`);
      }
      return true;
    } catch (err) {
      setError(err.message || 'Failed to join quiz');
      return false;
    }
  };

  // ── Pre-lobby: poll until the host starts the session, then auto-join ─────
  useEffect(() => {
    if (phase !== 'prelobby' || !pendingJoin) return;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const resolved = await api.get(`/quizzes/resolve/${pendingJoin.code}`).catch(() => null);
        if (resolved?.session && resolved.session.status !== 'finished') {
          clearInterval(timer);
          const ok = await handleJoin(pendingJoin.code, pendingJoin.teamName, pendingJoin.teamSize);
          setPendingJoin(null);
          if (!ok) setPhase('join');
        }
      } finally {
        busy = false;
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [phase, pendingJoin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-join as a bot team (test "mirror" pane) ──────────────────────────
  useEffect(() => {
    if (ctx.autoTeam && ctx.code && phase === 'join' && !autoJoinedRef.current) {
      autoJoinedRef.current = true;
      handleJoin(ctx.code, ctx.autoTeam, ctx.autoSize || 5);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── WebSocket subscriptions + auto-rejoin ────────────────────────────────
  useEffect(() => {
    if (!socket || !sessionId || !team) return;

    // Unified join/rejoin — called on every (re)connect
    const rejoin = () => socket.emit('join_quiz', { sessionId, teamId: team.id, teamName: team.name, role: 'team' });

    // session_state: full authoritative state sent by server on every join_quiz
    const onSessionState = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
      if (data.scoreboardVisibility) setScoreboardVisible(!!data.scoreboardVisibility.quizzer);
      if (data.status) {
        setSessionStatus(data.status);
        if (data.status === 'active')        setPhase('playing');
        else if (data.status === 'lobby')    setPhase('waiting');
        else if (data.status === 'finished') setPhase('finished');
      }
    };
    const onScoreboardVis = (data) => {
      if (data?.visibility) setScoreboardVisible(!!data.visibility.quizzer);
    };
    const onSlide = (data) => {
      if (typeof data.slideIndex === 'number') setCurrentSlide(data.slideIndex);
    };
    const onStatus = (data) => {
      setSessionStatus(data.status);
      if (typeof data.currentSlideIndex === 'number') setCurrentSlide(data.currentSlideIndex);
      if (data.status === 'active')        setPhase('playing');
      else if (data.status === 'lobby')    setPhase('waiting');
      else if (data.status === 'finished') setPhase('finished');
    };

    // The host removed OUR team — leave the session cleanly instead of letting
    // every later submit fail against a deleted team row.
    const onTeamRemoved = (data) => {
      if (data?.teamId !== team?.id) return;
      clearTeamStore();
      setTeam(null);
      setSessionId(null);
      setQuiz(null);
      setPhase('join');
      setError('Your team was removed by the quiz master.');
    };

    socket.on('connect',                rejoin);
    socket.on('session_state',          onSessionState);
    socket.on('slide_changed',          onSlide);
    socket.on('session_status_changed', onStatus);
    socket.on('scoreboard_visibility_changed', onScoreboardVis);
    socket.on('team_removed',           onTeamRemoved);

    // If socket is already connected when the effect runs, join immediately
    if (socket.connected) rejoin();

    return () => {
      socket.off('connect',                rejoin);
      socket.off('session_state',          onSessionState);
      socket.off('slide_changed',          onSlide);
      socket.off('session_status_changed', onStatus);
      socket.off('scoreboard_visibility_changed', onScoreboardVis);
      socket.off('team_removed',           onTeamRemoved);
    };
  }, [socket, sessionId, team]);

  const renderView = () => {
    if (phase === 'join') {
      return <JoinQuiz onJoin={handleJoin} error={error} />;
    }

    if (phase === 'prelobby') {
      return (
        <div className="waiting-screen">
          <div className="waiting-card">
            <h1>🎯 {quiz?.name || 'Quiz found'}</h1>
            <p className="waiting-team">Team: <strong>{pendingJoin?.teamName}</strong></p>
            <div className="waiting-spinner" />
            <p className="waiting-status">
              Waiting for the quiz to start — you'll join automatically when the lobby opens.
            </p>
            <button
              className="prelobby-cancel"
              onClick={() => { setPendingJoin(null); setPhase('join'); }}
            >
              ← Back
            </button>
          </div>
        </div>
      );
    }

    if (phase === 'waiting') {
      return (
        <div className="waiting-screen">
          <div className="waiting-card">
            <h1>🎯 {quiz?.name}</h1>
            <p className="waiting-team">Team: <strong>{team?.name}</strong></p>
            <div className="waiting-spinner" />
            <p className="waiting-status">Waiting for the quiz master to begin...</p>
          </div>
        </div>
      );
    }

    if (phase === 'finished') {
      // Read-only history: the team's own answers + scores, grouped by round.
      return <ReviewScreen quiz={quiz} team={team} />;
    }

    return (
      <QuizParticipant
        quiz={quiz}
        sessionId={sessionId}
        sessionStatus={sessionStatus}
        team={team}
        currentSlide={currentSlide}
        socket={socket}
        scoresVisible={scoreboardVisible}
        showViewAnswers={reviewOnScoreboard && !!team}
        onViewAnswers={() => setReviewOpen(true)}
      />
    );
  };

  return (
    <>
      {renderView()}

      {inQuiz && conn !== 'online' && (
        <div className={`conn-bar conn-${conn}`}>
          {conn === 'offline'
            ? '⚠ Reconnecting… your answers are saved'
            : '✓ Back online'}
        </div>
      )}

      {backNote && (
        <div className="back-note">👍 You're still in the quiz</div>
      )}

      {reviewOpen && team && (
        <div className="modal-overlay" onClick={() => setReviewOpen(false)}>
          <div className="review-popup" onClick={(e) => e.stopPropagation()}>
            <button className="btn-close review-popup-close" onClick={() => setReviewOpen(false)}>×</button>
            <ReviewScreen quiz={quiz} team={team} />
          </div>
        </div>
      )}
    </>
  );
}

// Read-only end-of-quiz review shown when a session is finished (including when
// a team re-enters an old code later to look up their answers and scores).
function ReviewScreen({ quiz, team }) {
  const [answers, setAnswers] = useState({});
  const [scores, setScores]   = useState({});
  const slides = useMemo(() => buildSlides(quiz), [quiz]);

  useEffect(() => {
    if (!team?.id) return;
    api.get(`/teams/${team.id}/answers`).then(rows => {
      const n = {};
      (rows || []).forEach(r => { if (r.question_id != null) n[r.question_id] = r.answer_text; });
      setAnswers(n);
    }).catch(() => {});
    api.get(`/teams/${team.id}/scores`).then(res => {
      const n = {};
      (res?.scores || []).forEach(s => { if (s.question_id != null) n[s.question_id] = parseFloat(s.points); });
      setScores(n);
    }).catch(() => {});
  }, [team?.id]);

  return (
    <div className="quiz-participant">
      <div className="quiz-header">
        <h1>🏁 {quiz?.name}</h1>
        <p>Team <strong>{team?.name}</strong> · final review</p>
      </div>
      <div className="quiz-content">
        <AnswerReviewView title="Your Answers & Scores" slides={slides} answers={answers} scores={scores} />
      </div>
    </div>
  );
}

export default App;
