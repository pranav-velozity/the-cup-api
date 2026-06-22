import { useAuth } from "@clerk/clerk-react";
import { useCallback } from "react";

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
export const API_BASE = BASE;

// Low-level authed fetch. Throws Error(server message) on non-2xx.
export function useApi() {
  const { getToken } = useAuth();
  return useCallback(
    async function api(path, options = {}) {
      const token = await getToken();
      const res = await fetch(`${BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
      if (res.status === 204) return null;
      let body = null;
      try { body = await res.json(); } catch { /* non-JSON */ }
      if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
      return body;
    },
    [getToken]
  );
}

// Convenience helpers built on top of the raw client.
export function useScoreApi() {
  const api = useApi();
  return {
    board: (code) => api(`/api/score/${code}/board`),
    scoreHole: (matchId, hole, result, clientTs) =>
      api(`/api/score/matches/${matchId}/holes/${hole}`, {
        method: "PUT",
        body: JSON.stringify({ result, clientTs }),
      }),
    batch: (writes) =>
      api(`/api/score/batch`, { method: "PUT", body: JSON.stringify({ writes }) }),
  };
}
