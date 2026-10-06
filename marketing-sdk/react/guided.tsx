import { useEffect, useRef, useState, type ReactNode } from "react";
import { CAPABILITY_VERSION, capabilityBlockers, capabilityStatus, LINKEDIN_COMBINATIONS, META_COMBINATIONS,
  type Audience, type Campaign, type CampaignDraft, type DraftMaterial, type Material, type MarketingClient,
  type ProviderSettings, type PublicGrant, type ResolvedOption, type ProfessionalFacet, providerBudgetBlockers } from "../core/index.js";
import { defaultCampaignSchedule, dateAtInstant, instantAtDate } from "./schedule.js";
import { ChoicePicker } from "./choices.js";
import { planningWrite } from "./planning.js";

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
  return { name: "", headline: "", body: "", destination: "", destinationDigest: "", assetIds: [],
    purpose: "acquisition", settings: initialSettings(g), budget: { currency: g.currency, minor: 0 },
    ...defaultCampaignSchedule(g.timezone), timezone: g.timezone,
    audience: { provider: g.provider, locations: [], expansion: false },
    ...(g.provider === "google" ? { searchHeadlines: ["", "", ""], searchDescriptions: ["", ""] } : {}),
  };
}
const split = (value: string) => value.split(",").map(x => x.trim()).filter(Boolean);
function Select({ label, value, choices, onChange }: { label: string; value: string; choices: readonly string[]; onChange: (value: string) => void }) {
  return <label>{label}<select aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
    {!choices.includes(value) && <option value={value}>{value || "Choose…"}</option>}
    {choices.map(x => <option key={x} value={x}>{x}</option>)}</select></label>;
}
function ResolvedSelect({ label, kind, selected, grant, onChange }: { label: string; kind: string; selected: ResolvedOption[]; grant: PublicGrant; onChange: (v: ResolvedOption[]) => void }) {
  return <><ChoicePicker key={`${grant.id}:${kind}`} label={label} options={(grant.targetingOptions || []).slice(0, 5000).filter(x => x.kind === kind)} selected={selected} onChange={onChange} />{(grant.targetingOptions?.length || 0) > 5000 && <p>Catalog limited to the first 5,000 supplied entries. Ask your administrator for a narrower account catalog.</p>}</>;
}
function IdentifierField({ label, kind, value, grant, onChange, allowed }: { label: string; kind: NonNullable<PublicGrant["selectionOptions"]>[number]["kind"]; value: string; grant: PublicGrant; onChange: (v: string) => void; allowed?: string }) {
  const options = (grant.selectionOptions || []).slice(0, 5000).filter(x => x.kind === kind && (allowed === undefined || x.id === allowed));
  if (allowed && !options.some(x => x.id === allowed)) options.push({ id: allowed, label: `Granted ${label.toLowerCase()} (name not supplied)`, kind });
  return <><ChoicePicker label={label} options={options} selected={value ? [{ id: value, label: options.find(x => x.id === value)?.label || value }] : []} multiple={false} onChange={v => onChange(v[0]?.id || "")} />
    <details><summary>Manual {label.toLowerCase()} identifier</summary><label>{label} identifier<input value={value} onChange={e => onChange(e.target.value)} /></label><p>Use an existing account-owned identifier. Manual entry is unresolved until the server verifies ownership and the exact event binding.</p></details></>;
}
export function AudienceFields({ value, grant, onChange }: { value: Audience; grant?: PublicGrant; onChange: (a: Audience) => void }) {
  return <>
    {grant && <ChoicePicker label={value.provider === "meta" ? "Countries" : "Locations"} options={(grant.targetingOptions || []).slice(0, 5000).filter(x => x.kind === "locations")} selected={value.locations.map(id => ({ id, label: grant.targetingOptions?.slice(0, 5000).find(x => x.kind === "locations" && x.id === id)?.label || id }))} limit={20} onChange={v => onChange({ ...value, locations: v.map(x => x.id) })} />}
    {(grant?.targetingOptions?.length || 0) > 5000 && <p>Catalog limited to the first 5,000 supplied entries. Ask your administrator for a narrower account catalog.</p>}
    <details><summary>Manual location identifiers</summary><label>{value.provider === "meta" ? "Countries (ISO codes)" : "Location identifiers"}<input aria-label="Locations" value={value.locations.join(", ")} onChange={e => onChange({ ...value, locations: split(e.target.value) })} /></label><p>Identifiers are preserved without translation. Missing catalog entries do not establish account eligibility.</p></details>
    {value.provider === "meta" && <div className="grid"><label>Minimum age<input type="number" min="18" max="65" value={value.ageMin ?? ""} onChange={e => onChange({ ...value, ageMin: e.target.value ? Number(e.target.value) : undefined })} /></label>
      <label>Maximum age<input type="number" min="18" max="65" value={value.ageMax ?? ""} onChange={e => onChange({ ...value, ageMax: e.target.value ? Number(e.target.value) : undefined })} /></label></div>}
    {value.provider === "google" && <label>Exact search keywords<input value={value.keywords?.join(", ") || ""} onChange={e => onChange({ ...value, keywords: split(e.target.value) })} /></label>}
    <p>Audience expansion is off in the request. Provider evidence is required; this is not a promise of delivery.</p>
  </>;
}
function TuplePicker({ material: m, onChange }: { material: Material; onChange: (s: ProviderSettings) => void }) {
  const s = m.settings!;
  const manual = useRef(s.provider === "linkedin" && s.bid.mode === "manual" ? s.bid.amountMinor : 0);
  if (s.provider === "linkedin" && s.bid.mode === "manual") manual.current = s.bid.amountMinor;
  const friendly = (value: string) => ({ OUTCOME_TRAFFIC: "Traffic", OUTCOME_AWARENESS: "Awareness", OUTCOME_LEADS: "Leads", LINK_CLICKS: "Link clicks", IMPRESSIONS: "Impressions", REACH: "Reach", OFFSITE_CONVERSIONS: "Website conversions", WEBSITE_VISIT: "Website visits", WEBSITE_CONVERSION: "Website conversions", BRAND_AWARENESS: "Brand awareness", ENGAGEMENT: "Engagement", NONE: "Manual click bid", MAX_CLICK: "Maximize clicks", ENHANCED_CONVERSION: "Enhanced conversions", MAX_CONVERSION: "Maximize conversions", MAX_REACH: "Maximize reach" }[value] || value);
  const rows = s.provider === "meta"
    ? META_COMBINATIONS.filter(x => (x[0] === "employment") === (m.purpose === "recruitment")).map(x => ({ id: x.join("/"), label: `${friendly(x[1])} · ${friendly(x[2])} · ${x[0]} · lowest cost` }))
    : LINKEDIN_COMBINATIONS.filter(x => m.purpose !== "recruitment" || x[0] === "WEBSITE_CONVERSION").map(x => ({ id: x.join("/"), label: `${friendly(x[0])} · ${friendly(x[1])} · ${x[2]} ${x[3]}` }));
  const current = s.provider === "meta" ? [s.delivery, s.objective, s.optimization].join("/") : [s.objective, s.optimization, s.bid.mode, s.bid.costType].join("/");
  return <><ChoicePicker label="Objective, optimization and bid" multiple={false} removable={false} unavailableLabel="Incompatible with the selected purpose" options={rows} selected={[{ id: current, label: rows.find(x => x.id === current)?.label || current }]} onChange={v => {
    const row = v[0]?.id.split("/"); if (!row) return;
    if (s.provider === "meta") onChange({ ...s, delivery: row[0], objective: row[1], optimization: row[2] } as ProviderSettings);
    else onChange({ ...s, objective: row[0], optimization: row[1], bid: row[2] === "manual" ? { mode: "manual", costType: "CPC", amountMinor: manual.current } : { mode: "auto", costType: "CPM" } } as ProviderSettings);
  }} /><p>Choosing a tuple changes only objective, optimization and bidding/delivery mode. Manual CPC needs your amount. Existing targeting, conversion, consent, purpose and budget stay unchanged; incompatible fields must be reviewed below.</p>
    <p>Current objective: {s.objective} · optimization: {s.optimization}</p></>;
}
function ScheduleFields({ material: m, onChange }: { material: Material; onChange: (patch: Partial<Material>) => void }) {
  const [error, setError] = useState("");
  const date = (value: string) => { try { return dateAtInstant(value, m.timezone); } catch { return ""; } };
  return <fieldset><legend>Authored campaign schedule · {m.timezone}</legend>
    <p>Start is inclusive; end is the first day excluded. These dates control the campaign schedule, not the reporting window. Choosing a date explicitly replaces that boundary with the start of that day.</p>
    {([['startAt', 'Start date'], ['endAt', 'End date (exclusive)']] as const).map(([field, label]) => <label key={field}>{label}<input type="date" value={date(m[field])} onChange={e => {
      try { onChange({ [field]: instantAtDate(e.target.value, m.timezone) }); setError(""); } catch (e) { setError((e as Error).message); }
    }} /></label>)}
    <details><summary>Exact UTC instants</summary><label>Start (UTC)<input value={m.startAt} onChange={e => onChange({ startAt: e.target.value })} /></label>
      <label>End (UTC, exclusive)<input value={m.endAt} onChange={e => onChange({ endAt: e.target.value })} /></label></details>
    <p>{m.startAt || "Start required"} → {m.endAt || "End required"} (exclusive)</p>
    {m.settings?.provider === "linkedin" && <p>LinkedIn requires UTC midnight boundaries. Partial days and non-UTC schedules are rejected.</p>}
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}
export function GuidedFields({ value: m, grant: g, onChange }: { value: Material; grant: PublicGrant; onChange: (m: Material) => void }) {
  const update = (patch: Partial<Material>) => onChange({ ...m, ...patch });
  const s = m.settings;
  const settings = (patch: Record<string, unknown>) => update({ settings: { ...s, ...patch } as ProviderSettings });
  return <>
    <label>Campaign name<input required value={m.name} onChange={e => update({ name: e.target.value })} /></label>
    <Select label="Purpose" value={m.purpose || ""} choices={["acquisition", "recruitment"]} onChange={v => update({ purpose: v as Material["purpose"], applicantGoal: v === "recruitment" ? { event: "ApplicantRequestMOU", meaning: "completed_mou_request" } : undefined })} />
    {m.purpose === "recruitment" && <p>Applicant goal: ApplicantRequestMOU · completed MOU request. Applications, customers and hires are separate outcomes.</p>}
    {m.purpose === "recruitment" && (m.applicantGoal?.event !== "ApplicantRequestMOU" || m.applicantGoal?.meaning !== "completed_mou_request") && <p role="status">The saved recruitment outcome needs an explicit choice. <button type="button" onClick={() => update({ applicantGoal: { event: "ApplicantRequestMOU", meaning: "completed_mou_request" } })}>Use completed MOU request goal</button></p>}
    <label>Headline<input required value={m.headline} onChange={e => update({ headline: e.target.value })} /></label>
    <label>Copy<textarea required value={m.body} onChange={e => update({ body: e.target.value })} /></label>
    <label>Destination URL<input type="url" required value={m.destination} onChange={e => update({ destination: e.target.value, destinationDigest: "" })} /></label>
    {g.provider === "google" && <fieldset><legend>Search ad copy</legend>{(["searchHeadlines", "searchDescriptions"] as const).map(field => (m[field] || []).map((v, i) => <label key={`${field}:${i}`}>{field === "searchHeadlines" ? "Search headline" : "Search description"} {i + 1}<input value={v} onChange={e => update({ [field]: m[field]!.map((x, n) => n === i ? e.target.value : x) })} /></label>))}</fieldset>}
    {!s && g.provider !== "google" && <button type="button" onClick={() => settings(initialSettings(g)! as unknown as Record<string, unknown>)}>Choose explicit provider settings</button>}
    {s && <>
      <p>{s.provider} · API {s.apiVersion} · account {s.accountId}</p>
      {s.accountId !== g.accountId && <p role="status">Saved settings refer to another account. Identity, conversions and targeting will still need review. <button type="button" onClick={() => settings({ accountId: g.accountId })}>Bind settings to selected account</button></p>}
      <TuplePicker material={m} onChange={settings => update({ settings })} />
      <Select label="Format" value={s.format} choices={[s.provider === "meta" ? "single_image" : "STANDARD_UPDATE"]} onChange={format => settings({ format })} />
      {((s.provider === "linkedin" && s.objective !== "WEBSITE_CONVERSION" && s.conversion) || (s.provider === "meta" && s.delivery !== "employment" && (s.conversion || s.specialAdCategory || s.specialAdCategoryCountry))) && <p role="status">The new tuple is incompatible with the retained conversion/category fields. <button type="button" onClick={() => settings(s.provider === "meta" ? { conversion: undefined, specialAdCategory: undefined, specialAdCategoryCountry: undefined } : { conversion: undefined })}>Remove unused conversion fields</button></p>}
      <p>One image per creative set. Document and video ad publishing remain unavailable.</p>
      {s.provider === "meta" ? <>
        <IdentifierField label="Page identity" kind="page" grant={g} allowed={g.pageId || ""} value={s.identity.pageId} onChange={pageId => settings({ identity: { ...s.identity, pageId } })} />
        <Select label="Feed placements" value={s.placements.join(",")} choices={["facebook_feed", "instagram_feed", "facebook_feed,instagram_feed"]} onChange={v => settings({ placements: v.split(",") })} />
        {s.placements.includes("instagram_feed") && <IdentifierField label="Instagram identity" kind="instagram" grant={g} allowed={g.instagramUserId || ""} value={s.identity.instagramUserId || ""} onChange={instagramUserId => settings({ identity: { ...s.identity, instagramUserId } })} />}
        {s.identity.instagramUserId && !s.placements.includes("instagram_feed") && <button type="button" onClick={() => settings({ identity: { pageId: s.identity.pageId } })}>Remove unused Instagram identity</button>}
        <ResolvedSelect label="Languages" kind="languages" selected={s.targeting.languages} grant={g} onChange={languages => settings({ targeting: { ...s.targeting, languages } })} />
        {s.targeting.interestGroups.map((group, i) => <div key={i}><ResolvedSelect label={`Interest group ${i + 1} (OR)`} kind="interests" selected={group} grant={g} onChange={v => settings({ targeting: { ...s.targeting, interestGroups: s.targeting.interestGroups.map((x, n) => n === i ? v : x) } })} /><button type="button" onClick={() => settings({ targeting: { ...s.targeting, interestGroups: s.targeting.interestGroups.filter((_, n) => n !== i) } })}>Remove interest group {i + 1}</button></div>)}
        <button type="button" disabled={s.targeting.interestGroups.length >= 5} onClick={() => settings({ targeting: { ...s.targeting, interestGroups: [...s.targeting.interestGroups, []] } })}>Add AND interest group</button>
        <ResolvedSelect label="Exclude existing custom audiences" kind="customAudiences" selected={s.targeting.excludedCustomAudiences} grant={g} onChange={excludedCustomAudiences => settings({ targeting: { ...s.targeting, excludedCustomAudiences } })} />
        {s.delivery === "employment" && <>
          <Select label="Special ad category" value={s.specialAdCategory || ""} choices={["EMPLOYMENT"]} onChange={specialAdCategory => settings({ specialAdCategory })} />
          <Select label="Special category country" value={s.specialAdCategoryCountry || ""} choices={["US"]} onChange={specialAdCategoryCountry => settings({ specialAdCategoryCountry })} />
          <IdentifierField label="Pixel" kind="pixel" grant={g} value={s.conversion?.pixelId || ""} onChange={pixelId => settings({ conversion: { ...s.conversion, pixelId, event: "ApplicantRequestMOU" } })} />
          <IdentifierField label="ApplicantRequestMOU custom conversion" kind="conversion" grant={g} value={s.conversion?.customConversionId || ""} onChange={customConversionId => settings({ conversion: { ...s.conversion, customConversionId, event: "ApplicantRequestMOU" } })} />
          <p>US only; ages 18–65+, all genders, no language, interest or exclusion narrowing. Eligibility remains unverified until the host retains exact provider evidence.</p>
        </>}
      </> : <>
        <IdentifierField label="Organization identity" kind="organization" grant={g} allowed={g.organizationId || ""} value={s.identity.organizationId} onChange={organizationId => settings({ identity: { organizationId } })} />
        <p>Cost type: {s.bid.costType} · LinkedIn feed only</p>
        {s.bid.mode === "manual" && <label>Manual bid ({g.currency})<input type="number" min="0.01" step="0.01" value={s.bid.amountMinor / 100 || ""} onChange={e => settings({ bid: { ...s.bid, amountMinor: Math.round(Number(e.target.value) * 100) } })} /></label>}
        <ResolvedSelect label="Resolved locations" kind="locations" selected={m.audience.locations.map(id => ({ id, label: g.targetingOptions?.find(x => x.kind === "locations" && x.id === id)?.label || id }))} grant={g} onChange={v => update({ audience: { ...m.audience, locations: v.map(x => x.id) } })} />
        {(["include", "exclude"] as const).map(side => <details key={side}><summary>{side} professional facets · OR within each, {side === "include" ? "AND between" : "exclude any matching facet"}</summary>{(["titles", "jobFunctions", "seniorities", "employers", "industries", "staffCountRanges"] as ProfessionalFacet[]).map(f => <ResolvedSelect key={f} label={`${side} ${f}`} kind={f} selected={s.targeting[side][f] || []} grant={g} onChange={v => settings({ targeting: { ...s.targeting, [side]: { ...s.targeting[side], [f]: v } } })} />)}</details>)}
        {s.objective === "WEBSITE_CONVERSION" && <>
          <IdentifierField label="Conversion" kind="conversion" grant={g} value={s.conversion?.id || ""} onChange={id => settings({ conversion: { ...s.conversion, id } })} />
          <Select label="Conversion type" value={s.conversion?.type || ""} choices={m.purpose === "recruitment" ? ["OTHER"] : ["LEAD", "PURCHASE"]} onChange={type => settings({ conversion: { ...s.conversion, type } })} />
          <Select label="Conversion event" value={s.conversion?.event || ""} choices={m.purpose === "recruitment" ? ["ApplicantRequestMOU"] : ["Lead", "Purchase"]} onChange={event => settings({ conversion: { ...s.conversion, event } })} />
        </>}
        <label className="check"><input type="checkbox" checked={s.politicalConsent} onChange={e => settings({ politicalConsent: e.target.checked })} />My campaign contains no political advertisements under the laws of any targeted country, including EU law. I will comply with LinkedIn policies and all applicable regulatory requirements.</label>
      </>}
      <p>LinkedIn tools may not be used to discriminate based on personal characteristics such as gender, age, race, or ethnicity. Employment ads must provide equal access to opportunities on every provider. <a href="https://www.linkedin.com/legal/ads-policy" target="_blank" rel="noreferrer">LinkedIn advertising policies</a></p>
      <label className="check"><input type="checkbox" checked={s.nondiscriminationAccepted} onChange={e => settings({ nondiscriminationAccepted: e.target.checked })} />I acknowledge the nondiscrimination requirements.</label>
    </>}
    {(g.provider !== "linkedin" || !s) && <AudienceFields grant={g} value={m.audience} onChange={audience => update({ audience })} />}
    {!["USD", "EUR", "GBP", "CAD", "AUD"].includes(g.currency) && <p role="status">This account currency is not supported by the SDK money contract. Existing amounts are retained; choose a supported account.</p>}
    <fieldset disabled={!["USD", "EUR", "GBP", "CAD", "AUD"].includes(g.currency)}><legend>Planning media amounts · {g.currency}</legend>
    <label>Lifetime media budget ({g.currency})<input type="number" min="0.01" step="0.01" required value={m.budget.minor / 100 || ""} onChange={e => {
      const budget = { currency: g.currency, minor: Math.round(Number(e.target.value) * 100) }; update({ budget, ...(m.advertisingBudget ? { advertisingBudget: { ...m.advertisingBudget, lifetime: budget } } : {}) });
    }} /></label>
    {g.provider !== "google" && <label>Daily media budget ({g.currency}){g.provider === "linkedin" ? " — required" : " — optional"}<input type="number" min="0.01" step="0.01" required={g.provider === "linkedin"} value={m.advertisingBudget?.daily ? m.advertisingBudget.daily.minor / 100 : ""} onChange={e => update({ advertisingBudget: e.target.value ? { ...m.advertisingBudget, lifetime: m.budget, daily: { currency: g.currency, minor: Math.round(Number(e.target.value) * 100) } } : undefined })} /></label>}
    </fieldset>
    {s?.provider === "linkedin" && <p>Policy checks reserve 150% of the daily amount, bounded by your lifetime approval, for potential daily overdelivery.</p>}
    {providerBudgetBlockers(m).length > 0 && <p role="status">Meta daily budget exposure and cap compatibility are unverified. Native preparation and activation are blocked; saving a draft does not qualify them.</p>}
    <p>Daily amounts are pacing targets, not hard intraday caps. Reservations cover managed media commitments; observed spend is separate. External campaigns, taxes and fees require additional host coverage. A pause does not settle delayed charges.</p>
    {m.budget.currency !== g.currency && <p role="status">Retained amount uses {m.budget.currency}; this account uses {g.currency}. No currency conversion is available. <button type="button" onClick={() => update({ budget: { currency: g.currency, minor: 0 }, advertisingBudget: undefined })}>Clear amounts and use account currency</button></p>}
    {m.timezone !== g.timezone && <p role="status">Retained schedule uses {m.timezone}; this account uses {g.timezone}. <button type="button" onClick={() => update({ timezone: g.timezone, startAt: "", endAt: "" })}>Clear dates and use account timezone</button></p>}
    <ScheduleFields material={m} onChange={update} />
    {s?.provider === "linkedin" && <p>Include titles OR job functions/seniority; including employers cannot also include industries/company size. Company size cannot be on both include and exclude sides. Incompatible selections remain visible until you remove them.</p>}
    {capabilityBlockers(m, g).length > 0 && <div role="status"><strong>Readiness blockers</strong><ul>{capabilityBlockers(m, g).map(x => <li key={x}>{x.replaceAll("_", " ")}</li>)}</ul></div>}
    {s && <p>SDK combination: {capabilityStatus(m, g).sdkSupported ? "supported" : "incomplete or unsupported"} · Account verified: {capabilityStatus(m, g).accountVerified ? "yes" : "no"} · Delivery observed: no</p>}
  </>;
}
export function GuidedMaterialEditor({ value, grant, disabled, onSave, renderReview }: { renderReview: (m: Material) => ReactNode; value: Material; grant: PublicGrant; disabled: boolean; onSave: (m: Material) => Promise<void> }) {
  const [draft, setDraft] = useState(value), [busy, setBusy] = useState(false), [review, setReview] = useState(false), [error, setError] = useState("");
  const saving = useRef(false), editor = useRef<HTMLDivElement>(null);
  useEffect(() => { if (editor.current?.closest("details")?.open) editor.current.focus(); }, [review]);
  return <details><summary>Edit complete campaign material</summary><p>Saving creates a new material revision and invalidates earlier launch authority.</p>
    <div ref={editor} tabIndex={-1}>{review ? <><h3>Review changes</h3>{renderReview(draft)}</> : <GuidedFields value={draft} grant={grant} onChange={setDraft} />}</div>
    {error && <p role="alert">{error}</p>}
    <div className="actions"><button type="button" disabled={disabled || busy} onClick={() => { setDraft(value); setReview(false); setError(""); }}>Cancel changes</button>
      {review ? <><button type="button" disabled={busy} onClick={() => setReview(false)}>Back to editing</button><button type="button" disabled={disabled || busy || capabilityBlockers(draft, grant).length > 0} onClick={async () => {
        if (saving.current) return; saving.current = true; setBusy(true); setError("");
        try { await onSave(draft); } catch (e) { setError((e as Error).message); } finally { saving.current = false; setBusy(false); }
      }}>Save material revision</button></> : <button type="button" onClick={() => setReview(true)}>Review changes</button>}</div>
  </details>;
}
export function DraftCard({ draft, client, scope, onSaved, disabled, onPromote, promoted, onOpen }: { draft?: CampaignDraft; client: MarketingClient; scope?: string; onSaved: () => Promise<void>; disabled: boolean; onPromote?: () => void; promoted?: Campaign; onOpen?: () => void }) {
  const [value, setValue] = useState<DraftMaterial>(draft?.material || { name: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRef({ key: crypto.randomUUID(), material: "" });
  const current = useRef(draft); const saving = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  return <section className="card"><h3>{draft ? draft.material.name : "Unconnected draft"}</h3><p>Local planning only · no account or launch authority</p>
    <details open={!draft}><summary>{draft ? "Edit local draft" : "Plan without an account"}</summary>
    <label>Draft name<input value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} /></label>
    <label>Draft destination<input value={value.destination || ""} onChange={e => setValue({ ...value, destination: e.target.value })} /></label>
    <label>Draft copy<textarea value={value.body || ""} onChange={e => setValue({ ...value, body: e.target.value })} /></label>
    <Select label="Draft provider" value={value.audience?.provider || ""} choices={["meta", "linkedin", "google"]} onChange={provider => setValue({ ...value, audience: { ...value.audience, provider: provider as Audience["provider"], expansion: false } })} />
    <Select label="Draft purpose" value={value.purpose || ""} choices={["acquisition", "recruitment"]} onChange={purpose => setValue({ ...value, purpose: purpose as Material["purpose"] })} />
    {error && <p role="alert">{error}</p>}
    <button disabled={disabled || busy || !value.name.trim()} onClick={async () => {
      if (saving.current || current.current && JSON.stringify(current.current.material) === JSON.stringify(value)) return; saving.current = true; setBusy(true);
      const serialized = JSON.stringify(value);
      if (request.current.material !== serialized) request.current = { key: crypto.randomUUID(), material: serialized };
      try { current.current = await planningWrite(client, "saveDraft", { id: current.current?.id, expectedRevision: current.current?.revision, requestKey: request.current.key, material: value }, request.current.key, scope, () => active.current); await onSaved(); setError(""); if (!draft) { current.current = undefined; setValue({ name: "" }); request.current = { key: crypto.randomUUID(), material: "" }; } }
      catch (e) { setError((e as Error).message); } finally { saving.current = false; setBusy(false); }
    }}>Save local draft</button>
    <button disabled={busy} onClick={() => { setValue(current.current?.material || { name: "" }); setError(""); }}>Cancel draft changes</button>
    <details><summary>Saved planning diagnostics</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
    </details>
    {promoted && <p role="status">Planning campaign already created from revision {promoted.draftOrigin?.revision}: {promoted.material.name}. The local draft is unchanged. <button type="button" onClick={onOpen}>Open planning campaign</button></p>}
    {draft && !promoted && onPromote && <button data-draft-promote={draft.id} type="button" disabled={disabled || busy || JSON.stringify(value) !== JSON.stringify(current.current?.material)} onClick={onPromote}>Review promotion to account</button>}
    {draft && JSON.stringify(value) !== JSON.stringify(current.current?.material) && <p>Save or cancel your draft changes before promotion.</p>}
  </section>;
}

/** Fill only missing structural fields; never translate authored account/identity/targeting. */
export function promotionMaterial(draft: CampaignDraft, g: PublicGrant, reconstruct = false): Material {
  const base = initialMaterial(g);
  const source = reconstruct ? { ...draft.material, settings: undefined, applicantGoal: undefined } : draft.material;
  const merge = (fallback: any, value: any): any => {
    if (value === undefined) return fallback;
    if (fallback && typeof fallback === "object" && !Array.isArray(fallback)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This draft has incompatible field shapes. Use the explicit reconstruction option below to review fresh provider settings.");
      return Object.fromEntries([...new Set([...Object.keys(fallback), ...Object.keys(value)])].map(k => [k, merge(fallback[k], value[k])]));
    }
    return value;
  };
  if (base.settings?.provider === "meta") base.settings.identity = { pageId: "" };
  if (base.settings?.provider === "linkedin") base.settings.identity = { organizationId: "" };
  const m = merge({ ...base, startAt: "", endAt: "", purpose: undefined }, source) as Material;
  if (m.audience.provider !== g.provider || m.settings && m.settings.provider !== g.provider)
    throw new Error("Choose an account on the draft’s original provider. Targeting and identity cannot be translated.");
  const shape = capabilityBlockers(m).filter(x => ["invalid_provider_settings", "invalid_resolved_targeting", "invalid_professional_facets"].includes(x));
  if (shape.length) throw new Error("The saved provider settings are incomplete or malformed. Use the explicit reconstruction option below; the original draft is retained.");
  return m;
}
export function DraftPromotion({ draft, grants, client, scope, disabled, onCancel, onSaved, renderReview }: {
  draft: CampaignDraft; grants: PublicGrant[]; client: MarketingClient; scope?: string; disabled: boolean; onCancel: () => void;
  onSaved: (c: Campaign) => Promise<void>; renderReview: (m: Material) => ReactNode;
}) {
  const [grantId, setGrantId] = useState("");
  const eligible = grants.filter(g => !g.revokedAt && Date.parse(g.expiresAt) > Date.now() && (!draft.material.audience?.provider || draft.material.audience.provider === g.provider));
  const g = eligible.find(x => x.id === grantId);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="card promotion"><h2 ref={heading} tabIndex={-1}>Promote local draft: {draft.material.name}</h2>
    <p>Source revision {draft.revision} is retained unchanged. Choose an authorized account, complete the material and review it. Promotion creates planning material only. Cancel discards unsaved promotion edits and keeps the local draft. Preparation, launch and access remain separate.</p>
    <ChoicePicker label="Promotion account" multiple={false} options={eligible.map(x => ({ id: x.id, label: `${x.provider} · ${x.label}` }))} selected={g ? [{ id: g.id, label: `${g.provider} · ${g.label}` }] : []} onChange={v => setGrantId(v[0]?.id || "")} disabled={disabled} />
    {!eligible.length && <p>No current compatible account grant. Ask your administrator to supply an authorized connection; your local draft remains available.</p>}
    {g && <PromotionForm key={`${g.id}:${g.revision}`} draft={draft} grant={g} client={client} scope={scope} disabled={disabled} onSaved={onSaved} renderReview={renderReview} />}
    <button type="button" onClick={onCancel}>Cancel promotion</button>
  </section>;
}
function PromotionForm({ draft, grant: g, client, scope, disabled, onSaved, renderReview }: {
  draft: CampaignDraft; grant: PublicGrant; client: MarketingClient; scope?: string; disabled: boolean;
  onSaved: (c: Campaign) => Promise<void>; renderReview: (m: Material) => ReactNode;
}) {
  const [initial] = useState(() => { try { return { material: promotionMaterial(draft, g), error: "" }; } catch (e) { return { material: null, error: (e as Error).message }; } });
  const [m, setMaterial] = useState(initial.material), [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(initial.error);
  const active = useRef(true), allowed = useRef(!disabled), intent = useRef(`promotion:${draft.id}:${draft.revision}:${g.id}:${g.revision}`), saving = useRef(false), panel = useRef<HTMLDivElement>(null);
  allowed.current = !disabled;
  const captured = useRef<{ url: string; digest: string } | null>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { panel.current?.focus(); }, [review]);
  if (!m) return <div><p role="alert">{error}</p>
    <p>Reconstructing replaces only provider settings and outcome binding in this promotion form. It discards malformed identity, conversion, targeting and bidding settings here, resets all consent, and supplies no bid amount. The original local draft and its provenance stay unchanged. Review every field; this does not qualify delivery.</p>
    <button type="button" disabled={disabled} onClick={() => { try { setMaterial(promotionMaterial(draft, g, true)); setError(""); } catch (e) { setError((e as Error).message); } }}>Reconstruct provider settings for review</button>
    <details><summary>Original saved draft</summary><pre>{JSON.stringify(draft.material, null, 2)}</pre></details>
  </div>;
  const missing = [!m.name.trim() && "Campaign name", !m.headline.trim() && "Headline", !m.body.trim() && "Copy", !m.destination && "HTTPS destination", !m.budget.minor && "Lifetime budget", !m.purpose && "Purpose", !m.startAt && "Start date", !m.endAt && "End date", !m.audience.locations.length && "Locations", m.audience.provider === "meta" && (m.audience.ageMin === undefined || m.audience.ageMax === undefined) && "Minimum and maximum age", Date.parse(m.startAt) >= Date.parse(m.endAt) && "End must be later than start", m.settings?.provider === "linkedin" && !m.advertisingBudget?.daily && "Daily budget", m.budget.currency !== g.currency && "Account currency mismatch", m.timezone !== g.timezone && "Account timezone mismatch"].filter(Boolean);
  const blockers = [...missing, ...capabilityBlockers(m, g)];
  return <div ref={panel} tabIndex={-1}>
    <p>Target: {g.label} · {g.accountId} · {g.currency} · {g.timezone}. Existing draft values are retained; missing fields need your review. No CPC amount, budget or consent is supplied.</p>
    <fieldset disabled={busy || disabled}>{review ? <><h3>Review planning campaign</h3>{renderReview(m)}</> : <GuidedFields value={m} grant={g} onChange={setMaterial} />}</fieldset>
    {!review && m.settings && blockers.length > 0 && <details><summary>Reconstruct retained provider settings</summary>
      <p>This explicitly clears provider identity, targeting, conversion, bidding and outcome settings in this form and resets consent. Copy, amounts, audience and schedule remain as entered; the original draft is preserved. All provider choices must be reviewed again.</p>
      <button type="button" disabled={busy || disabled} onClick={() => {
        try { setMaterial(promotionMaterial({ ...draft, material: m }, g, true)); setError(""); }
        catch (e) { setError((e as Error).message); }
      }}>Reset provider settings for review</button>
    </details>}
    {blockers.length > 0 && <div role="status"><strong>Complete or resolve before promotion</strong><ul>{blockers.map((x, i) => <li key={i}>{String(x).replaceAll("_", " ")}</li>)}</ul></div>}
    {error && <p role="alert">{error.replaceAll("_", " ")} Retry uses the same server-owned draft/account binding. If another actor promoted this revision, reload the workspace to inspect its campaign.</p>}
    {review ? <div className="actions"><button type="button" disabled={busy} onClick={() => setReview(false)}>Back to promotion editing</button><button type="button" disabled={disabled || busy || blockers.length > 0} onClick={async () => {
      if (saving.current) return; saving.current = true; setBusy(true); setError("");
      try {
        if (captured.current?.url !== m.destination) captured.current = await client.call("captureDestination", { url: m.destination });
        if (!active.current || !allowed.current) return;
        const result = await planningWrite(client, "promoteDraft", { draftId: draft.id, expectedRevision: draft.revision, grantId: g.id, expectedGrantRevision: g.revision, material: { ...m, destinationDigest: captured.current!.digest } }, intent.current, scope, () => active.current && allowed.current);
        if (active.current) await onSaved(result);
      } catch (e) { if (active.current) setError((e as Error).message); }
      finally { saving.current = false; if (active.current) setBusy(false); }
    }}>Create planning campaign</button></div> : <button type="button" disabled={disabled} onClick={() => setReview(true)}>Review planning campaign</button>}
  </div>;
}
