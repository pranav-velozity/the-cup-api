import { T } from "./theme.js";

export function Avatar({ team, size = 44 }) {
  const bg = team?.color || T.teamA;
  const kind = team?.kind || "crest";
  const logo = team?.logoUrl || team?.logo_url;
  const initials = (team?.name || "T")
    .split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div className="crest" style={{ width: size, height: size, background: bg, fontSize: size * 0.34, overflow: "hidden" }}>
      {kind === "logo" && logo
        ? <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : kind === "emoji" && team?.emoji
        ? <span style={{ fontSize: size * 0.5 }}>{team.emoji}</span>
        : initials}
    </div>
  );
}

export function Bar({ title, onBack }) {
  return (
    <div className="bar">
      {onBack ? (
        <button className="back" onClick={onBack}>‹ {title || "Back"}</button>
      ) : (
        <span style={{ fontWeight: 700 }}>{title}</span>
      )}
      <span className="wordmark">TOTO</span>
    </div>
  );
}

const IC = {
  home: <path d="M3 11l9-8 9 8M5 10v10h14V10" />,
  create: <path d="M12 5v14M5 12h14" />,
  play: <path d="M8 5v14l11-7z" />,
  admin: <path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6z" />,
};

export function BottomNav({ active, go, isAdmin }) {
  const item = (key, label, path) => (
    <button className={`navbtn${active === key ? " on" : ""}`} onClick={() => go(key)}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round">{path}</svg>
      <span>{label}</span>
    </button>
  );
  return (
    <div className="bottomnav">
      {item("home", "Home", IC.home)}
      {item("create", "Create", IC.create)}
      {item("join", "Play", IC.play)}
      {isAdmin && item("admin", "Admin", IC.admin)}
    </div>
  );
}

export function Splash({ onDone }) {
  return (
    <div className="splash" onAnimationEnd={onDone}>
      <div className="sp-word">TOTO</div>
      <div className="sp-tag">
        <span className="c">Compete… </span>
        <span className="d">मगर प्यार से</span>
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="center" style={{ padding: 50 }}><div className="spin" /></div>;
}
