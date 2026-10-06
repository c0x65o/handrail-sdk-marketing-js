import { useRef, useState, type ReactNode } from "react";
import { CAPABILITY_VERSION, capabilityBlockers, capabilityStatus, LINKEDIN_COMBINATIONS, META_COMBINATIONS,
  type Audience, type CampaignDraft, type DraftMaterial, type Material, type MarketingClient,
  type ProviderSettings, type PublicGrant, type ResolvedOption, type ProfessionalFacet, providerBudgetBlockers } from "../core/index.js";
import { defaultCampaignSchedule } from "./schedule.js";

export function initialSettings(g: PublicGrant): ProviderSettings | undefined {
  const base = { version: CAPABILITY_VERSION, accountId: g.accountId, nondiscriminationAccepted: false };
  return g.provider === "meta" ? { ...base, provider: "meta", apiVersion: "v26.0", format: "single_image",
    objective: "OUTCOME_TRAFFIC", optimization: "LINK_CLICKS", delivery: "ordinary", placements: ["facebook_feed"],
    identity: { pageId: g.pageId || "" }, targeting: { languages: [], interestGroups: [], excludedCustomAudiences: [] } }
    : g.provider === "linkedin" ? { ...base, provider: "linkedin", apiVersion: "202609", format: "STANDARD_UPDATE",
      objective: "WEBSITE_VISIT", optimization: "NONE", bid: { mode: "manual", costType: "CPC", amountMinor: 0 },
      placements: ["linkedin_feed"], identity: { organizationId: g.organizationId || "" },
      targeting: { include: {}, exclude: {} }, politicalConsent: false, politicalIntent: "NOT_POLITICAL" } : undefined;
}
export function initialMaterial(g: PublicGrant): Material {
  return { name: "Autumn desk kit", headline: "A little room to think", body: "Explore a calmer workspace.",
    destination: "https://fieldwork.example/desk-kit", destinationDigest: "", assetIds: [],
    purpose: "acquisition", settings: initialSettings(g), budget: { currency: g.currency, minor: 4200 },
    ...defaultCampaignSchedule(g.timezone), timezone: g.timezone,
    audience: g.provider === "meta" ? { provider: "meta", locations: ["US"], ageMin: 25, ageMax: 54, expansion: false }
      : g.provider === "linkedin" ? { provider: "linkedin", locations: [], expansion: false }
        : { provider: "google", locations: ["geoTargetConstants/2840"], keywords: ["desk kit"], expansion: false },
    ...(g.provider === "google" ? { searchHeadlines: ["A little room to think", "Explore the desk kit", "Make space for your work"],
      searchDescriptions: ["Explore a calmer workspace.", "Learn about the kit and see what fits your workspace."] } : {}),
  };
}
const split = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);
function Select({ label, value, choices, onChange }: { label: string; value: string; choices: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
    {!choices.includes(value) && <option value={value}>{value || "Choose…"}</option>}
    {choices.map(x => <option key={x} value={x}>{x}</option>)}</select></label>;
}
function ResolvedSelect({ label, kind, selected, grant, onChange }: { label: string; kind: string; selected: ResolvedOption[]; grant: PublicGrant; onChange: (v: ResolvedOption[]) => void }) {
  const choices = grant.targetingOptions?.filter(x => x.kind === kind) || [];
  return <label>{label}<select aria-label={label} multiple value={selected.map(x => x.id)} onChange={e => onChange(Array.from(e.target.selectedOptions).map(o => {
    const choice = choices.find(x => x.id === o.value)!; return { id: choice.id, label: choice.label };
  }))}>
    {selected.filter(s => !choices.some(c => c.id === s.id)).map(x => <option key={x.id} value={x.id} disabled>{x.label || x.id} · unresolved</option>)}
    {choices.map(x => <option key={x.id} value={x.id}>{x.label} · {x.id}</option>)}
  </select>{choices.length === 0 && <small>No account-resolved options supplied yet.</small>}</label>;
}
export function AudienceFields({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  return <>
    <label>{value.provider === "meta" ? "Countries (ISO codes)" : "Location identifiers"}<input aria-label="Locations" value={value.locations.join(", ")} onChange={e => onChange({ ...value, locations: split(e.target.value) })} /></label>
    {value.provider === "meta" && <div className="grid"><label>Minimum age<input type="number" min="18" max="65" value={value.ageMin ?? ""} onChange={e => onChange({ ...value, ageMin: Number(e.target.value) })} /></label>
      <label>Maximum age<input type="number" min="18" max="65" value={value.ageMax ?? ""} onChange={e => onChange({ ...value, ageMax: Number(e.target.value) })} /></label></div>}
    {value.provider === "google" && <label>Exact search keywords<input value={value.keywords?.join(", ") || ""} onChange={e => onChange({ ...value, keywords: split(e.target.value) })} /></label>}
    <p>Audience expansion is off in the request. Provider evidence is required; this is not a promise of delivery.</p>
  </>;
}
export function GuidedFields({ value: m, grant: g, onChange }: { value: Material; grant: PublicGrant; onChange: (m: Material) => void }) {
  const update = (patch: Partial<Material>) => onChange({ ...m, ...patch });
  const s = m.settings;
  const settings = (patch: Record<string, unknown>) => update({ settings: { ...s, ...patch } as ProviderSettings });
  return <>
    <label>Campaign name<input required value={m.name} onChange={e => update({ name: e.target.value })} /></label>
    <Select label="Purpose" value={m.purpose || "acquisition"} choices={["acquisition", "recruitment"]} onChange={v => update({ purpose: v as Material["purpose"], applicantGoal: v === "recruitment" ? { event: "ApplicantRequestMOU", meaning: "completed_mou_request" } : undefined })} />
    {m.purpose === "recruitment" && <p>Applicant goal: ApplicantRequestMOU · completed MOU request. Applications, customers and hires are separate outcomes.</p>}
    <label>Headline<input required value={m.headline} onChange={e => update({ headline: e.target.value })} /></label>
    <label>Copy<textarea required value={m.body} onChange={e => update({ body: e.target.value })} /></label>
    <label>Destination URL<input type="url" required value={m.destination} onChange={e => update({ destination: e.target.value, destinationDigest: "" })} /></label>
    {!s && g.provider !== "google" && <button type="button" onClick={() => settings(initialSettings(g)! as unknown as Record<string, unknown>)}>Choose explicit provider settings</button>}
    {s && <>
      <p>{s.provider} · API {s.apiVersion} · account {s.accountId}</p>
      <Select label="Objective" value={s.objective} choices={[...new Set((s.provider === "meta" ? META_COMBINATIONS.map(x => x[1]) : LINKEDIN_COMBINATIONS.map(x => x[0])))]} onChange={objective => settings({ objective })} />
      <Select label="Optimization" value={s.optimization} choices={[...new Set((s.provider === "meta" ? META_COMBINATIONS.map(x => x[2]) : LINKEDIN_COMBINATIONS.map(x => x[1])))]} onChange={optimization => settings({ optimization })} />
      <Select label="Format" value={s.format} choices={[s.provider === "meta" ? "single_image" : "STANDARD_UPDATE"]} onChange={format => settings({ format })} />
      <p>One image per creative set. Document and video ad publishing remain unavailable.</p>
      {s.provider === "meta" ? <>
        <Select label="Delivery contract" value={s.delivery} choices={["ordinary", "strict", "employment"]} onChange={delivery => settings({ delivery })} />
        <Select label="Page identity" value={s.identity.pageId} choices={g.pageId ? [g.pageId] : []} onChange={pageId => settings({ identity: { ...s.identity, pageId } })} />
        <Select label="Feed placements" value={s.placements.join(",")} choices={["facebook_feed", "instagram_feed", "facebook_feed,instagram_feed"]} onChange={v => settings({ placements: v.split(",") })} />
        {s.placements.includes("instagram_feed") && <Select label="Instagram identity" value={s.identity.instagramUserId || ""} choices={g.instagramUserId ? [g.instagramUserId] : []} onChange={instagramUserId => settings({ identity: { ...s.identity, instagramUserId } })} />}
        {s.identity.instagramUserId && !s.placements.includes("instagram_feed") && <button type="button" onClick={() => settings({ identity: { pageId: s.identity.pageId } })}>Remove unused Instagram identity</button>}
        <ResolvedSelect label="Languages" kind="languages" selected={s.targeting.languages} grant={g} onChange={languages => settings({ targeting: { ...s.targeting, languages } })} />
        {s.targeting.interestGroups.map((group, i) => <div key={i}><ResolvedSelect label={`Interest group ${i + 1} (OR)`} kind="interests" selected={group} grant={g} onChange={v => settings({ targeting: { ...s.targeting, interestGroups: s.targeting.interestGroups.map((x, n) => n === i ? v : x) } })} /><button type="button" onClick={() => settings({ targeting: { ...s.targeting, interestGroups: s.targeting.interestGroups.filter((_, n) => n !== i) } })}>Remove interest group {i + 1}</button></div>)}
        <button type="button" disabled={s.targeting.interestGroups.length >= 5} onClick={() => settings({ targeting: { ...s.targeting, interestGroups: [...s.targeting.interestGroups, []] } })}>Add AND interest group</button>
        <ResolvedSelect label="Exclude existing custom audiences" kind="customAudiences" selected={s.targeting.excludedCustomAudiences} grant={g} onChange={excludedCustomAudiences => settings({ targeting: { ...s.targeting, excludedCustomAudiences } })} />
        {s.delivery === "employment" && <>
          <Select label="Special ad category" value={s.specialAdCategory || ""} choices={["EMPLOYMENT"]} onChange={specialAdCategory => settings({ specialAdCategory })} />
          <Select label="Special category country" value={s.specialAdCategoryCountry || ""} choices={["US"]} onChange={specialAdCategoryCountry => settings({ specialAdCategoryCountry })} />
          <label>Pixel ID<input value={s.conversion?.pixelId || ""} onChange={e => settings({ conversion: { ...s.conversion, pixelId: e.target.value, event: "ApplicantRequestMOU" } })} /></label>
          <label>ApplicantRequestMOU custom conversion ID<input value={s.conversion?.customConversionId || ""} onChange={e => settings({ conversion: { ...s.conversion, customConversionId: e.target.value, event: "ApplicantRequestMOU" } })} /></label>
          <p>US only; ages 18–65+, all genders, no language, interest or exclusion narrowing. Eligibility remains unverified until the host retains exact provider evidence.</p>
        </>}
      </> : <>
        <Select label="Organization identity" value={s.identity.organizationId} choices={g.organizationId ? [g.organizationId] : []} onChange={organizationId => settings({ identity: { organizationId } })} />
        <Select label="Bid mode" value={s.bid.mode} choices={["manual", "auto"]} onChange={mode => settings({ bid: mode === "manual" ? { mode, costType: "CPC", amountMinor: 0 } : { mode, costType: "CPM" } })} />
        <p>Cost type: {s.bid.costType} · LinkedIn feed only</p>
        {s.bid.mode === "manual" && <label>Manual bid ({g.currency})<input type="number" min="0.01" step="0.01" value={s.bid.amountMinor / 100 || ""} onChange={e => settings({ bid: { ...s.bid, amountMinor: Math.round(Number(e.target.value) * 100) } })} /></label>}
        <ResolvedSelect label="Resolved locations" kind="locations" selected={m.audience.locations.map(id => ({ id, label: g.targetingOptions?.find(x => x.kind === "locations" && x.id === id)?.label || id }))} grant={g} onChange={v => update({ audience: { ...m.audience, locations: v.map(x => x.id) } })} />
        {(["include", "exclude"] as const).map(side => <fieldset key={side}><legend>{side} professional facets · OR within each, {side === "include" ? "AND between" : "exclude any matching facet"}</legend>{(["titles", "jobFunctions", "seniorities", "employers", "industries", "staffCountRanges"] as ProfessionalFacet[]).map(f => <ResolvedSelect key={f} label={`${side} ${f}`} kind={f} selected={s.targeting[side][f] || []} grant={g} onChange={v => settings({ targeting: { ...s.targeting, [side]: { ...s.targeting[side], [f]: v } } })} />)}</fieldset>)}
        {s.objective === "WEBSITE_CONVERSION" && <>
          <label>Conversion URN<input value={s.conversion?.id || ""} onChange={e => settings({ conversion: { ...s.conversion, id: e.target.value } })} /></label>
          <Select label="Conversion type" value={s.conversion?.type || ""} choices={m.purpose === "recruitment" ? ["OTHER"] : ["LEAD", "PURCHASE"]} onChange={type => settings({ conversion: { ...s.conversion, type } })} />
          <Select label="Conversion event" value={s.conversion?.event || ""} choices={m.purpose === "recruitment" ? ["ApplicantRequestMOU"] : ["Lead", "Purchase"]} onChange={event => settings({ conversion: { ...s.conversion, event } })} />
        </>}
        <label className="check"><input type="checkbox" checked={s.politicalConsent} onChange={e => settings({ politicalConsent: e.target.checked })} />My campaign contains no political advertisements under the laws of any targeted country, including EU law. I will comply with LinkedIn policies and all applicable regulatory requirements.</label>
      </>}
      <p>LinkedIn tools may not be used to discriminate based on personal characteristics such as gender, age, race, or ethnicity. Employment ads must provide equal access to opportunities on every provider. <a href="https://www.linkedin.com/legal/ads-policy" target="_blank" rel="noreferrer">LinkedIn advertising policies</a></p>
      <label className="check"><input type="checkbox" checked={s.nondiscriminationAccepted} onChange={e => settings({ nondiscriminationAccepted: e.target.checked })} />I acknowledge the nondiscrimination requirements.</label>
    </>}
    {(g.provider !== "linkedin" || !s) && <AudienceFields value={m.audience} onChange={audience => update({ audience })} />}
    <label>Lifetime media budget ({g.currency})<input type="number" min="0.01" step="0.01" required value={m.budget.minor / 100 || ""} onChange={e => {
      const budget = { currency: g.currency, minor: Math.round(Number(e.target.value) * 100) }; update({ budget, ...(m.advertisingBudget ? { advertisingBudget: { ...m.advertisingBudget, lifetime: budget } } : {}) });
    }} /></label>
    {g.provider !== "google" && <label>Daily media budget ({g.currency}){g.provider === "linkedin" ? " — required" : " — optional"}<input type="number" min="0.01" step="0.01" required={g.provider === "linkedin"} value={m.advertisingBudget?.daily ? m.advertisingBudget.daily.minor / 100 : ""} onChange={e => update({ advertisingBudget: e.target.value ? { ...m.advertisingBudget, lifetime: m.budget, daily: { currency: g.currency, minor: Math.round(Number(e.target.value) * 100) } } : undefined })} /></label>}
    {s?.provider === "linkedin" && <p>Policy checks reserve 150% of the daily amount, bounded by your lifetime approval, for potential daily overdelivery.</p>}
    {providerBudgetBlockers(m).length > 0 && <p role="status">Meta daily budget exposure and cap compatibility are unverified. Native preparation and activation are blocked; saving a draft does not qualify them.</p>}
    <p>Daily amounts are pacing targets, not hard intraday caps. Reservations cover managed media commitments; observed spend is separate. External campaigns, taxes and fees require additional host coverage. A pause does not settle delayed charges.</p>
    <label>Start (UTC)<input aria-label="Start (UTC)" value={m.startAt} onChange={e => update({ startAt: e.target.value })} /></label>
    <label>End (UTC, exclusive)<input value={m.endAt} onChange={e => update({ endAt: e.target.value })} /></label>
    <p>{g.provider === "linkedin" ? "Reporting and budget timezone: UTC (LinkedIn policy, not an account field). Schedules must use UTC midnights." : `Account timezone: ${g.timezone}.`} Dates are explicit UTC instants; no browser-timezone conversion.</p>
    {capabilityBlockers(m, g).length > 0 && <div role="status"><strong>Readiness blockers</strong><ul>{capabilityBlockers(m, g).map(x => <li key={x}>{x.replaceAll("_", " ")}</li>)}</ul></div>}
    {s && <p>SDK combination: {capabilityStatus(m, g).sdkSupported ? "supported" : "incomplete or unsupported"} · Account verified: {capabilityStatus(m, g).accountVerified ? "yes" : "no"} · Delivery observed: no</p>}
  </>;
}
export function GuidedMaterialEditor({ value, grant, disabled, onSave, renderReview }: { renderReview: (m: Material) => ReactNode; value: Material; grant: PublicGrant; disabled: boolean; onSave: (m: Material) => Promise<void> }) {
  const [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [review, setReview] = useState(false), [error, setError] = useState("");
  const saving = useRef(false);
  return <details><summary>Edit complete campaign material</summary><p>Saving creates a new material revision and invalidates earlier launch authority.</p>
    {review ? <><h3>Review changes</h3>{renderReview(draft)}</> : <GuidedFields value={draft} grant={grant} onChange={setDraft} />}
    {error && <p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={disabled || busy} onClick={() => { setDraft(value); setReview(false); setError(""); }}>Cancel changes</button>
      {review ? <><button type="button" disabled={busy} onClick={() => setReview(false)}>Back to editing</button><button type="button" disabled={disabled || busy || capabilityBlockers(draft, grant).length > 0} onClick={async () => {
        if (saving.current) return; saving.current = true; setBusy(true); setError("");
        try { await onSave(draft); } catch (e) { setError((e as Error).message); } finally { saving.current = false; setBusy(false); }
      }}>Save material revision</button></> : <button type="button" onClick={() => setReview(true)}>Review changes</button>}</div>
  </details>;
}
export function DraftCard({ draft, client, onSaved, disabled }: { draft?: CampaignDraft; client: MarketingClient; onSaved: () => Promise<void>; disabled: boolean }) {
  const [value, setValue] = useState<DraftMaterial>(draft?.material || { name: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef({ key: crypto.randomUUID(), material: "" });
  const current = useRef(draft); const saving = useRef(false);
  return <section className="card"><h3>{draft ? draft.material.name : "Unconnected draft"}</h3><p>Local planning only · no account or launch authority</p>
    <label>Draft name<input value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></label>
    <label>Draft destination<input value={value.destination || ""} onChange={e => setValue({ ...value, destination: e.target.value })} /></label>
    <label>Draft copy<textarea value={value.body || ""} onChange={e => setValue({ ...value, body: e.target.value })} /></label>
    <Select label="Draft provider" value={value.audience?.provider || ""} choices={["meta", "linkedin", "google"]} onChange={provider => setValue({ ...value, settings: undefined, audience: { provider: provider as Audience["provider"], expansion: false } })} />
    <Select label="Draft purpose" value={value.purpose || ""} choices={["acquisition", "recruitment"]} onChange={purpose => setValue({ ...value, purpose: purpose as Material["purpose"] })} />
    {error && <p role="alert">{error}</p>}
    <button disabled={disabled || busy || !value.name.trim()} onClick={async () => {
      if (saving.current || current.current && JSON.stringify(current.current.material) === JSON.stringify(value)) return; saving.current = true; setBusy(true);
      const serialized = JSON.stringify(value);
      if (request.current.material !== serialized) request.current = { key: crypto.randomUUID(), material: serialized };
      try { current.current = await client.call("saveDraft", { id: current.current?.id, expectedRevision: current.current?.revision, requestKey: request.current.key, material: value }); await onSaved(); setError(""); }
      catch (e) { setError((e as Error).message); } finally { saving.current = false; setBusy(false); }
    }}>Save local draft</button>
    <button disabled={busy} onClick={() => { setValue(current.current?.material || { name: "" }); setError(""); }}>Cancel draft changes</button>
    <details><summary>Saved planning diagnostics</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
  </section>;
}
