import React, { useEffect, useRef, useState } from "react";
import type { ConnectionCatalogue, ConnectionCommands, ConnectionProvider, ConnectionView, MarketingClient, Permission } from "../core/index.js";

/** SDK-owned manual journey. Replace client/sessionKey on project, login or logout changes. */
export function MarketingConnections({ client, sessionKey = "", embedded = false, onContinue }: {
  client: MarketingClient; sessionKey?: string; embedded?: boolean; onContinue?: (grantId: string | null) => void;
}) {
  const [scope, setScope] = useState({ client, sessionKey, revision: 0 });
  if (scope.client !== client || scope.sessionKey !== sessionKey) setScope({ client, sessionKey, revision: scope.revision + 1 });
  return <div className={embedded ? "connections" : "marketing-root connections"}><ConnectionsContent key={scope.revision} client={client} embedded={embedded} onContinue={onContinue} /></div>;
}
const names = { meta: "Meta", google: "Google Ads", linkedin: "LinkedIn", openai: "OpenAI · Images", xai: "xAI · Video" };
const failureCopy: Record<string, string> = {
  provider_read_unavailable: "The provider check could not finish. Your choices are saved. Retry verification or refresh accounts.",
  provider_access_expired_or_denied: "Provider access expired or was denied. Review fresh access or check your provider account permissions.",
  provider_account_context_changed: "The provider account, currency or timezone changed. Choose the account again and review its access.",
  provider_identity_mismatch: "The selected Page, organization or manager no longer matches this account. Choose the account and identity again.",
  provider_account_role_missing: "Your provider role does not cover the requested operations. Check account permissions or reconnect with narrower access.",
  project_access_decision_stale: "The project access review expired. Choose the saved account again and approve a fresh exact review.",
  unresolved_connection_exists: "A saved setup still needs attention. Return to Connections and resume or cancel it before starting another.",
  revision_conflict: "This setup changed in another request. Reload saved progress before continuing.",
  connection_policy_denied: "The requested access or duration is outside this project's policy. Choose narrower access or ask the project administrator to review the policy.",
  connection_configuration_changed: "Your administrator changed the connection configuration. Cancel the saved setup and review fresh access.",
  linkedin_app_capability_missing: "Publishing needs the administrator to qualify the Advertising API app identity and enabled scopes. Reporting can be connected separately.",
  provider_scope_missing: "LinkedIn did not confirm the exact reviewed scopes. Cancel this setup and review fresh exact consent; Page discovery and publishing are blocked.",
  provider_page_role_missing: "Publishing needs approved Page administrator or direct sponsored content poster access for this account's organization. Check Page access or connect reporting only. No broader access is requested automatically.",
  provider_member_mismatch: "LinkedIn returned a different member than the selected account's member. Refresh accounts and review the correct identity.",
  provider_member_or_role_changed: "The selected LinkedIn member or account role changed. Refresh accounts and approve a fresh review.",
  provider_discovery_incomplete: "LinkedIn discovery is incomplete or inconsistent. No access was verified. Refresh accounts to retry the bounded discovery check.",
};
const phaseCopy: Record<ConnectionView["phase"], string> = {
  requirements: "Ready to review requirements", blocked: "Administrator setup needed", reviewing_provider_access: "Review provider authorization",
  waiting_human: "Waiting for your consent", discovering: "Checking available accounts and identities", choosing_account: "Choose your advertising account",
  choosing_identity: "Choose your publishing or manager context", reviewing_access: "Review project access", verifying: "Verify selected access",
  verified: "Account access verified", failed_retryable: "Check interrupted", outcome_unknown: "Checking an uncertain outcome", reconciling: "Checking saved outcome",
  cancelling: "Finishing cancellation", cancelled: "Setup cancelled", needs_reauthorization: "Fresh access review needed",
};
const steps = ["Requirements", "Discover", "Choose account", "Review access", "Verify"];
function step(v: ConnectionView) {
  if (["cancelled", "cancelling"].includes(v.phase)) return -1;
  if (v.phase === "needs_reauthorization") return v.providerAuthorized.status === "verified" ? 3 : 1;
  if (["requirements", "blocked"].includes(v.phase)) return 0;
  if (["reviewing_provider_access", "waiting_human", "reconciling", "outcome_unknown"].includes(v.phase)) return 1;
  if (["discovering", "choosing_account", "choosing_identity"].includes(v.phase)) return 2;
  if (v.phase === "reviewing_access") return 3; return 4;
}
function ConnectionsContent({ client, embedded, onContinue }: { client: MarketingClient; embedded: boolean; onContinue?: (grantId: string | null) => void }) {
  const [catalogue, setCatalogue] = useState<ConnectionCatalogue | null>(null), [current, setCurrent] = useState<ConnectionView | null>(null);
  const [provider, setProvider] = useState<ConnectionProvider | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [mode, setMode] = useState<"report" | "campaign">("report"), [hours, setHours] = useState("1"), [offline, setOffline] = useState(false);
  const [account, setAccount] = useState(""), [identities, setIdentities] = useState<string[]>([]), [approved, setApproved] = useState(false), [confirmCancel, setConfirmCancel] = useState(false);
  const cancelKeep = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null), alert = useRef<HTMLDivElement>(null), active = useRef(true), latch = useRef(false);
  const pending = useRef<{ command: keyof ConnectionCommands; input: any } | null>(null);
  const [unresolved, setUnresolved] = useState(false);
  const abort = useRef(new AbortController());
  const storageKey = useRef("");
  const readSequence = useRef(0);
  const remember = (id: string | null) => { try { if (storageKey.current) { if (id) sessionStorage.setItem(storageKey.current, id); else sessionStorage.removeItem(storageKey.current); } } catch { /* server checkpoints still work without browser storage */ } };
  useEffect(() => {
    active.current = true; abort.current = new AbortController(); void refresh();
    const reread = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", reread);
    return () => { active.current = false; abort.current.abort(); window.removeEventListener("focus", reread); };
  }, []);
  useEffect(() => { setAccount(""); setIdentities([]); setApproved(false); setConfirmCancel(false); }, [current?.id, current?.revision]);
  useEffect(() => { if (confirmCancel) cancelKeep.current?.focus(); }, [confirmCancel]);
  async function refresh() {
    const sequence = ++readSequence.current;
    try {
      const v = await client.call("connections", {}, { signal: abort.current.signal }); if (!active.current || sequence !== readSequence.current) return;
      setCatalogue(v); setError(""); storageKey.current = `marketing.connections.active:${v.project.id}`;
      let retained: string | null = null; try { retained = sessionStorage.getItem(storageKey.current); } catch { /* optional */ }
      setCurrent(old => v.connections.find(c => c.id === (old?.id ?? retained)) ?? null);
    } catch (e) { if (sequence === readSequence.current) fail(e); }
  }
  function fail(e: unknown) {
    if (!active.current) return;
    const message = e instanceof Error ? e.message : "connection_read_unavailable";
    const authorityLost = /authentication|forbidden|session_changed|authority_changed/.test(message);
    if (authorityLost) { setCurrent(null); setCatalogue(null); setProvider(null); }
    setError(authorityLost ? "Your session or project access changed. Sign in again and reload Connections." : failureCopy[message] ?? "The request could not finish. Reload saved progress, then retry the original request if needed.");
    setTimeout(() => alert.current?.focus(), 0);
  }
  async function request<K extends keyof ConnectionCommands>(command: K, input: ConnectionCommands[K]["input"], repeat = false) {
    if (latch.current) return; latch.current = true; setBusy(true); setError("");
    ++readSequence.current;
    if (!repeat) pending.current = { command, input };
    try {
      const result = await client.call(command, input, { signal: abort.current.signal }); if (!active.current) return;
      if ("phase" in result) { remember(result.id); setCurrent(result); setProvider(null); }
      pending.current = null; setUnresolved(false); await refresh();
      if (active.current) setTimeout(() => heading.current?.focus(), 0);
    } catch (e) { if (active.current) setUnresolved(true); fail(e); }
    finally { latch.current = false; if (active.current) setBusy(false); }
  }
  const transition = (command: keyof ConnectionCommands, extra: Record<string, unknown> = {}) => {
    if (!current) return;
    void request(command, { connectionId: current.id, expectedRevision: current.revision, requestKey: crypto.randomUUID(), ...extra } as never);
  };
  const card = catalogue?.providers.find(c => c.provider.provider === (provider?.provider ?? current?.provider.provider));
  const readProgress = async () => {
    if (!current) return;
    const sequence = ++readSequence.current;
    try { const v = await client.call("connection", { connectionId: current.id }, { signal: abort.current.signal }); if (active.current && sequence === readSequence.current) { setCurrent(v); setError(""); } } catch (e) { if (sequence === readSequence.current) fail(e); }
  };
  const back = () => { remember(null); setCurrent(null); setProvider(null); setError(""); void refresh(); setTimeout(() => heading.current?.focus(), 0); };
  const review = current?.accessReview;
  const canApprove = catalogue?.canApprove ?? false;
  const completedSteps = current ? [current.configured.status === "verified", current.providerAuthorized.status === "verified", !!current.account && current.phase !== "choosing_identity", current.consented.status === "verified", current.accountVerified.status === "verified"] : [];
  const Heading = embedded ? "h2" : "h1";
  return <section className="connections-content" aria-busy={busy}>
    <Heading ref={heading} tabIndex={-1}>{current ? `Connect ${names[current.provider.provider]}` : provider ? `${names[provider.provider]} requirements` : "Your marketing connections"}</Heading>
    {catalogue && <p className="connection-project">Project: {catalogue.project.name} · {catalogue.evidence === "fixture" ? "SYNTHETIC HTTP FIXTURE · no live provider access or spend" : "Account-specific evidence required"}</p>}
    {error && <div role="alert" tabIndex={-1} ref={alert} className="error"><p>{error}</p><button onClick={() => void refresh()} disabled={busy}>Reload saved progress</button>
      {unresolved && pending.current && <button className="secondary" disabled={busy} onClick={() => { const p = pending.current!; void request(p.command, p.input, true); }}>Retry original request</button>}
      <p>A failed response does not prove that an operation failed. Retry retains the original request identity.</p></div>}
    {busy && <p role="status">Saving or checking with the provider… Keep this tab or return to saved progress.</p>}
    {!catalogue && <p role="status">Loading authenticated Connections…</p>}
    {(provider || current) && <div className="actions"><button className="secondary" onClick={back} disabled={busy}>Back to Connections · save and close</button>{current && <button className="secondary" onClick={() => void readProgress()} disabled={busy}>Check progress</button>}</div>}
    {catalogue && !provider && !current && <>
      <p className="intro">Connect an advertising account, choose its context, and review exact access. You can save campaign ideas while setup is in progress.</p>
      {!catalogue.canStart && <p>An editor or administrator can start setup. You can inspect requirements and safe progress.</p>}
      {(["advertising", "creative"] as const).map(group => <section key={group} aria-label={group === "advertising" ? "Advertising" : "Creative AI"}>
        <h2>{group === "advertising" ? "Advertising" : "Creative AI"}</h2><div className="connection-cards">{catalogue.providers.filter(c => c.provider.kind === group).map(c => <article className="card" key={c.provider.provider}>
          <div className="eyebrow">{group === "advertising" ? "Advertising account" : "Separate generation authority"}</div><h3>{c.label}</h3><p>{c.description}</p>
          <span className="badge">{c.configured ? "Available to connect" : group === "creative" ? "Setup not yet available" : "Host setup needed"}</span>
          <ul>{c.limitations.map(l => <li key={l}>{l}</li>)}</ul>
          <p>Next: {group === "creative" ? c.configured ? "you, in private secure setup" : "project administrator" : c.configured && catalogue.canStart ? "you" : "project administrator"}</p>
          <button onClick={() => { setOffline(false); setMode("report"); setProvider(c.provider); setTimeout(() => heading.current?.focus(), 0); }}>{c.configured && catalogue.canStart ? `Connect ${c.label}` : `View ${c.label} setup requirements`}</button>
          {catalogue.connections.filter(v => v.provider.provider === c.provider.provider).map(v => <div className="connection-saved" key={v.id}><strong>{v.account?.label || "Saved setup"}</strong><p>{phaseCopy[v.phase]} · {new Date(v.updatedAt).toLocaleString()}</p><button className="secondary" onClick={() => { remember(v.id); setCurrent(v); setTimeout(() => heading.current?.focus(), 0); }}>{v.phase === "verified" ? "View connection" : v.phase === "cancelled" ? "View cancelled setup" : "Resume setup"}</button></div>)}
        </article>)}</div>
      </section>)}
      <p>{catalogue.assistance.reason}</p>
      {onContinue && <button className="secondary" onClick={() => onContinue(null)}>Create a draft</button>}
      {catalogue.historical.length > 0 && <section aria-label="Historical account connections"><h2>Existing account connections</h2><p>Historical grants keep their original setup and resume path.</p>{catalogue.historical.map(({ grant, setup }) => <article className="card" key={grant.id}><h3>{grant.label}</h3><p>{names[grant.provider]} · …{grant.accountId.slice(-4)} · {grant.currency} · {grant.timezone}</p><p>{grant.revokedAt ? "Access revoked" : Date.parse(grant.expiresAt) <= Date.now() ? "Access expired" : setup?.state || "Not verified"}</p><p>{setup?.reason?.replaceAll("_", " ")}</p><button disabled={busy || !catalogue.canStart} onClick={async () => {
        try { if (setup) await client.call("resumeSetup", { setupId: setup.id, expectedRevision: setup.revision }); else await client.call("setup", { grantId: grant.id, requestKey: crypto.randomUUID() }); await refresh(); } catch (e) { fail(e); }
      }}>Resume and verify existing access</button>{setup?.handoffUrl && (catalogue.evidence === "fixture" ? <button className="secondary" disabled={busy || !catalogue.canApprove} onClick={async () => {
        try { const r = await fetch(setup.handoffUrl!, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: abort.current.signal }); if (!r.ok) throw new Error("fixture_takeover_denied"); await refresh(); } catch (e) { fail(e); }
      }}>Confirm fixture takeover</button> : <a className="button secondary" href={setup.handoffUrl}>Continue existing secure setup</a>)}</article>)}</section>}
    </>}
    {(provider || current?.phase === "blocked") && card && <article className="card">
      <h2>Requirements</h2><p>{card.description}</p><ul>{card.limitations.map(l => <li key={l}>{l}</li>)}</ul>
      {card.requirements.map(r => <section key={r.code}><h3>{card.provider.kind === "creative" ? "Product integration needed" : "Administrator action required"}</h3><p>{r.explanation}</p><p>Next: {card.provider.kind === "creative" ? "product integration owner" : "project administrator"}</p></section>)}
      {card.callbackUri && <details><summary>Administrator callback configuration</summary><p>Register this exact callback with the provider. Bind the OAuth app and existing cipher on the server.</p><code>{card.callbackUri}</code></details>}
      {card.configured && catalogue?.canStart && provider?.kind === "advertising" && <>
        <p>You need access to your advertising account{provider.provider === "meta" ? " and a Page for publishing" : provider.provider === "linkedin" ? " and its organization for publishing" : " and its customer or manager context"}. No campaign is created during setup.</p>
        <fieldset><legend>Intended project access</legend><label className="check"><input type="radio" name="connection-intent" checked={mode === "report"} onChange={() => setMode("report")} /> Setup and reporting</label><label className="check"><input type="radio" name="connection-intent" checked={mode === "campaign"} onChange={() => setMode("campaign")} /> Setup, reporting and later campaign operations (each action still requires its own checks)</label></fieldset>
        {provider.provider === "linkedin" && <p>Reporting access is separate from publishing. Publishing requires an Advertising API app scope configuration, a campaign-capable account role and approved Page access. This SDK uses only the account-associated organization as campaign entity and post author; a personal account reference cannot publish organization ads.</p>}
        <label>Project access duration (hours)<input type="number" min="0.1" step="0.1" value={hours} onChange={e => setHours(e.target.value)} /></label>
        {provider.provider === "google" && <label className="check"><input type="checkbox" checked={offline} onChange={e => setOffline(e.target.checked)} /> Explicitly request offline refresh access where supported by provider and host policy</label>}
        <button disabled={busy || !Number.isFinite(Number(hours)) || Number(hours) <= 0} onClick={() => {
          const permissions: Permission[] = mode === "report" ? ["setup", "report"] : ["setup", "report", "prepare", "activate", "pause"];
          void request("startConnection", { provider, intent: { kind: "advertising", operations: permissions }, expiresAt: new Date(Date.now() + Number(hours) * 3600000).toISOString(), offlineAccess: offline, requestKey: crypto.randomUUID() });
        }}>Continue with {names[provider.provider]}</button>
      </>}
      {card.secureSetupPath && <a className="button" href={card.secureSetupPath}>Open private creative setup</a>}
      {card.creativeBindings?.map(b => <section key={b.id}><h3>{b.model} · {b.credential}</h3><p>{b.environment} · Expires {b.expiresAt}</p><p>Provider unverified · Billing {b.billing.state} · Paid operation blocked</p><a href={b.path}>Manage creative binding</a></section>)}
      {card.provider.kind === "creative" && <p>Existing configured generation access remains separate. Use the SDK private secure setup to review persistent access and enter an existing key. Credentials stay outside this workspace. Configuration does not prove model entitlement or paid readiness.</p>}
    </article>}
    {current && <>
      <ol className="connection-steps" aria-label="Connection progress">{steps.map((s, i) => <li key={s} aria-current={step(current) === i ? "step" : undefined}><strong>{i + 1}. {s}</strong><span>{step(current) === i ? "Current" : completedSteps[i] ? "Complete" : current.phase === "cancelled" ? "Not completed" : "Waiting"}</span></li>)}</ol>
      <div className="connection-layout"><article className="card connection-main">
        <h2>{phaseCopy[current.phase]}</h2><p role="status">{failureCopy[current.checkpoint] ?? (/^[a-z][a-z0-9_]*$/.test(current.checkpoint) ? "This setup needs a fresh check. Reload saved progress, then retry or cancel and review access again." : current.checkpoint)}</p><p><strong>Next: {current.currentActor === "sdk" ? "automatic provider check" : current.currentActor === "host_admin" ? "project administrator" : "you"}</strong></p>
        <p className="muted">Saved {new Date(current.updatedAt).toLocaleString()} · revision {current.revision}</p>
        {current.account && <section><h3>{current.account.label}</h3><p>{current.account.businessLabel} · {current.account.displayId ?? `…${current.account.accountSuffix}`} · {current.account.currency} · {current.account.timezone}</p><p>{current.account.roleSummary}</p>{current.account.limitations.map(l => <p key={l}>{l}</p>)}{current.identities.map(i => <p key={i.choiceRef}>{i.label} · {i.kind.replaceAll("_", " ")} · {i.displayId ?? `…${i.accountSuffix}`}</p>)}</section>}
        {catalogue?.canApprove && !current.grantId && current.actions.some(a => !a.available) && <button disabled={busy} onClick={() => transition("reassignConnection")}>Take over setup with this session</button>}
        {current.account && !current.grantId && !["discovering", "outcome_unknown", "cancelling", "cancelled"].includes(current.phase) && <button className="secondary" disabled={busy} onClick={() => transition("discoverConnectionAccounts")}>Choose another account · review access again</button>}
        {review && <section className="connection-review" aria-label="Exact access review"><h3>{review.purpose === "provider_authorization" ? "Review provider authorization" : review.purpose === "project_binding" ? "Review project access" : "Review local revocation"}</h3><p>{review.summary}</p>
          {review.oauthScopes.length > 0 && <><h4>Exact OAuth scopes</h4><ul>{review.oauthScopes.map(s => <li key={s}><code>{s}</code></li>)}</ul><p>{review.providerAccountRange}</p><p>{review.offlineAccess ? "Offline refresh access requested" : "No offline refresh requested"}</p></>}
          <p>{review.providerLifetime}</p><p>Project access expiry: {review.projectAccessExpiresAt}. Decision expires: {review.expiresAt}.</p>
          <label className="check"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /> I reviewed this exact action, scope and duration.</label>
          {!canApprove && <p>A current human editor or administrator must make this decision. Agent approval is not permitted.</p>}
          <div className="actions"><button disabled={busy || !approved || !canApprove} onClick={() => transition(review.purpose === "provider_authorization" ? "decideConnectionProviderAccess" : review.purpose === "project_binding" ? "decideConnectionAccess" : "decideConnectionRevocation", { decisionRef: review.decisionRef, digest: review.digest, decision: "approved" })}>{review.purpose === "provider_authorization" ? "Approve provider access for discovery" : review.purpose === "project_binding" ? "Approve this connection's access" : "Revoke this local access"}</button>
          <button className="secondary" disabled={busy || !canApprove} onClick={() => transition(review.purpose === "provider_authorization" ? "decideConnectionProviderAccess" : review.purpose === "project_binding" ? "decideConnectionAccess" : "decideConnectionRevocation", { decisionRef: review.decisionRef, digest: review.digest, decision: "rejected" })}>Decline</button></div></section>}
        {current.phase === "choosing_account" && <fieldset><legend>Choose an advertising account</legend>
          {current.discovery.accounts.map(a => <label className="connection-choice" key={a.choiceRef}><input type="radio" name="account" checked={account === a.choiceRef} onChange={() => setAccount(a.choiceRef)} /><span><strong>{a.label}</strong><br />{a.businessLabel} · {a.displayId ?? `…${a.accountSuffix}`}<br />{a.currency} · {a.timezone}<br />Timezone source: {a.timezoneSource.replaceAll("_", " ")}<br />{a.roleSummary}</span></label>)}
          <p role="status">{current.discovery.accounts.length} account choices. {current.discovery.complete ? "All pages received." : "More pages remain; this is a partial list."}</p>
          <button disabled={busy || !account} onClick={() => transition("selectConnectionAccount", { choiceRef: account })}>Use selected account</button>
          {current.discovery.cursor && <button className="secondary" disabled={busy} onClick={() => transition("discoverConnectionAccounts", { cursor: current.discovery.cursor })}>Load more accounts</button>}
        </fieldset>}
        {current.phase === "choosing_identity" && <fieldset><legend>Choose publishing or manager context</legend>
          {current.discovery.identities.map(i => <label className="connection-choice" key={i.choiceRef}><input type={i.kind === "instagram" || current.provider.provider === "meta" ? "checkbox" : "radio"} name="identity" checked={identities.includes(i.choiceRef)} onChange={e => setIdentities(old => current.provider.provider === "meta" ? e.target.checked ? [...old, i.choiceRef] : old.filter(x => x !== i.choiceRef) : [i.choiceRef])} /><span><strong>{i.label}</strong><br />{i.kind.replaceAll("_", " ")} · {i.displayId ?? `…${i.accountSuffix}`}</span></label>)}
          <button disabled={busy || !identities.length} onClick={() => transition("selectConnectionIdentity", { choiceRefs: identities })}>Use selected identity</button>
          <p>{current.discovery.complete ? "All identity pages received." : "More identity pages may remain."}</p>
          {current.discovery.cursor && <button className="secondary" disabled={busy} onClick={() => transition("connectionIdentities", { cursor: current.discovery.cursor })}>Load more identities</button>}
        </fieldset>}
        {current.handoffPath && <section><h3>Complete consent securely</h3><p>Expected provider: {current.provider.provider === "meta" ? "www.facebook.com" : current.provider.provider === "google" ? "accounts.google.com" : "www.linkedin.com"}. Login, MFA and provider terms stay there. Return to this saved step afterwards.</p><a className="button" href={current.handoffPath}>Continue securely with {names[current.provider.provider]}</a><p>This same-tab continuation also works when popups are blocked.</p></section>}
        <div className="actions">{current.actions.filter(a => a.action !== "cancel" && !(review && ["review_provider", "review_access", "revoke"].includes(a.action)) && !(a.action === "handoff" && current.handoffPath)).map(a => <React.Fragment key={a.action}><button className="secondary" disabled={busy || !a.available} onClick={() => {
          if (a.action === "requirements" || a.action === "reconnect") { remember(null); setProvider(current.provider); setCurrent(null); return; }
          const commands = { review_provider: "reviewConnectionProviderAccess", handoff: "beginConnectionHandoff", discover: "discoverConnectionAccounts", identities: "connectionIdentities", review_access: "reviewConnectionAccess", verify: "resumeConnection", reconcile: "reconcileConnection", revoke: "reviewConnectionRevocation" } as const;
          if (a.action in commands) transition(commands[a.action as keyof typeof commands]);
        }}>{a.label}</button>{a.reason && <p>{a.reason}</p>}</React.Fragment>)}</div>
        {current.phase === "verified" && <><p>Account verification does not approve launch or generation spend.</p>{onContinue && <button onClick={() => onContinue(current.grantId)}>Continue to campaign</button>}<button className="secondary" onClick={() => { remember(null); setProvider(current.provider); setCurrent(null); }}>Connect another account</button></>}
        {current.actions.some(a => a.action === "cancel" && a.available) && <section>{!confirmCancel ? <button className="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel setup</button> : <div role="group" aria-label="Confirm cancellation"><p>Cancel local setup? Existing provider authorization may remain. In-flight outcomes will be retained for recovery.</p><button ref={cancelKeep} className="secondary" onClick={() => { setConfirmCancel(false); setTimeout(() => heading.current?.focus(), 0); }}>Keep setup</button><button disabled={busy} onClick={() => transition("cancelConnection")}>Confirm cancel setup</button></div>}</section>}
      </article><aside className="card connection-evidence"><h2>Access and evidence</h2><p>These are separate facts; sign-in never means ready to launch.</p><dl>{([
        ["Host configuration", current.configured], ["Provider authorization", current.providerAuthorized], ["Project access decision", current.consented], ["Account verification", current.accountVerified], ["Campaign capability", current.capabilityVerified],
      ] as const).map(([label, e]) => <React.Fragment key={label}><dt>{label}</dt><dd>{e.status.replaceAll("_", " ")} · {e.basis.replaceAll("_", " ")}{e.observedAt && <><br />Observed {new Date(e.observedAt).toLocaleString()}</>}{e.expiresAt && <><br />Expires {new Date(e.expiresAt).toLocaleString()}</>}{e.reason && <p>{e.reason}</p>}</dd></React.Fragment>)}</dl>{current.readiness.map(r => <p key={r.action}><strong>{r.action}:</strong> {r.ready ? "Verified for this action" : r.blockers.join(". ")}</p>)}</aside></div>
    </>}
  </section>;
}
