"use client";
import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { makeTrpcClient } from "@oracle-duval/api-client/react";
import { trpc } from "../lib/trpc";
import { API_URL, getToken, setToken, clearToken } from "../lib/config";

/** In-app access gate: the data API is behind auth; the operator pastes the access token (from the
 *  PR) once, it is kept in sessionStorage and sent as a Bearer header — never baked into the bundle. */
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [client] = useState(() => makeTrpcClient({ url: API_URL, getToken }));
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAuthed(getToken() != null);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setToken(input.trim());
    try {
      const res = await fetch(`${API_URL}/pipeline.summary`, { headers: { authorization: `Bearer ${input.trim()}` } });
      if (res.status === 200) setAuthed(true);
      else {
        clearToken();
        setError("Invalid access token.");
      }
    } catch {
      clearToken();
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  if (authed === null) return <div className="center muted">Loading…</div>;

  if (!authed) {
    return (
      <div className="gate">
        <div className="gate-card">
          <h1>Oracle Property Intelligence</h1>
          <p className="muted">Duval County, FL — authenticated data console.</p>
          <form onSubmit={submit}>
            <label htmlFor="token">Access token</label>
            <input id="token" type="password" value={input} onChange={(e) => setInput(e.target.value)} placeholder="duval-…" autoFocus />
            <button type="submit" disabled={busy || input.trim().length < 6}>{busy ? "Checking…" : "Enter"}</button>
            {error && <p className="err">{error}</p>}
          </form>
          <p className="muted small">The token gates the server-only data API. Full data lives in the authenticated hosted layer; owner PII is never sent to the client.</p>
        </div>
      </div>
    );
  }

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
