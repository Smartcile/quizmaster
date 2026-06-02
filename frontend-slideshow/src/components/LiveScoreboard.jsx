import { useState, useEffect } from 'react';
import { api } from '../services/api';

// Live per-round scoreboard. Fetches the detailed breakdown and re-fetches on
// score/team socket events. Renders one column per round plus optional
// Starting (handicap) and Bonus columns, sorted by total descending.
//
// Backend shape (GET /api/teams/session/:id/scoreboard):
//   { teamSizeScoring, hasBrownie, rounds:[{id,name,format}], teams:[{...}] }
export default function LiveScoreboard({ sessionId, socket, title = 'Leaderboard' }) {
  const [data, setData]     = useState(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = () => {
    if (!sessionId) return;
    api.get(`/teams/session/${sessionId}/scoreboard`)
      .then(d => { setData(d); setLoaded(true); })
      .catch(() => setLoaded(true));
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [sessionId]);

  useEffect(() => {
    if (!socket) return;
    const onChange = () => refresh();
    socket.on('answer_marked',   onChange);
    socket.on('team_joined',     onChange);
    socket.on('answer_unlocked', onChange);
    socket.on('answer_locked',   onChange);
    return () => {
      socket.off('answer_marked',   onChange);
      socket.off('team_joined',     onChange);
      socket.off('answer_unlocked', onChange);
      socket.off('answer_locked',   onChange);
    };
    // eslint-disable-next-line
  }, [socket, sessionId]);

  return <ScoreboardTable data={data} loaded={loaded} title={title} />;
}

const fmt = (n) => {
  const v = Number(n) || 0;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
};
const fmtSigned = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '—';
  return v > 0 ? `+${fmt(v)}` : fmt(v);
};

export function ScoreboardTable({ data, loaded = true, title = 'Leaderboard' }) {
  const teams  = data?.teams  || [];
  const rounds = data?.rounds || [];
  const showStarting = !!data?.teamSizeScoring;
  const showBonus    = !!data?.hasBrownie;

  return (
    <div className="sb-panel">
      <h2 className="sb-title">{title}</h2>
      {!loaded ? (
        <p className="sb-msg">Loading scores…</p>
      ) : teams.length === 0 ? (
        <p className="sb-msg">No teams have scored yet.</p>
      ) : (
        <div className="sb-table-wrap">
          <table className="sb-table">
            <thead>
              <tr>
                <th className="sb-col-rank">#</th>
                <th className="sb-col-team">Team</th>
                {showStarting && <th className="sb-col-num">Starting</th>}
                {rounds.map(r => (
                  <th key={r.id} className="sb-col-num" title={r.name}>{r.name}</th>
                ))}
                {showBonus && <th className="sb-col-num">Bonus</th>}
                <th className="sb-col-num sb-col-total">Total</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t, i) => (
                <tr key={t.id} className={i === 0 ? 'sb-row-leader' : ''}>
                  <td className="sb-col-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                  <td className="sb-col-team">{t.name}</td>
                  {showStarting && <td className="sb-col-num">{fmtSigned(t.size_points)}</td>}
                  {rounds.map(r => (
                    <td key={r.id} className="sb-col-num">{fmt(t.round_scores?.[r.id] || 0)}</td>
                  ))}
                  {showBonus && <td className="sb-col-num">{fmtSigned(t.brownie_total)}</td>}
                  <td className="sb-col-num sb-col-total">{fmt(t.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
