import { createContext, useContext, useState, useCallback } from "react";

const Nav = createContext(null);
export const useNav = () => useContext(Nav);

// Minimal screen state machine (mirrors the prototype's navigation).
// screen: 'home' | 'create' | 'join' | 'admin' | 'hub' | 'roster' |
//         'pairings' | 'board' | 'entry'
export function NavProvider({ children }) {
  const [screen, setScreen] = useState("home");
  const [code, setCode] = useState(null);     // current tournament code
  const [entry, setEntry] = useState(null);   // { matchId, hole }
  const [stack, setStack] = useState([]);

  const go = useCallback((next, opts = {}) => {
    setStack((s) => [...s, { screen, code }]);
    if (opts.code !== undefined) setCode(opts.code);
    if (opts.entry !== undefined) setEntry(opts.entry);
    setScreen(next);
  }, [screen, code]);

  const back = useCallback(() => {
    setStack((s) => {
      const prev = s[s.length - 1];
      if (prev) { setScreen(prev.screen); setCode(prev.code); }
      else setScreen("home");
      return s.slice(0, -1);
    });
  }, []);

  const reset = useCallback((next = "home") => {
    setStack([]); setCode(null); setEntry(null); setScreen(next);
  }, []);

  return (
    <Nav.Provider value={{ screen, code, entry, go, back, reset, setCode, setEntry }}>
      {children}
    </Nav.Provider>
  );
}
