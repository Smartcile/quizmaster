import { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { api } from '../services/api';

// Live per-round scoreboard. Fetches the detailed breakdown and re-fetches on
// score/team socket events. Renders one column per round plus optional
// Starting (handicap) and Bonus columns, sorted by total descending.
//
// Backend shape (GET /api/teams/session/:id/scoreboard):
//   { teamSizeScoring, hasBrownie, rounds:[{id,name,format}], teams:[{...}],
//     doubledRoundIds:[id,…] }
//
// NOTE: This component is duplicated byte-for-byte in all three frontends
// (frontend-slideshow / frontend-admin / frontend-quizzer). Change one, change
// all three identically.
export default function LiveScoreboard({ sessionId, socket, title = 'Leaderboard', autoScale = false }) {
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
    socket.on('whoami_marked',   onChange);
    return () => {
      socket.off('answer_marked',   onChange);
      socket.off('team_joined',     onChange);
      socket.off('answer_unlocked', onChange);
      socket.off('answer_locked',   onChange);
      socket.off('whoami_marked',   onChange);
    };
    // eslint-disable-next-line
  }, [socket, sessionId]);

  return <ScoreboardTable data={data} loaded={loaded} title={title} autoScale={autoScale} />;
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

export function ScoreboardTable({ data, loaded = true, title = 'Leaderboard', autoScale = false }) {
  const teams  = data?.teams  || [];
  const rounds = data?.rounds || [];
  const showStarting = !!data?.teamSizeScoring;
  const showBonus    = !!data?.hasBrownie;
  const showWhoami   = !!data?.hasWhoami;
  const doubledIds   = new Set((data?.doubledRoundIds || []).map(Number));

  // Number of shrinkable columns drives the responsive font-size / padding (via
  // the --cols CSS var): more columns → a tighter board so it keeps fitting.
  const flexCols = rounds.length
    + (showStarting ? 1 : 0)
    + (showWhoami ? 1 : 0)
    + (showBonus ? 1 : 0);

  // Measure-and-scale fallback for fixed presentation surfaces (the slideshow
  // can't scroll): if the table still can't fit after the CSS shrink, scale it
  // down uniformly so the whole board is visible. A no-op when it already fits.
  const wrapRef  = useRef(null);
  const innerRef = useRef(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    if (!autoScale) { setScale(1); return; }
    const fit = () => {
      const wrap = wrapRef.current, inner = innerRef.current;
      if (!wrap || !inner) return;
      const natural = inner.scrollWidth;
      const avail   = wrap.clientWidth;
      setScale(natural > avail && natural > 0 ? Math.max(0.4, avail / natural) : 1);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [autoScale, data, flexCols]);

  const scaleStyle = (autoScale && scale < 1)
    ? { transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` }
    : undefined;

  return (
    <div className="sb-panel">
      <h2 className="sb-title">{title}</h2>
      {!loaded ? (
        <p className="sb-msg">Loading scores…</p>
      ) : teams.length === 0 ? (
        <p className="sb-msg">No teams have scored yet.</p>
      ) : (
        <div className="sb-table-wrap" ref={wrapRef}>
          <div className="sb-scale" ref={innerRef} style={scaleStyle}>
            <table className="sb-table" style={{ '--cols': flexCols }}>
              <thead>
                <tr>
                  <th className="sb-col-rank">#</th>
                  <th className="sb-col-team">Team</th>
                  {showStarting && <th className="sb-col-num">Starting</th>}
                  {rounds.map(r => (
                    <th key={r.id} className="sb-col-num" title={r.name}>
                      {r.name}{doubledIds.has(Number(r.id)) && <span className="sb-x2">×2</span>}
                    </th>
                  ))}
                  {showWhoami && <th className="sb-col-num">Who Am I?</th>}
                  {showBonus && <th className="sb-col-num">Bonus</th>}
                  <th className="sb-col-num sb-col-total">Total</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t, i) => (
                  <tr key={t.id} className={i === 0 ? 'sb-row-leader' : ''}>
                    <td className="sb-col-rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
                    <td className="sb-col-team" title={t.name}>{t.name}</td>
                    {showStarting && <td className="sb-col-num">{fmtSigned(t.size_points)}</td>}
                    {rounds.map(r => (
                      <td key={r.id} className={`sb-col-num ${doubledIds.has(Number(r.id)) ? 'sb-doubled' : ''}`}>
                        {fmt(t.round_scores?.[r.id] || 0)}
                      </td>
                    ))}
                    {showWhoami && <td className="sb-col-num">{fmt(t.whoami_points || 0)}</td>}
                    {showBonus && <td className="sb-col-num">{fmtSigned(t.brownie_total)}</td>}
                    <td className="sb-col-num sb-col-total">{fmt(t.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
