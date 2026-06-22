import { useEffect, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { useApi } from "../api.js";
import { useNav } from "../store.jsx";
import { Bar, Spinner } from "../components.jsx";

export default function Home() {
  const api = useApi();
  const { user } = useUser();
  const { go } = useNav();
  const [tournaments, setTournaments] = useState(null);
  const [err, setErr] = useState(null);
  const first = user?.firstName || "there";

  useEffect(() => {
    let on = true;
    api("/api/organizer/tournaments")
      .then((rows) => on && setTournaments(rows))
      .catch((e) => on && (setErr(e.message), setTournaments([])));
    return () => { on = false; };
  }, [api]);

  return (
    <div className="screen">
      <div className="bar"><span style={{ fontWeight: 700 }}>Home</span><span className="wordmark">TOTO</span></div>
      <div className="pad">
        <div className="h1">Hi {first} 👋</div>
        <p className="sub">Start a tournament or jump into one you're playing.</p>

        <button className="act" onClick={() => go("create")}>
          <b>＋ Create a tournament</b>
          <p>Redeem a gate pass and set up your match.</p>
        </button>
        <button className="act" onClick={() => go("join")}>
          <b>▶ Join with a code</b>
          <p>Enter a tournament code to play and score.</p>
        </button>

        <div className="lab" style={{ marginTop: 18 }}>Your tournaments</div>
        {tournaments === null ? <Spinner /> :
          tournaments.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {err ? err : "None yet — create one to get started."}
            </p>
          ) : tournaments.map((t) => (
            <button key={t.id} className="act" onClick={() => go("hub", { code: t.code })}>
              <b>{t.name}</b>
              <p>{t.team_a_name} vs {t.team_b_name} · code {t.code}</p>
            </button>
          ))}
      </div>
    </div>
  );
}
