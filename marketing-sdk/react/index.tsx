import { AudienceClientContext } from "./audience.js";
import { CampaignPrerequisites } from "./preflight.js";
import { MarketingTracking, TrackingReadiness } from "./tracking.js";
export { MarketingTracking } from "./tracking.js";
import { CampaignStudio } from "./studio.js";
export { CampaignStudio } from "./studio.js";
import { useVisibleRefresh } from "./lifecycle.js";
import { MarketingConnections } from "./connections.js";
export { MarketingConnections } from "./connections.js";
import { AudienceFields, GuidedFields, GuidedMaterialEditor, DraftCard, initialMaterial, DraftPromotion } from "./guided.js";
import { TRACKING_OUTCOMES, capabilityBlockers, dailyExposureMinor, providerBudgetBlockers } from "../core/index.js";
import React, { useEffect, useRef, useState } from "react";
import { planningWrite } from "./planning.js";
import { completedCampaignWindow, dateAtInstant, selectedCompletedWindow } from "./schedule.js";
import type {
  Asset,
  Conversation,
  MarketingClient,
  Material,
  Packet,
  PublicGrant,
  Results,
  Workspace,
} from "../core/index.js";

/** Styling and container boundary for standalone panels or host-owned session UI. */
export function MarketingRoot({ className = "", ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={`marketing-root ${className}`.trim()} />;
}

export function MaterialReview({
  material,
  assets,
  client,
  grant,
}: {
  material: Material;
  assets: Asset[];
  client: MarketingClient;
  grant?: PublicGrant;
}) {
  const selectedGrant = grant?.provider === material.settings?.provider && grant?.accountId === material.settings?.accountId ? grant : undefined;
  const identityLabel = (kind: NonNullable<PublicGrant["selectionOptions"]>[number]["kind"], id: string | undefined, fallback: string) =>
    selectedGrant?.selectionOptions?.find(option => option.kind === kind && option.id === id)?.label || fallback;
  return (
    <div className="material-review">
      <div className="creative-preview">
        {assets.map((a) => (
          <figure key={a.id}>
            {a.kind === "video" ? (
              <video controls preload="metadata" src={client.assetUrl(a.id)} />
            ) : a.kind === "image" ? (
              <img src={client.assetUrl(a.id)} alt={material.headline} />
            ) : (
              <p>Storyboard · planning text</p>
            )}
            <figcaption>
              {a.source} · {a.kind} · v{a.version}
            </figcaption>
          </figure>
        ))}
      </div>
      <h3>{material.headline}</h3>
      <p>{material.body}</p>
      <a href={material.destination} target="_blank" rel="noreferrer">
        {material.destination}
      </a>
      <dl>
        <dt>Purpose / goal</dt><dd>{material.purpose || "acquisition"}{material.applicantGoal && ` · ${material.applicantGoal.event} · completed MOU request`}</dd>
        <dt>Provider settings</dt><dd>{material.settings ? `${material.settings.provider} · ${material.settings.objective} · ${material.settings.optimization} · ${material.settings.format}` : "Legacy material — review the retained plan"}</dd>
        {material.settings && <><dt>Advertising account</dt><dd>{selectedGrant?.label || "Selected account (name not supplied)"}</dd><dt>Provider contract</dt><dd>API {material.settings.apiVersion} · {material.settings.version}</dd>
          {material.settings.provider === "meta" && <><dt>Delivery and bidding</dt><dd>{material.settings.delivery} · billed on impressions · lowest cost without cap</dd>
            <dt>Special ad category</dt><dd>{material.settings.specialAdCategory || "none"}{material.settings.specialAdCategoryCountry && ` · ${material.settings.specialAdCategoryCountry}`}</dd></>}
          {material.settings.conversion && <><dt>Exact conversion binding</dt><dd>{material.settings.provider === "meta" ? `${identityLabel("pixel", material.settings.conversion!.pixelId, "Selected Pixel")} · ${identityLabel("conversion", material.settings.conversion!.customConversionId, "Selected custom conversion")} · ${material.settings.conversion!.event}` : `${identityLabel("conversion", material.settings.conversion!.id, "Selected conversion")} · ${material.settings.conversion!.type} · ${material.settings.conversion!.event}`}</dd></>}
          <dt>Identity and placements</dt><dd>{material.settings.provider === "meta" ? <>{identityLabel("page", material.settings.identity.pageId, "Selected Page (name not supplied)")}{material.settings.identity.instagramUserId && ` · ${identityLabel("instagram", material.settings.identity.instagramUserId, "Selected Instagram identity (name not supplied)")}`}</> : identityLabel("organization", material.settings.identity.organizationId, "Selected organization (name not supplied)")} · {material.settings.placements.map(value => value.replaceAll("_", " ")).join(", ")}</dd>
          <dt>Audience</dt><dd>{material.audience.provider === "meta" ? material.audience.locations.map(code => /^[A-Z]{2}$/.test(code) ? new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? "Unresolved country" : "Unresolved country").join(", ") : material.audience.locations.join(", ")}{material.audience.ageMin !== undefined && ` · ages ${material.audience.ageMin}–${material.audience.ageMax}`} · expansion off</dd>
          {material.settings.provider === "linkedin" && <><dt>Bidding</dt><dd>{material.settings.bid.mode} · {material.settings.bid.costType}{material.settings.bid.mode === "manual" && ` · ${material.budget.currency} ${material.settings.bid.amountMinor / 100}`}</dd></>}
          <dt>Targeting details</dt><dd>{material.settings.provider === "meta" ? <>
            Languages: {material.settings.targeting.languages.map(x => x.label).join(", ") || "all"}. Interests: {material.settings.targeting.interestGroups.map(group => `(${group.map(x => x.label).join(" OR ")})`).join(" AND ") || "none"}. Excluded: {material.settings.targeting.excludedCustomAudiences.map(x => x.label).join(", ") || "none"}.
          </> : (["include", "exclude"] as const).map(side => <p key={side}>{side}: {Object.entries(material.settings!.provider === "linkedin" ? material.settings!.targeting[side] : {}).map(([facet, options]) => `${facet}: (${(options as { id: string; label: string }[]).map(x => x.label).join(" OR ")})`).join(side === "include" ? " AND " : " OR ") || "none"}</p>)}</dd>
        </>}
        <dt>Lifetime media budget</dt>
        <dd>
          {material.budget.currency} {(material.budget.minor / 100).toFixed(2)}{" "}
          · excludes fees/taxes
        </dd>
        {material.advertisingBudget?.daily && <>
          <dt>Daily media budget</dt>
          <dd>{material.advertisingBudget.daily.currency} {(material.advertisingBudget.daily.minor / 100).toFixed(2)}</dd>
        </>}
        {material.settings?.provider === "linkedin" && <><dt>Required daily reservation exposure (150%, bounded by lifetime)</dt><dd>{material.budget.currency} {((dailyExposureMinor(material) || 0) / 100).toFixed(2)}</dd></>}
        <dt>Delivery window</dt>
        <dd>
          {material.startAt} → {material.endAt} (exclusive)
          <br />
          {material.timezone}
        </dd>
      </dl>
      <p>Daily budgets are pacing targets. Required reservations are not observed spend or an independently enforceable daily cap. Managed media excludes fees and taxes; external campaigns need host coverage.</p>
      {providerBudgetBlockers(material).length > 0 && <p>Meta daily cap compatibility remains unverified; native preparation and activation are blocked.</p>}
      <details>
        <summary>Complete targeting, copy and destination snapshot</summary>
        <pre>{JSON.stringify(material, null, 2)}</pre>
      </details>
    </div>
  );
}
/** Optional embedded single launch gate; uses exactly the headless transport. */
export function ApprovalPanel({
  client,
  packet,
  grant,
  assets,
  canDecide,
  onChanged,
}: {
  client: MarketingClient;
  packet: Packet;
  grant?: PublicGrant;
  assets: Asset[];
  canDecide: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState(false);
  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError("");
    try {
      await client.call("decide", {
        packetId: packet.id,
        digest: packet.digest,
        decision,
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card approval-panel" aria-label="Launch approval">
      <div className="eyebrow">Human launch decision</div>
      <h2>Review this exact commitment</h2>
      <p>
        {grant?.accountId === packet.accountId ? grant.label : "Selected advertising account"} · campaign revision {packet.campaignRevision}
        . Authorization expires {new Date(packet.expiresAt).toLocaleString()}.
      </p>
      <MaterialReview
        material={packet.material}
        grant={grant}
        assets={assets}
        client={client}
      />
      <section aria-label="Tracking in this launch review"><h3>Tracking configuration in this review</h3>{packet.tracking ? <><p>{TRACKING_OUTCOMES[packet.tracking.outcome].label} · {packet.tracking.source.label} · {packet.tracking.source.environment}</p><p>{packet.tracking.ownerRevision !== packet.campaignRevision && "This configuration belongs to an earlier campaign revision. Review Tracking before relying on it. "}Saved Tracking revision {packet.tracking.revision} · {packet.tracking.destination}</p><p>Changing this configuration requires a new launch review. This snapshot does not prove production coverage, provider delivery or attribution.</p></> : <p>No first-party Tracking configuration was saved for this campaign when this review was created.</p>}</section>
      <details>
        <summary>Exact packet and paused provider objects</summary>
        <pre>{JSON.stringify(packet, null, 2)}</pre>
      </details>
      <label className="check">
        <input
          type="checkbox"
          checked={reviewed}
          onChange={(e) => setReviewed(e.target.checked)}
        />{" "}
        I reviewed the material, account, audience, budget and delivery window.
      </label>
      {error && (
        <p role="alert" className="error">
          {error.replaceAll("_", " ")}
        </p>
      )}
      <div className="actions">
        <button
          disabled={!canDecide || !reviewed || busy}
          onClick={() => void decide("approved")}
        >
          Authorize launch
        </button>
        <button
          className="secondary"
          disabled={!canDecide || busy}
          onClick={() => void decide("rejected")}
        >
          Request revision
        </button>
      </div>
      {!canDecide && (
        <p className="muted">A project approver must sign in to decide.</p>
      )}
    </section>
  );
}
const tabs = [
  "Workspace",
  "Connections",
  "Campaigns",
  "Creative",
  "Audience",
  "Launch",
  "Conversations",
  "Tracking",
  "Results",
] as const;
function ErrorNotice({ error, retry }: { error: string; retry: () => void }) {
  return error ? (
    <div role="alert" className="error">
      {error.replaceAll("_", " ")}{" "}
      <button className="secondary" onClick={retry}>
        Retry read
      </button>
    </div>
  ) : null;
}
function formatResultMoney(minor: number, currency: string) {
  const formatter = new Intl.NumberFormat(undefined, { style: "currency", currency });
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;
  return formatter.format(minor / 10 ** digits);
}
const key = () => crypto.randomUUID();
export function MarketingWorkspace({ client, visible = true, sessionKey = "" }: { client: MarketingClient; visible?: boolean; sessionKey?: string }) {
  // Changing transport/project also discards drafts, errors and pending views.
  const [scope, setScope] = useState({ client, sessionKey, version: 0 });
  if (scope.client !== client || scope.sessionKey !== sessionKey)
    setScope({ client, sessionKey, version: scope.version + 1 });
  return visible ? <MarketingRoot><AudienceClientContext.Provider value={client}><WorkspaceContent key={scope.version} client={client} /></AudienceClientContext.Provider></MarketingRoot> : null;
}
function WorkspaceContent({ client }: { client: MarketingClient }) {
  const workspaceElement = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<Workspace | null>(null),
    [tab, setTab] = useState<(typeof tabs)[number]>("Campaigns"),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [openDraftId, setOpenDraftId] = useState<string>();
  const [trackingOwner, setTrackingOwner] = useState<import("../core/index.js").TrackingOwner>();
  const [readError, setReadError] = useState("");
  const reads = useRef({ active: false, next: 0, settled: 0 });
  const editable = useRef(false);
  const [reportWindow, setReportWindow] = useState("completed");
  const [reportDates, setReportDates] = useState({ from: "", until: "" });
  const promotionReturn = useRef<HTMLElement | null>(null);
  const [promotion, setPromotion] = useState<Workspace["drafts"][number] | null>(null);
  const [result, setResult] = useState<Results | null>(null),
    [conversations, setConversations] = useState<Conversation[] | null>(null),
    [prompt, setPrompt] = useState(""),
    [rights, setRights] = useState(""),
    [storyboard, setStoryboard] = useState(""),
    [audienceDraft, setAudienceDraft] = useState<Material["audience"] | null>(null);
  const campaign =
    data?.campaigns.find((c) => c.id === selected) || data?.campaigns[0];
  const reportingGrant = data?.grants.find(g => g.id === campaign?.grantId && !g.revokedAt && Date.parse(g.expiresAt) > Date.now() && g.permissions.includes("report"));
  const [creativeScope, setCreativeScope] = useState<string | undefined>(undefined);
  if (creativeScope !== campaign?.id) {
    setCreativeScope(campaign?.id); setPrompt(""); setRights(""); setStoryboard("");
  }
  const [campaignScope, setCampaignScope] = useState("");
  const campaignKey = `${data?.planningScope}:${campaign?.id}:${campaign?.revision}`;
  // Reset during render so React cannot commit one frame of another campaign's edits/results.
  if (campaignScope !== campaignKey) {
    setCampaignScope(campaignKey);
    let retained = campaign?.material.audience || null;
    if (retained) {
      try {
        const saved = JSON.parse(sessionStorage.getItem(`marketing:audience:${campaignKey}`) || "null");
        if (saved?.provider === retained.provider && Array.isArray(saved.locations) && saved.locations.length <= 20 && saved.locations.every((v: unknown) => typeof v === "string" && v.length <= 160)) retained = saved;
      } catch { /* A malformed local display draft cannot change saved authority. */ }
    }
    setAudienceDraft(retained);
    setResult(null); setConversations(null); setReportDates({ from: "", until: "" });
  }
  const currentView = useRef("");
  currentView.current = `${data?.planningScope}:${campaign?.id}:${campaign?.revision}:${reportWindow}:${reportDates.from}:${reportDates.until}`;
  const assets =
    data?.assets.filter((a) => a.campaignId === campaign?.id) || [];
  const canEdit = data && ["admin", "editor"].includes(data.role),
    canDecide =
      !!data &&
      data.principalKind === "human" &&
      ["admin", "approver"].includes(data.role);
  editable.current = !!canEdit;
  useEffect(() => {
    if (!promotion && promotionReturn.current) {
      const draftId = promotionReturn.current.dataset.draftPromote;
      const target = [...(workspaceElement.current?.querySelectorAll<HTMLElement>("[data-draft-promote]") || [])].find(x => x.dataset.draftPromote === draftId);
      target?.focus();
    }
  }, [promotion]);
  async function readWorkspace(signal: AbortSignal) {
    const scope = reads.current;
    // Connections owns its catalogue while selected. Parent return/focus events
    // must not duplicate that child's authenticated reads.
    if (!scope.active || (tab === "Connections" || tab === "Tracking") && data) return;
    const request = ++scope.next;
    try {
      const next = await client.call("workspace", {}, { signal });
      if (!scope.active || signal.aborted || request < scope.settled) return;
      scope.settled = request;
      setData(next);
      setReadError("");
    } catch (e) {
      if (!scope.active || signal.aborted || request < scope.settled) return;
      scope.settled = request;
      setReadError((e as Error).message);
    }
  }
  useEffect(() => {
    const scope = { active: true, next: 0, settled: 0 };
    reads.current = scope;
    return () => {
      scope.active = false;
    };
  }, [client]);
  const pendingWork = tab === "Connections" || tab === "Tracking" ? "" : [
    ...(data?.jobs.filter(j => ["queued", "running", "processing"].includes(j.state)).map(j => j.id) ?? []),
    ...(data?.operations.filter(o => ["queued", "running"].includes(o.state)).map(o => o.id) ?? []),
  ].sort().join(":");
  const refresh = useVisibleRefresh(readWorkspace, pendingWork);
  const previousTab = useRef(tab);
  useEffect(() => {
    const previous = previousTab.current; previousTab.current = tab;
    if (previous === "Connections" && tab !== "Connections" && tab !== "Tracking" && data) void refresh();
  }, [tab]);
  const actionLock = useRef(false);
  async function act(action: () => Promise<unknown>, changesWorkspace = true) {
    if (actionLock.current) return;
    actionLock.current = true;
    const scope = reads.current;
    scope.settled = ++scope.next;
    setBusy(true);
    setError("");
    try {
      await action();
      if (scope.active && changesWorkspace) await refresh();
    } catch (e) {
      if (scope.active) setError((e as Error).message);
    } finally {
      actionLock.current = false;
      if (scope.active) setBusy(false);
    }
  }
  const materialWrite = useRef({ serialized: "", key: "" });
  async function save(next: Material) {
    if (campaign) {
      const serialized = JSON.stringify([campaign.id, campaign.revision, campaign.grantId, next]);
      if (materialWrite.current.serialized !== serialized) materialWrite.current = { serialized, key: key() };
      await planningWrite(client, "saveCampaign", {
        requestKey: materialWrite.current.key,
        id: campaign.id,
        expectedRevision: campaign.revision,
        grantId: campaign.grantId,
        material: next,
      }, materialWrite.current.key, data?.planningScope, () => reads.current.active);
    }
  }
  const [prerequisiteState, setPrerequisiteState] = useState({ scope: "", ready: false });
  const prerequisiteScope = `${campaign?.id}:${campaign?.revision}:${data?.grants.find(g => g.id === campaign?.grantId)?.revision}`;
  const selectedGrant = data?.grants.find(g => g.id === campaign?.grantId);
  const needsPrerequisite = !!selectedGrant?.id.startsWith("connection:") && data?.nativePrerequisiteProviders?.includes(selectedGrant.provider);
  const readiness = campaign && selectedGrant ? [
    ...capabilityBlockers(campaign.material, selectedGrant),
    ...(campaign.material.settings?.conversion ? ["provider_event_delivery_unqualified_use_tracking_diagnostics"] : []),
    ...((data?.mode === "live" || needsPrerequisite) ? providerBudgetBlockers(campaign.material) : []),
    ...(selectedGrant.provider !== "google" && !campaign.material.settings ? ["explicit_provider_settings_required"] : []),
    ...(selectedGrant.provider !== "google" && campaign.material.assetIds.length !== 1 ? ["single_image_required"] : []),
    ...(!data?.setups.some(s => s.grantId === campaign.grantId && s.state === "ready") ? ["verified_setup_required"] : []),
    ...(needsPrerequisite && !(prerequisiteState.scope === prerequisiteScope && prerequisiteState.ready) ? ["Check this campaign before preparing paused objects."] : []),
  ] : ["account_required"];
  const providerZoneValid = campaign?.material.audience.provider !== "linkedin" || campaign.material.timezone === "UTC";
  const completedWindow = campaign && providerZoneValid ? completedCampaignWindow(campaign.material.startAt,
    campaign.material.endAt, campaign.material.timezone) : null;
  let windowError = "";
  let chosenWindow = completedWindow;
  if (campaign && reportWindow === "custom") {
    try { chosenWindow = selectedCompletedWindow(reportDates.from, reportDates.until, campaign.material.startAt, campaign.material.endAt, campaign.material.timezone, campaign.material.audience.provider); }
    catch (e) { chosenWindow = null; windowError = (e as Error).message; }
  }
  const window = campaign && (reportWindow === "campaign" || chosenWindow)
    ? { campaignId: campaign.id, from: reportWindow === "campaign" ? campaign.material.startAt : chosenWindow!.from,
        until: reportWindow === "campaign" ? campaign.material.endAt : chosenWindow!.until } : null;
  if (!data)
    return (
      <main className="loading">
        <h1>Marketing workspace</h1>
        <p role="status">Loading your project…</p>
        <ErrorNotice error={readError} retry={() => void refresh()} />

      </main>
    );
  return (
    <div className="marketing-shell" ref={workspaceElement}>
      <aside>
        <div className="brand">
          <span>h.</span> Handrail <small>MARKETING</small>
        </div>
        <p className="project-label">{data.project.name}</p>
        <nav aria-label="Marketing">
          {tabs.map((t) => (
            <button
              className={tab === t ? "selected" : ""}
              aria-current={tab === t ? "page" : undefined}
              key={t}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          {data.role} · {data.principalKind}
          <br />
          Durable project workspace
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">Create → Launch → Results</div>
            <h1>{tab}</h1>
          </div>
          <span className={`badge ${data.mode === "fixture" ? "fixture" : ""}`}>
            {data.mode === "fixture"
              ? "QA fixture · no external spend"
              : "Project workspace"}
          </span>
        </header>
        <ErrorNotice error={readError} retry={() => void refresh()} />
        {(data.planningWrites || []).map(w => <section className="card" key={w.id} aria-label="Saved planning result">
          <h2>Review saved planning result</h2>
          <p>A previous save completed. Review its saved result before saving another plan, even if you have edited the form or switched accounts.</p>
          <p>{w.result.material.name} · revision {w.result.revision} · {w.result.grantId
            ? data.grants.find(g => g.id === w.result.grantId)?.label || "Selected account"
            : "unconnected draft"}</p>
          {w.result.grantId && <button onClick={() => { setSelected(w.result.id); setTab("Audience"); }}>Open saved campaign</button>}
          <details><summary>Saved material and provenance</summary><pre>{JSON.stringify(w.result, null, 2)}</pre></details>
          <button disabled={busy || !canEdit} onClick={() => void act(() => client.call("acknowledgePlanningWrite", { id: w.id }))}>Acknowledge saved planning result</button>
        </section>)}
        {error && <p role="alert" className="error">{error.replaceAll("_", " ")}</p>}
        {busy && (
          <p role="status" className="busy">
            Saving and checking…
          </p>
        )}
        {data.campaigns.length > 0 && tab !== "Tracking" && (
          <label className="campaign-picker">
            Campaign
            <select
              aria-label="Campaign"
              value={campaign?.id || ""}
              onChange={(e) => setSelected(e.target.value)}
            >
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.material.name} · v{c.revision}
                </option>
              ))}
            </select>
          </label>
        )}
        {campaign && ["Launch", "Results", "Audience"].includes(tab) && <section className="card" aria-label="Campaign journey"><h2>{campaign.material.name}</h2><p>Campaign revision {campaign.revision} · {campaign.state}{campaign.draftOrigin && ` · from saved draft revision ${campaign.draftOrigin.revision}`}</p><div className="actions">{campaign.draftOrigin && <button onClick={()=>{setOpenDraftId(campaign.draftOrigin!.draftId);setTab("Campaigns");}}>Open source draft and selected media</button>}<button onClick={()=>{setTrackingOwner({kind:"campaign",id:campaign.id});setTab("Tracking");}}>Open campaign Tracking</button><button onClick={()=>setTab("Launch")}>Open campaign launch review</button><button onClick={()=>setTab("Results")}>Open campaign Results</button></div></section>}
        <CampaignStudio openDraftId={openDraftId} client={client} workspace={data} visible={tab === "Campaigns"} onChanged={async draft => { if (!draft) { await refresh(); return; } setData(current => current ? {...current, drafts: [...current.drafts.filter(d => d.id !== draft.id), draft]} : current); }} onConnections={() => setTab("Connections")} onTracking={id => {setTrackingOwner({kind:"draft",id});setTab("Tracking");}} onLaunch={id => {setSelected(id);setTrackingOwner({kind:"campaign",id});setTab("Launch");}} />
        {tab === "Tracking" && <MarketingTracking client={client} workspace={data} initialOwner={trackingOwner} onBack={()=>setTab("Campaigns")} onResults={()=>setTab("Results")}/>}
        {tab === "Workspace" && (
          <>
            {promotion ? <DraftPromotion key={`${data.planningScope}:${promotion.id}:${promotion.revision}`} draft={promotion} grants={data.grants} client={client} scope={data.planningScope} disabled={!canEdit || busy} renderReview={m => <MaterialReview material={m} grant={data.grants.find(g => g.provider === m.settings?.provider && g.accountId === m.settings?.accountId)} assets={[]} client={client} />} onCancel={() => { setPromotion(null); }} onSaved={async c => { await refresh(); setSelected(c.id); setPromotion(null); }} /> : <>
            <section className="hero">
              <div className="eyebrow">Your next campaign</div>
              <h2>
                Make the work visible.
                <br />
                Keep the commitment precise.
              </h2>
              <p>
                Connect an account, create one creative set, inspect your
                audience and authorize the exact launch.
              </p>
            </section>
            <div className="stats">
              <article>
                <strong>{data.campaigns.length}</strong>
                <span>Campaigns</span>
              </article>
              <article>
                <strong>
                  {data.setups.filter((s) => s.state === "ready").length}
                </strong>
                <span>Verified connections</span>
              </article>
              <article>
                <strong>
                  {data.operations.filter((o) => o.state === "unknown").length}
                </strong>
                <span>Outcomes to reconcile</span>
              </article>
            </div>
            <div className="grid" aria-label="Unconnected drafts">
              <DraftCard key={data.planningScope} client={client} scope={data.planningScope} disabled={!canEdit || busy} onSaved={refresh} />
              {data.drafts.map(d => <DraftCard key={`${data.planningScope}:${d.id}:${d.revision}`} draft={d} client={client} scope={data.planningScope} disabled={!canEdit || busy} onSaved={refresh} onPromote={() => { promotionReturn.current = document.activeElement as HTMLElement; setPromotion(d); }} promoted={data.campaigns.find(c => c.draftOrigin?.draftId === d.id && c.draftOrigin.revision === d.revision)} onOpen={() => { const c = data.campaigns.find(c => c.draftOrigin?.draftId === d.id && c.draftOrigin.revision === d.revision); if (c) { setSelected(c.id); setTab("Audience"); } }} />)}
            </div>

            <p>Create → Launch → Results · one creative set per campaign</p>
            <div className="grid">
              <section className="card">
                <h2>Create a campaign</h2><button onClick={() => setTab("Campaigns")}>Open Campaign Studio</button>
                <CampaignForm key={data.planningScope}
                  grants={data.grants}
                  disabled={!canEdit || busy}
                  onCreate={(m, isCurrent) =>
                    act(async () => {
                      const captured = await client.call("captureDestination", {
                        url: m.material.destination,
                      });
                      if (!reads.current.active || !editable.current || !isCurrent()) return;
                      const c = await planningWrite(client, "saveCampaign", {
                        ...m,
                        material: {
                          ...m.material,
                          destinationDigest: captured.digest,
                        },
                      }, m.requestKey, data.planningScope, () => reads.current.active && editable.current && isCurrent());
                      if (!reads.current.active || !editable.current || !isCurrent()) return;
                      setSelected(c.id);
                      setTab("Connections");
                    })
                  }
                />
              </section>
              <section className="card">
                <h2>Recent activity</h2>
                {data.operations.length === 0 ? (
                  <p className="muted">
                    No provider operations yet. Your campaign starts as a saved
                    draft.
                  </p>
                ) : (
                  data.operations
                    .slice()
                    .reverse()
                    .map((o) => (
                      <article className="activity" key={o.id}>
                        <strong>{o.kind}</strong>
                        <span className="badge">{o.state}</span>
                        <p>
                          {o.reason?.replaceAll("_", " ") ||
                            `${o.receipt?.intent || "Pending"} · delivery ${o.receipt?.delivery || "unverified"}`}
                        </p>
                        {o.state === "unknown" && (
                          <button
                            disabled={busy || !canEdit}
                            onClick={() =>
                              void act(() =>
                                client.call("reconcile", { operationId: o.id }),
                              )
                            }
                          >
                            Reconcile outcome
                          </button>
                        )}
                      </article>
                    ))
                )}
              </section>
            </div>
            </>}
          </>
        )}
        {tab === "Connections" && <MarketingConnections client={client} embedded onContinue={() => { void refresh(); setTab("Workspace"); }} />}
        {tab === "Creative" &&
          (!campaign ? (
            <Empty />
          ) : (
            <>
              <div className="grid">
                <section className="card">
                  <h2>Image & video studio</h2>
                  <p>
                    One creative set · retained byte identities.{" "}
                    {data.mode === "fixture"
                      ? "Outputs here are deterministic test patterns, not AI-generated media."
                      : "Generation uses separately granted billing authority."}
                  </p>
                  <label>
                    Creative brief
                    <textarea
                      value={prompt}
                      placeholder="Describe the image or video you want to create"
                      onChange={(e) => setPrompt(e.target.value)}
                    />
                  </label>
                  <label>
                    Rights / approved source receipt
                    <input
                      value={rights}
                      onChange={(e) => setRights(e.target.value)}
                      placeholder="Reference the permission for this material"
                    />
                  </label>
                  <div className="actions">
                    {data.generationGrants.map((g) => (
                      <button
                        key={g.id}
                        disabled={
                          busy || !canEdit || !rights || !prompt.trim() || g.usedJobs >= g.maxJobs
                        }
                        onClick={() =>
                          void act(() =>
                            client.call("generate", {
                              campaignId: campaign.id,
                              grantId: g.id,
                              prompt,
                              rightsReceipt: rights,
                              parentAssetIds: [],
                              requestKey: key(),
                            }),
                          )
                        }
                      >
                        Create {g.kind}
                      </button>
                    ))}
                  </div>
                  {data.generationGrants.length === 0 && (
                    <p className="muted">
                      No generation grant is bound to this project.
                    </p>
                  )}
                </section>
                <section className="card">
                  <h2>Storyboard</h2>
                  <p>
                    Plan shots here. A storyboard is never treated as a rendered
                    video.
                  </p>
                  <label>
                    Shot sequence
                    <textarea
                      value={storyboard}
                      onChange={(e) => setStoryboard(e.target.value)}
                      placeholder="1. Establish the setting…"
                    />
                  </label>
                  <button
                    className="secondary"
                    disabled={!storyboard || busy || !canEdit}
                    onClick={() =>
                      void act(() =>
                        client.call("storyboard", {
                          campaignId: campaign.id,
                          text: storyboard,
                        }),
                      )
                    }
                  >
                    Save storyboard
                  </button>
                </section>
              </div>
              <div className="grid assets">
                {assets.map((a) => (
                  <section className="card" key={a.id}>
                    <div className="eyebrow">
                      {a.source} · {a.kind}
                    </div>
                    {a.kind === "video" ? (
                      <video
                        controls
                        preload="metadata"
                        src={client.assetUrl(a.id)}
                      />
                    ) : a.kind === "image" ? (
                      <img
                        src={client.assetUrl(a.id)}
                        alt="Retained campaign creative"
                      />
                    ) : (
                      <a href={client.assetUrl(a.id)}>Read storyboard</a>
                    )}
                    <p>
                      {a.width && `${a.width} × ${a.height}`}{" "}
                      {a.seconds && `${a.seconds}s`} · v{a.version}
                    </p>
                    {a.kind === "image" && (
                      <button
                        className="secondary"
                        disabled={
                          busy ||
                          !canEdit ||
                          campaign.material.assetIds.includes(a.id)
                        }
                        onClick={() =>
                          void act(() =>
                            save({ ...campaign.material, assetIds: [a.id] }),
                          )
                        }
                      >
                        {campaign.material.assetIds.includes(a.id)
                          ? "Selected for campaign"
                          : "Use this image"}
                      </button>
                    )}
                    {a.kind === "video" && (
                      <p className="muted">
                        Playable retained output. Video ad placement is not
                        supported by the initial single-image/Search mappings.
                      </p>
                    )}
                  </section>
                ))}
              </div>
              <section className="card">
                <h2>Generation journal</h2>
                {data.jobs
                  .filter((j) => j.campaignId === campaign.id)
                  .map((j) => (
                    <div className="activity" key={j.id}>
                      <strong>{j.kind}</strong>
                      <span className="badge">{j.state}</span>
                      <p>
                        {j.reason?.replaceAll("_", " ") ||
                          j.providerRequestId ||
                          "Request reserved"}
                      </p>
                      {["processing", "unknown"].includes(j.state) && (
                        <button
                          onClick={() =>
                            void act(() =>
                              client.call("reconcileGeneration", {
                                jobId: j.id,
                              }),
                            )
                          }
                        >
                          Check existing request
                        </button>
                      )}
                    </div>
                  ))}
              </section>
            </>
          ))}
        {tab === "Audience" &&
          (!campaign ? (
            <Empty />
          ) : (
            <div className="grid">
              <section className="card">
                <h2>Who can see this campaign?</h2>
                <p>
                  Provider-native location identifiers and explicit supported
                  rules. No automatic expansion.
                </p>
                {audienceDraft && <AudienceFields material={campaign.material} grant={selectedGrant} value={audienceDraft} onChange={value => { setAudienceDraft(value); try { sessionStorage.setItem(`marketing:audience:${campaignKey}`, JSON.stringify(value)); } catch { /* Saved server material stays available. */ } }} />}
                <button
                  disabled={busy || !canEdit}
                  onClick={() =>
                    void act(() =>
                      save({
                        ...campaign.material,
                        audience: audienceDraft!,
                      }),
                    )
                  }
                >
                  Save audience revision
                </button>
              </section>
              <section className="card">
                <h2>Audience reach</h2>
                <strong className="unavailable">Unavailable</strong>
                <p>
                  No provider estimate retained. This is not zero people or a
                  delivery forecast.
                </p>
                <p className="muted">
                  Meta: country, adult age range, Facebook Feed.
                  <br />
                  Google: location resource IDs and exact Search keywords.
                  <br />
                  LinkedIn: geo URNs and optional title URNs.
                </p>
                <GuidedMaterialEditor
                  key={`${data.planningScope}:${campaign.id}:${campaign.revision}:${selectedGrant?.revision}`}
                  value={campaign.material}
                  renderReview={m => <MaterialReview material={m} grant={data.grants.find(g => g.provider === m.settings?.provider && g.accountId === m.settings?.accountId)} assets={(assets || []).filter(a => m.assetIds.includes(a.id))} client={client} />}
                  grant={data.grants.find(g => g.id === campaign.grantId)!}
                  disabled={busy || !canEdit}
                  onSave={(m) =>
                    act(async () => {
                      const snapshot = await client.call("captureDestination", {
                        url: m.destination,
                      });
                      await save({ ...m, destinationDigest: snapshot.digest });
                    })
                  }
                />
              </section>
            </div>
          ))}
        {tab === "Launch" &&
          (!campaign ? (
            <Empty />
          ) : (
            <>
              <TrackingReadiness key={`${data.planningScope}:${campaign.id}:${campaign.revision}`} client={client} owner={{kind:"campaign",id:campaign.id}} onOpen={()=>{setTrackingOwner({kind:"campaign",id:campaign.id});setTab("Tracking");}}/>
              <section className="card">
                <div className="eyebrow">
                  Campaign v{campaign.revision} · {campaign.state}
                </div>
                <h2>{campaign.material.name}</h2>
                <MaterialReview
                  material={campaign.material}
                  grant={selectedGrant}
                  assets={assets.filter((a) =>
                    campaign.material.assetIds.includes(a.id),
                  )}
                  client={client}
                />
                {needsPrerequisite && <CampaignPrerequisites key={prerequisiteScope} client={client} campaign={campaign} grantRevision={selectedGrant!.revision} canEdit={!!canEdit}
                  onState={ready => setPrerequisiteState({ scope: prerequisiteScope, ready })}/>}
                {readiness.length > 0 && <div role="status"><strong>Launch readiness blockers</strong><ul>{readiness.map(x => <li key={x}>{x.replaceAll("_", " ")}</li>)}</ul></div>}
                <div className="actions">
                  <button
                    disabled={busy || !canEdit || campaign.state !== "draft" || readiness.length > 0}
                    onClick={() =>
                      void act(() =>
                        client.call("prepare", {
                          campaignId: campaign.id,
                          requestKey: key(),
                        }),
                      )
                    }
                  >
                    Prepare paused objects
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || campaign.state !== "paused"}
                    onClick={() =>
                      void act(() =>
                        client.call("packet", { campaignId: campaign.id }),
                      )
                    }
                  >
                    Create launch review
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit || campaign.state !== "enabled"}
                    onClick={() =>
                      void act(() =>
                        client.call("pause", {
                          campaignId: campaign.id,
                          requestKey: key(),
                        }),
                      )
                    }
                  >
                    Pause delivery
                  </button>
                </div>
                <p className="muted">
                  Activation intent: {campaign.receipt?.intent || "none"}.
                  Actual delivery: {campaign.receipt?.delivery || "unverified"}.
                </p>
              </section>
              <section className="card" aria-label="Campaign operation progress"><h2>Campaign operation progress</h2>{!data.operations.some(o=>o.campaignId===campaign.id) && <p>No provider operations yet. Prepare the exact campaign when its requirements are complete.</p>}{data.operations.filter(o=>o.campaignId===campaign.id).map(o=><article key={o.id}><h3>{o.kind === 'prepare' ? 'Prepare paused objects' : o.kind === 'activate' ? 'Launch' : 'Pause'} · {o.state}</h3><p>{o.reason?.replaceAll('_',' ') || `${o.receipt?.intent || 'Pending'} · delivery ${o.receipt?.delivery || 'unverified'}`}</p>{o.state==='unknown' && <><p>The original operation may have taken effect. Its identifiers and reservations remain retained. Check that outcome before another action.</p><button disabled={busy||!canEdit} onClick={()=>void act(()=>client.call('reconcile',{operationId:o.id}))}>Reconcile original campaign outcome</button></>}</article>)}</section>
              {data.packets
                .filter((p) => p.campaignId === campaign.id)
                .slice(-1)
                .map((p) => {
                  const decision = data.decisions.find(
                    (d) => d.packetId === p.id,
                  );
                  return (
                    <React.Fragment key={p.id}>
                      {!decision ? (
                        <ApprovalPanel
                          client={client}
                          grant={selectedGrant}
                          packet={p}
                          assets={assets.filter((a) =>
                            p.material.assetIds.includes(a.id),
                          )}
                          canDecide={canDecide}
                          onChanged={() => void refresh()}
                        />
                      ) : (
                        <section className="card">
                          <h2>
                            Human decision:{" "}
                            {decision.revokedAt ? "revoked" : decision.decision}
                          </h2>
                          <p>
                            This human decision covers the exact reviewed campaign. Changed material
                            or expired authority will reject execution.
                          </p>
                          <div className="actions">
                            <button
                              disabled={
                                busy ||
                                decision.decision !== "approved" ||
                                !!decision.revokedAt ||
                                campaign.state !== "paused" || data.operations.some(o => o.campaignId === campaign.id && ["queued", "running", "unknown"].includes(o.state))
                              }
                              onClick={() =>
                                void act(() =>
                                  client.call("execute", {
                                    packetId: p.id,
                                    digest: p.digest,
                                    requestKey: key(),
                                  }),
                                )
                              }
                            >
                              {data.mode === "fixture"
                                ? "Execute fixture launch"
                                : "Execute authorized launch"}
                            </button>
                            <button
                              className="secondary"
                              disabled={!canDecide || !!decision.revokedAt}
                              onClick={() =>
                                void act(() =>
                                  client.call("revoke", {
                                    decisionId: decision.id,
                                  }),
                                )
                              }
                            >
                              Revoke decision
                            </button>
                          </div>
                        </section>
                      )}
                    </React.Fragment>
                  );
                })}
            </>
          ))}
        {tab === "Conversations" &&
          (!campaign ? (
            <Empty />
          ) : (
            <section className="card">
              <h2>Campaign conversations</h2>
              <p>
                Consented first-party records linked to a completed form.
                Ad-network permissions do not grant transcript access.
              </p>
              {!["admin", "sales"].includes(data.role) ? (
                <p className="error">Your role can view aggregates only.</p>
              ) : (
                <>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        {
                          const scope = currentView.current;
                          const value = await client.call("conversations", { campaignId: campaign.id });
                          if (reads.current.active && scope === currentView.current) setConversations(value);
                        },
                      )
                    }
                  >
                    Load conversations
                  </button>
                  {conversations?.length === 0 && (
                    <p className="muted">
                      No permissioned conversations are linked to this campaign
                      yet.
                    </p>
                  )}
                  {conversations?.map((c) => (
                    <article className="conversation" key={c.id}>
                      <h3>{c.id}</h3>
                      <p className="muted">
                        Completed form {c.leadEventId} · consent{" "}
                        {c.consentReceipt}
                      </p>
                      {c.messages.map((m, i) => (
                        <blockquote key={i}>
                          <strong>{m.speaker}</strong>
                          <p>{m.text}</p>
                          <small>{m.at}</small>
                        </blockquote>
                      ))}
                    </article>
                  ))}
                </>
              )}
            </section>
          ))}
        {tab === "Results" &&
          (!campaign ? (
            <section className="card"><h2>Campaign results are not available yet</h2><p>Results need a saved campaign and its reporting window. A draft's no-send Tracking tests remain QA evidence and do not create production outcomes.</p><button onClick={() => setTab("Campaigns")}>Back to Campaign Studio</button><button className="secondary" onClick={() => setTab("Tracking")}>Review Tracking diagnostics</button></section>
          ) : (
            <>
              <section className="card">
                <h2>Measured outcomes · {campaign.material.purpose || "acquisition"}</h2>
                <p>
                  {campaign.material.timezone} ·{" "}
                  {campaign.material.budget.currency}. Submissions, people and paid customers remain distinct.
                </p>
                <label>Reporting window
                  <select aria-label="Reporting window" value={reportWindow} onChange={e => { setReportWindow(e.target.value); setResult(null); }}>
                    <option value="completed">All completed days</option>
                    <option value="custom">Choose completed days</option>
                    <option value="campaign">Full campaign (first-party)</option>
                  </select>
                </label>
                {reportWindow === "custom" && <fieldset><legend>Completed provider dates · {campaign.material.timezone}</legend>
                  <p>Reporting only. Start is included; end is excluded.</p>
                  {(["from", "until"] as const).map(field => <label key={field}>{field === "from" ? "Report start date" : "Report end date (exclusive)"}<input type="date" value={reportDates[field]} min={completedWindow ? dateAtInstant(completedWindow.from, campaign.material.timezone) : undefined} max={completedWindow ? dateAtInstant(completedWindow.until, campaign.material.timezone) : undefined} onChange={e => { setReportDates({ ...reportDates, [field]: e.target.value }); setResult(null); }} /></label>)}
                  <button type="button" disabled={!completedWindow} onClick={() => { setReportDates({ from: dateAtInstant(completedWindow!.from, campaign.material.timezone), until: dateAtInstant(completedWindow!.until, campaign.material.timezone) }); setResult(null); }}>Use all completed days</button>
                  {windowError && <p role="status">{windowError}</p>}
                </fieldset>}
                {!providerZoneValid && <p role="status">LinkedIn provider reports require UTC. This historical non-UTC campaign can use first-party results only; its dates are not relabeled.</p>}
                <p>
                  {window ? `${new Date(window.from).toLocaleString(undefined, { timeZone: campaign.material.timezone })} → ${new Date(window.until).toLocaleString(undefined, { timeZone: campaign.material.timezone })} (end excluded)` : "No completed provider days in this campaign yet."}
                </p>
                <p className="muted">
                  {reportWindow === "campaign"
                    ? "Full campaign results may include partial and future days. Provider sync requires completed provider days."
                    : "Only whole, completed days in the account timezone. Partial and current days are excluded."}
                </p>
                <div className="actions">
                  <button
                    disabled={busy || !window}
                    onClick={() =>
                      void act(async () =>
                        {
                          const scope = currentView.current;
                          const value = await client.call("results", window!);
                          if (reads.current.active && scope === currentView.current) setResult(value);
                        }, false,
                      )
                    }
                  >
                    Read results
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit || !reportingGrant || !window || reportWindow === "campaign"}
                    onClick={() =>
                      void act(async () => {
                        const scope = currentView.current;
                        await client.call("syncMetrics", window!);
                        if (!reads.current.active || scope !== currentView.current) return;
                        const value = await client.call("results", window!);
                        if (reads.current.active && scope === currentView.current) setResult(value);
                      }, false)
                    }
                  >
                    Sync provider metrics
                  </button>
                </div>
                {!canEdit ? <p>A project administrator or editor can refresh provider data. You can still read retained results.</p>
                  : !reportingGrant ? <p>Connect an account with current reporting access to refresh provider data. Retained results remain available. <button className="secondary" onClick={() => setTab("Connections")}>Review reporting connection</button></p>
                  : (!window || reportWindow === "campaign") && <p>Select a completed provider-day window above to refresh provider data.</p>}
              </section>
              {result && (
                <>
                  <p className="muted">
                    {result.source} ·{" "}
                    {result.stale ? "stale / not observed" : "fresh"} ·{" "}
                    {result.observedAt ? new Date(result.observedAt).toLocaleString(undefined, { timeZone: result.timezone }) : "no snapshot"} · Last eligible paid click within seven days
                    {result.reportingBasis && ` · ${result.reportingBasis.window.replaceAll("-", " ")}`}
                  </p>
                  <p>{result.purpose === "recruitment" ? "Completed MOU requests count submitted ApplicantRequestMOU events. Completed applications, qualified applicants and hires are separate outcomes." : "Completed submissions count submitted events; unique people deduplicates completed forms by person."} QA, synthetic and production-excluded events do not count toward outcomes. Excluded test-event coverage requires both purpose collectors; missing coverage stays unknown. Provider conversions are provider aggregates, not proof of a first-party outcome.</p>
                  {result.coverage && <p>First-party coverage: {result.coverage.state}. {result.coverage.reason}</p>}
                  <p>Purchase revenue is gross before refunds. Refund-adjusted revenue is unavailable.</p>
                  <div className="metrics">
                    {(
                      [
                        "purchases",
                        "spendMinor",
                        "impressions",
                        "clicks",
                        "leads",
                        "completedSubmissions",
                        "applicantRequests",
                        "applicants",
                        "qualifiedApplicants",
                        "hires",
                        "excludedTestEvents",
                        "qualified",
                        "customers",
                        "revenueMinor",
                        "ctr",
                        "mediaCacMinor",
                        "mediaRoas",
                        "providerConversions",
                      ] as const
                    ).filter(k => result.purpose === "recruitment"
                      ? !["leads", "completedSubmissions", "qualified", "customers", "revenueMinor", "mediaCacMinor", "mediaRoas"].includes(k)
                      : !["applicantRequests", "applicants", "qualifiedApplicants", "hires"].includes(k)).map((k) => (
                      <article className="card" key={k}>
                        <h3>
                          {{
                            purchases: "Completed purchases",
                            leads: "Unique people (completed forms)",
                            completedSubmissions: "Completed submissions",
                            applicantRequests: "Completed MOU requests",
                            applicants: "Completed applications",
                            qualifiedApplicants: "Qualified applicants",
                            hires: "Hires",
                            excludedTestEvents: "Excluded test events",
                            spendMinor: "Media spend",
                            mediaCacMinor: "Media CAC",
                            ctr: "CTR",
                            mediaRoas: "Media ROAS",
                            revenueMinor: "Gross revenue",
                            providerConversions: "Provider conversions",
                          }[k as string] || k}
                        </h3>
                        <strong>
                          {result[k]?.value == null
                            ? "—"
                            : k === "ctr"
                              ? `${(result[k].value! * 100).toFixed(2)}%`
                              : ["spendMinor", "mediaCacMinor", "revenueMinor"].includes(k)
                                ? formatResultMoney(result[k]!.value!, result.currency)
                                : Number(result[k]?.value).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 },
                                )}
                        </strong>
                        <p>
                          {result[k]?.reason?.replaceAll("_", " ") ||
                            (result[k] ? "Observed within this window" : "Not available from this server")}
                        </p>
                      </article>
                    ))}
                  </div>
                </>
              )}
            </>
          ))}
      </main>
    </div>
  );
}
function Empty() {
  return (
    <section className="card">
      <h2>Create a campaign first</h2>
      <p>
        Start in Workspace. The same saved campaign follows you through every
        step.
      </p>
    </section>
  );
}
function CampaignForm({ grants, disabled, onCreate }: { grants: Workspace["grants"]; disabled: boolean; onCreate: (m: { grantId: string; material: Material; requestKey: string }, isCurrent: () => boolean) => Promise<void> }) {
  const [grantId, setGrantId] = useState(grants[0]?.id || "");
  const g = grants.find(x => x.id === grantId);
  return <><label>Account<select aria-label="Account" value={grantId} disabled={disabled} onChange={e => setGrantId(e.target.value)}>
    {grants.map(x => <option key={x.id} value={x.id}>{x.provider} · {x.label}</option>)}</select></label>
    {g && <p className="selected-account">Selected account: {g.label}</p>}
    {g ? <ConnectedForm key={`${g.id}:${g.revision}`} grant={g} disabled={disabled} onCreate={onCreate} /> : <p>Save an unconnected draft below. A verified account is required to prepare provider objects.</p>}</>;
}
function ConnectedForm({ grant: g, disabled, onCreate }: { grant: Workspace["grants"][number]; disabled: boolean; onCreate: (m: { grantId: string; material: Material; requestKey: string }, isCurrent: () => boolean) => Promise<void> }) {
  const [m, setMaterial] = useState(() => initialMaterial(g)), [busy, setBusy] = useState(false);
  const saving = useRef(false), active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const request = useRef({ material: "", key: crypto.randomUUID() });
  return <form onSubmit={async e => { e.preventDefault(); if (saving.current) return; saving.current = true; setBusy(true);
    try {
      const serialized = JSON.stringify(m);
      if (request.current.material !== serialized) request.current = { material: serialized, key: crypto.randomUUID() };
      await onCreate({ grantId: g.id, material: m, requestKey: request.current.key }, () => active.current);
    } finally { saving.current = false; setBusy(false); }
  }}><GuidedFields value={m} grant={g} onChange={setMaterial} />
    <p className="muted">Initial draft starts at the beginning of tomorrow in {g.timezone} for seven calendar days. Review or edit the exact schedule above.</p>
    <button disabled={disabled || busy || capabilityBlockers(m, g).length > 0}>Save campaign draft</button>
  </form>;
}
