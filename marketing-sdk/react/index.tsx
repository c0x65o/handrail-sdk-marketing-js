import React, { useEffect, useState } from "react";
import type {
  Asset,
  Conversation,
  MarketingClient,
  Material,
  Packet,
  Results,
  Workspace,
} from "../core/index.js";

export function MaterialReview({
  material,
  assets,
  client,
}: {
  material: Material;
  assets: Asset[];
  client: MarketingClient;
}) {
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
              <br />
              <code>{a.digest}</code>
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
        <dt>Lifetime media ceiling</dt>
        <dd>
          {material.budget.currency} {(material.budget.minor / 100).toFixed(2)}{" "}
          · excludes fees/taxes
        </dd>
        <dt>Delivery window</dt>
        <dd>
          {material.startAt} → {material.endAt} (exclusive)
          <br />
          {material.timezone}
        </dd>
      </dl>
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
  assets,
  canDecide,
  onChanged,
}: {
  client: MarketingClient;
  packet: Packet;
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
        Account {packet.accountId} · campaign revision {packet.campaignRevision}
        . Authorization expires {new Date(packet.expiresAt).toLocaleString()}.
      </p>
      <MaterialReview
        material={packet.material}
        assets={assets}
        client={client}
      />
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
  "Creative",
  "Audience",
  "Launch",
  "Conversations",
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
const key = () => crypto.randomUUID();
export function MarketingWorkspace({ client }: { client: MarketingClient }) {
  const [data, setData] = useState<Workspace | null>(null),
    [tab, setTab] = useState<(typeof tabs)[number]>("Workspace"),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Results | null>(null),
    [conversations, setConversations] = useState<Conversation[] | null>(null),
    [prompt, setPrompt] = useState(
      "A calm desktop with a small plant and morning light.",
    ),
    [rights, setRights] = useState(""),
    [storyboard, setStoryboard] = useState(""),
    [audienceText, setAudienceText] = useState("");
  const campaign =
    data?.campaigns.find((c) => c.id === selected) || data?.campaigns[0];
  const assets =
    data?.assets.filter((a) => a.campaignId === campaign?.id) || [];
  const canEdit = data && ["admin", "editor"].includes(data.role),
    canDecide =
      !!data &&
      data.principalKind === "human" &&
      ["admin", "approver"].includes(data.role);
  async function refresh() {
    try {
      setData(await client.call("workspace", {}));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 1500);
    return () => clearInterval(t);
  }, [client]);
  useEffect(() => {
    setAudienceText(
      campaign ? JSON.stringify(campaign.material.audience, null, 2) : "",
    );
    setResult(null);
    setConversations(null);
  }, [campaign?.id, campaign?.revision]);
  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(next: Material) {
    if (campaign)
      await client.call("saveCampaign", {
        id: campaign.id,
        expectedRevision: campaign.revision,
        grantId: campaign.grantId,
        material: next,
      });
  }
  const window = campaign
    ? {
        campaignId: campaign.id,
        from: campaign.material.startAt,
        until: campaign.material.endAt,
      }
    : null;
  if (!data)
    return (
      <main className="loading">
        <h1>Marketing workspace</h1>
        <p role="status">Loading your project…</p>
        <ErrorNotice error={error} retry={() => void refresh()} />
      </main>
    );
  return (
    <div className="marketing-shell">
      <aside>
        <div className="brand">
          <span>h.</span> Handrail <small>MARKETING</small>
        </div>
        <p className="project-label">{data.project.name}</p>
        <nav aria-label="Marketing">
          {tabs.map((t) => (
            <button
              className={tab === t ? "selected" : ""}
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
              : "Connected provider mode"}
          </span>
        </header>
        <ErrorNotice
          error={error}
          retry={() => {
            setError("");
            void refresh();
          }}
        />
        {busy && (
          <p role="status" className="busy">
            Saving and checking…
          </p>
        )}
        {data.campaigns.length > 0 && (
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
        {tab === "Workspace" && (
          <>
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
            <div className="grid">
              <section className="card">
                <h2>Create a campaign</h2>
                <CampaignForm
                  grants={data.grants}
                  disabled={!canEdit || busy}
                  onCreate={(m) =>
                    act(async () => {
                      const captured = await client.call("captureDestination", {
                        url: m.material.destination,
                      });
                      const c = await client.call("saveCampaign", {
                        ...m,
                        material: {
                          ...m.material,
                          destinationDigest: captured.digest,
                        },
                      });
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
          </>
        )}
        {tab === "Connections" && (
          <>
            <p className="intro">
              Select a project-granted account. Resume verifies identity and
              permissions again; a browser sign-in alone never proves API
              access.
            </p>
            <div className="grid">
              {data.grants.map((g) => {
                const setup = data.setups
                  .filter((s) => s.grantId === g.id)
                  .at(-1);
                return (
                  <section className="card" key={g.id}>
                    <div className="eyebrow">{g.provider}</div>
                    <h2>{g.label}</h2>
                    <p>
                      {g.accountId} · {g.currency}
                      <br />
                      {g.timezone}
                    </p>
                    <span className="badge">
                      {setup?.state.replaceAll("_", " ") || "Not verified"}
                    </span>
                    {setup?.reason && (
                      <p>{setup.reason.replaceAll("_", " ")}</p>
                    )}
                    <p className="muted">
                      {setup?.verifiedAt
                        ? `Verified ${new Date(setup.verifiedAt).toLocaleString()}`
                        : "Readiness has not been observed."}
                    </p>
                    <div className="actions">
                      {!setup ? (
                        <button
                          disabled={busy || !canEdit}
                          onClick={() =>
                            void act(() =>
                              client.call("setup", {
                                grantId: g.id,
                                requestKey: key(),
                              }),
                            )
                          }
                        >
                          Connect {g.provider}
                        </button>
                      ) : (
                        <button
                          disabled={busy || !canEdit}
                          onClick={() =>
                            void act(() =>
                              client.call("resumeSetup", {
                                setupId: setup.id,
                                expectedRevision: setup.revision,
                              }),
                            )
                          }
                        >
                          Resume and verify
                        </button>
                      )}
                      {setup?.handoffUrl &&
                        (data.mode === "fixture" ? (
                          <button
                            className="secondary"
                            disabled={
                              !canEdit || data.principalKind !== "human"
                            }
                            onClick={() =>
                              void act(async () => {
                                const r = await fetch(setup.handoffUrl!, {
                                  method: "POST",
                                  headers: {
                                    "content-type": "application/json",
                                  },
                                  body: "{}",
                                });
                                if (!r.ok) throw new Error("takeover_denied");
                              })
                            }
                          >
                            Confirm fixture takeover
                          </button>
                        ) : (
                          <a
                            className="button secondary"
                            href={setup.handoffUrl}
                          >
                            Continue securely with {g.provider}
                          </a>
                        ))}
                    </div>
                    <details>
                      <summary>Declared capabilities</summary>
                      <p>
                        {setup?.capabilities.join(", ") ||
                          "Awaiting verification"}
                      </p>
                      <p>
                        Account creation, payment changes and provider access
                        review require their own authority.
                      </p>
                    </details>
                  </section>
                );
              })}
            </div>
          </>
        )}
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
                          busy || !canEdit || !rights || g.usedJobs >= g.maxJobs
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
                    <code>{a.digest}</code>
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
                <label>
                  Audience definition
                  <textarea
                    className="code-input"
                    rows={14}
                    value={audienceText}
                    onChange={(e) => setAudienceText(e.target.value)}
                  />
                </label>
                <button
                  disabled={busy || !canEdit}
                  onClick={() =>
                    void act(() =>
                      save({
                        ...campaign.material,
                        audience: JSON.parse(audienceText),
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
                <MaterialEditor
                  key={`${campaign.id}:${campaign.revision}`}
                  value={campaign.material}
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
              <section className="card">
                <div className="eyebrow">
                  Campaign v{campaign.revision} · {campaign.state}
                </div>
                <h2>{campaign.material.name}</h2>
                <MaterialReview
                  material={campaign.material}
                  assets={assets.filter((a) =>
                    campaign.material.assetIds.includes(a.id),
                  )}
                  client={client}
                />
                <div className="actions">
                  <button
                    disabled={busy || !canEdit || campaign.state !== "draft"}
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
                          <code>{decision.digest}</code>
                          <p>
                            Decision actor {decision.actorId}. Changed material
                            or expired authority will reject execution.
                          </p>
                          <div className="actions">
                            <button
                              disabled={
                                busy ||
                                decision.decision !== "approved" ||
                                !!decision.revokedAt ||
                                campaign.state === "enabled"
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
                        setConversations(
                          await client.call("conversations", {
                            campaignId: campaign.id,
                          }),
                        ),
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
            <Empty />
          ) : (
            <>
              <section className="card">
                <h2>Measured outcomes</h2>
                <p>
                  {campaign.material.timezone} ·{" "}
                  {campaign.material.budget.currency} · campaign delivery
                  window. First-party leads, qualifications and paid customers
                  remain distinct.
                </p>
                <div className="actions">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(async () =>
                        setResult(await client.call("results", window!)),
                      )
                    }
                  >
                    Read results
                  </button>
                  <button
                    className="secondary"
                    disabled={busy || !canEdit}
                    onClick={() =>
                      void act(async () => {
                        await client.call("syncMetrics", window!);
                        setResult(await client.call("results", window!));
                      })
                    }
                  >
                    Sync provider metrics
                  </button>
                </div>
              </section>
              {result && (
                <>
                  <p className="muted">
                    {result.source} ·{" "}
                    {result.stale ? "stale / not observed" : "fresh"} ·{" "}
                    {result.observedAt || "no snapshot"} · {result.attribution}
                  </p>
                  <div className="metrics">
                    {(
                      [
                        "spendMinor",
                        "impressions",
                        "clicks",
                        "leads",
                        "qualified",
                        "customers",
                        "revenueMinor",
                        "ctr",
                        "mediaCacMinor",
                        "mediaRoas",
                        "providerConversions",
                      ] as const
                    ).map((k) => (
                      <article className="card" key={k}>
                        <h3>
                          {{
                            spendMinor: "Media spend (minor)",
                            mediaCacMinor: "Media CAC (minor)",
                            ctr: "CTR",
                            mediaRoas: "Media ROAS",
                            revenueMinor: "Revenue (minor)",
                            providerConversions: "Provider conversions",
                          }[k as string] || k}
                        </h3>
                        <strong>
                          {result[k].value === null
                            ? "—"
                            : k === "ctr"
                              ? `${(result[k].value! * 100).toFixed(2)}%`
                              : Number(result[k].value).toLocaleString(
                                  undefined,
                                  { maximumFractionDigits: 2 },
                                )}
                        </strong>
                        <p>
                          {result[k].reason?.replaceAll("_", " ") ||
                            "Observed within this window"}
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
function MaterialEditor({
  value,
  disabled,
  onSave,
}: {
  value: Material;
  disabled: boolean;
  onSave: (m: Material) => Promise<void>;
}) {
  const [draft, setDraft] = useState(JSON.stringify(value, null, 2)),
    [error, setError] = useState("");
  return (
    <details>
      <summary>Edit complete campaign material</summary>
      <p className="muted">
        Changing copy, schedule, budget, targeting or destination creates a new
        version and invalidates earlier launch authority.
      </p>
      <label>
        Complete material
        <textarea
          rows={18}
          className="code-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button
        disabled={disabled}
        onClick={() => {
          try {
            const material = JSON.parse(draft) as Material;
            setError("");
            void onSave(material);
          } catch {
            setError("Enter valid JSON before saving.");
          }
        }}
      >
        Save material revision
      </button>
    </details>
  );
}
function CampaignForm({
  grants,
  disabled,
  onCreate,
}: {
  grants: Workspace["grants"];
  disabled: boolean;
  onCreate: (m: { grantId: string; material: Material }) => Promise<void>;
}) {
  const [grantId, setGrantId] = useState(grants[0]?.id || ""),
    [name, setName] = useState("Autumn desk kit"),
    [headline, setHeadline] = useState("A little room to think"),
    [body, setBody] = useState("Explore a calmer workspace."),
    [destination, setDestination] = useState(
      "https://fieldwork.example/desk-kit",
    ),
    [budget, setBudget] = useState("42");
  const g = grants.find((x) => x.id === grantId);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!g) return;
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 1);
    start.setUTCHours(5, 0, 0, 0);
    const end = new Date(start.getTime() + 7 * 86400000);
    const bytes = new TextEncoder().encode(destination);
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    await onCreate({
      grantId,
      material: {
        name,
        headline,
        body,
        destination,
        destinationDigest: hash,
        assetIds: [],
        budget: {
          currency: g.currency,
          minor: Math.round(Number(budget) * 100),
        },
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        timezone: g.timezone,
        audience:
          g.provider === "meta"
            ? {
                provider: "meta",
                locations: ["US"],
                ageMin: 25,
                ageMax: 54,
                expansion: false,
              }
            : g.provider === "google"
              ? {
                  provider: "google",
                  locations: ["geoTargetConstants/2840"],
                  keywords: ["desk kit"],
                  expansion: false,
                }
              : {
                  provider: "linkedin",
                  locations: ["urn:li:geo:103644278"],
                  expansion: false,
                },
        ...(g.provider === "google"
          ? {
              searchHeadlines: [
                headline,
                "Explore the desk kit",
                "Make space for your work",
              ],
              searchDescriptions: [
                body,
                "Learn about the kit and see what fits your workspace.",
              ],
            }
          : {}),
      },
    });
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <label>
        Account
        <select value={grantId} onChange={(e) => setGrantId(e.target.value)}>
          {grants.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Campaign name
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label>
        Headline
        <input
          required
          value={headline}
          onChange={(e) => setHeadline(e.target.value)}
        />
      </label>
      <label>
        Copy
        <textarea
          required
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>
      <label>
        Destination URL
        <input
          type="url"
          required
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        />
      </label>
      <label>
        Lifetime media budget ({g?.currency})
        <input
          type="number"
          min="0.01"
          step="0.01"
          required
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
        />
      </label>
      <p className="muted">
        Draft starts tomorrow for seven days. Review exact dates and all mapped
        copy at Launch before authorizing.
      </p>
      <button disabled={disabled || !g}>Save campaign draft</button>
    </form>
  );
}
