import React, { useMemo, useState } from "react";
// @ts-expect-error React DOM is an existing JavaScript dependency.
import { createRoot } from "react-dom/client";
import { createMarketingClient } from "../core/index.js";
import { MarketingRoot, MarketingWorkspace } from "../react/index.js";
import "./style.css";

function App() {
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]),
    [project, setProject] = useState(""),
    [login, setLogin] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [checked, setChecked] = useState(false);
  async function me() {
    try {
      const response = await fetch("/api/me");
      if (response.ok) {
        const data = await response.json();
        setProjects(data.projects);
        setProject(data.projects[0]?.id || "");
      } else if (response.status !== 401) {
        setError("Session lookup failed. Retry signing in.");
      }
    } catch {
      setError("Cannot reach the workspace. Retry signing in when connected.");
    } finally {
      setChecked(true);
    }
  }
  React.useEffect(() => {
    void me();
  }, []);
  const client = useMemo(() => createMarketingClient("", project), [project]);
  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: login, password }),
      });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setPassword("");
      await me();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!checked)
    return (
      <main className="loading" role="status">
        Loading your session…
      </main>
    );
  if (!projects.length)
    return (
      <main className="login">
        <div className="brand">
          <span>h.</span> Handrail
        </div>
        <div className="eyebrow">MARKETING WORKSPACE</div>
        <h1>
          Your campaign.
          <br />
          One clear story.
        </h1>
        <p>
          Sign in to connect accounts, create material and review the
          commitment.
        </p>
        <form onSubmit={(e) => void signIn(e)}>
          <label>
            Username
            <input
              name="username"
              autoComplete="username"
              required
              value={login}
              onChange={(e) => setLogin(e.target.value)}
            />
          </label>
          <label>
            Password
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="error">
              {error.replaceAll("_", " ")}
            </p>
          )}
          <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        </form>
      </main>
    );
  return (
    <>
      <div className="session-bar">
        <label>
          Project
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          onClick={async () => {
            try {
              const response = await fetch("/api/logout", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{}",
              });
              if (!response.ok) throw new Error("logout_failed");
              setError("");
              setProjects([]);
            } catch {
              setError("Sign out failed. Reconnect and retry.");
            }
          }}
        >
          Sign out
        </button>
        {error && <p role="alert">{error}</p>}
      </div>
      <MarketingWorkspace client={client} />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<MarketingRoot><App /></MarketingRoot>);
