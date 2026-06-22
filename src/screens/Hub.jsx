import { useEffect, useState, useCallback } from "react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Avatar, Spinner } from "../components.jsx";

export default function Hub() {
  const api = useApi();
  const { code, go, back } = useNav();
  const [t, setT] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    try {
      const list = await api("/api/organizer/tournaments");
      const mine = list.find((x) => x.code === code);
      if (!mine) { setErr("Tournament not found"); return; }
      const detail = await api(`/api/organizer/tournaments/${mine.id}`);
      setT(detail);
    } catch (e) { setErr(e.message); }
  }, [api, code]);

  useEffect(() => { load(); }, [load]);

  if (err) return (<div className="screen"><Bar title="Home" onBack={back} /><div className="pad"><div className="ban err">{err}</div></div></div>);
  if (!t) return (<div className="screen"><Bar title="Home" onBack={back} /><Spinner /></div>);

  const teamA = { name: t.team_a_name, color: t.team_a_color, emoji: t.team_a_emoji, kind: t.team_a_kind, logoUrl: t.team_a_logo_url };
  const ca = t.roster.filter((r) => r.team === "A").length;
  const cb = t.roster.filter((r) => r.team === "B").length;
  let setM = 0, totM = t.matches.length;
  for (const m of t.matches) {
    const ok = m.kind === "scramble"
      ? (m.side_a?.[0] && m.side_a?.[1] && m.side_b?.[0] && m.side_b?.[1])
      : (m.side_a?.[0] && m.side_b?.[0]);
    if (ok) setM++;
  }

  return (
    <div className="screen">
      <Bar title="Home" onBack={back} />
      <div className="pad">
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <Avatar team={teamA} size={34} />
          <div className="h1" style={{ margin: 0 }}>{t.name}</div>
        </div>
        <p className="sub">{t.team_a_name} vs {t.team_b_name}</p>

        <button className="act" onClick={() => go("board", { code: t.code })}>
          <b>🏌️ Live board</b><p>See the score and play.</p>
        </button>
        <button className="act" onClick={() => go("roster", { code: t.code })}>
          <b>Roster</b><p>{t.roster.length} players · {ca} {t.team_a_name} / {cb} {t.team_b_name}</p>
        </button>
        <button className="act" onClick={() => go("pairings", { code: t.code })}>
          <b>Pairings</b><p>{setM} of {totM} matches set</p>
        </button>

        <div className="codecard">
          <div className="muted" style={{ textAlign: "center", fontSize: 12, marginBottom: 4 }}>Players join with</div>
          <div className="bigcode">{t.code}</div>
        </div>
      </div>
    </div>
  );
}
