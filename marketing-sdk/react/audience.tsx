import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Audience, AudienceContext, AudienceSearch, AudienceSelection, MarketingClient, Material, Workspace } from "../core/index.js";

export const AudienceClientContext = createContext<MarketingClient | null>(null);
/** Display observations never confer launch readiness. The native check resolves
 * exact selected keys again, independently of this component's labels. */
export function CountryAudience({ value, grant, material, onChange }: {
  value: Audience; grant: Workspace["grants"][number]; material: Material; onChange: (value: Audience) => void;
}) {
  const client = useContext(AudienceClientContext);
  const root = useRef<HTMLFieldSetElement>(null), mounted = useRef(false);
  const [query, setQuery] = useState(""), [result, setResult] = useState<AudienceSearch | null>(null);
  const [selected, setSelected] = useState<AudienceSelection[]>([]), [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false), [selecting, setSelecting] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), resumeSearch = useRef(false), searching = useRef(false), resolving = useRef(false);
  const searchController = useRef<AbortController | null>(null);
  const statusRequest = useRef<{ key: string; controller: AbortController } | null>(null);
  const searchEpoch = useRef(0), selectionEpoch = useRef(0), controllers = useRef(new Set<AbortController>());
  const current = useRef({ value, material, query }); current.current = { value, material, query };
  const scope = JSON.stringify([grant.id, grant.revision, material.settings, material.purpose, material.advertisingBudget, value.ageMin, value.ageMax, value.expansion]);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const context = (): AudienceContext => ({ grantId: grant.id, expectedGrantRevision: grant.revision,
    facet: "country", locale: "en_US", material: current.current.material });
  const visible = () => mounted.current && !document.hidden && !!root.current?.getClientRects().length;
  const abort = () => { clearTimeout(debounce.current); ++searchEpoch.current; ++selectionEpoch.current; for (const c of controllers.current) c.abort(); controllers.current.clear(); searching.current = false; resolving.current = false; };
  const observe = async () => {
    if (!client || !visible() || resolving.current || !current.current.value.locations.length) return;
    const codes = current.current.value.locations.join(","), capturedScope = scopeRef.current;
    const key = JSON.stringify([capturedScope, codes]);
    if (statusRequest.current?.key === key && !statusRequest.current.controller.signal.aborted) return;
    const epoch = ++selectionEpoch.current, c = new AbortController(); controllers.current.add(c);
    statusRequest.current = { key, controller: c };
    try {
      const status = await client.call("audienceStatus", { ...context(), selected: current.current.value.locations }, { signal: c.signal });
      if (visible() && !c.signal.aborted && epoch === selectionEpoch.current && capturedScope === scopeRef.current && codes === current.current.value.locations.join(",")) {
        setSelected(status.selections); setMessage(status.reason ?? "");
      }
    } catch { if (visible() && !c.signal.aborted && epoch === selectionEpoch.current && capturedScope === scopeRef.current) setMessage("Country names could not be loaded. Your selections are retained. Retry resolving them."); }
    finally { controllers.current.delete(c); if (statusRequest.current?.controller === c) statusRequest.current = null; }
  };
  useEffect(() => {
    mounted.current = true;
    const resume = () => {
      if (!visible()) { resumeSearch.current ||= searching.current; searching.current = false; abort(); setLoading(false); setSelecting(false); return; }
      void observe(); if (resumeSearch.current) { resumeSearch.current = false; void search(); }
    };
    void observe();
    document.addEventListener("visibilitychange", resume);
    // Closed editor disclosures must not issue catalogue traffic.
    const toggle = (event: Event) => { if (event.target instanceof HTMLDetailsElement && event.target.contains(root.current)) resume(); };
    document.addEventListener("toggle", toggle, true);
    return () => { mounted.current = false; abort(); document.removeEventListener("visibilitychange", resume); document.removeEventListener("toggle", toggle, true); };
  }, [scope, client]);
  useEffect(() => { setSelected([]); setResult(null); setLoading(false); setSelecting(false); resumeSearch.current = false; setMessage(value.locations.length ? "Account or campaign context changed. Resolve your retained country selections." : ""); }, [scope, client]);
  const search = async (continuation?: string) => {
    clearTimeout(debounce.current);
    if (!client || !visible() || !current.current.query.trim()) return;
    const epoch = ++searchEpoch.current, capturedScope = scopeRef.current, q = current.current.query;
    searchController.current?.abort();
    const c = new AbortController(); searchController.current = c; controllers.current.add(c); searching.current = true; setLoading(true);
    try {
      const r = await client.call("searchAudience", { ...context(), query: q.trim(), ...(continuation ? { continuation } : {}) }, { signal: c.signal });
      if (visible() && !c.signal.aborted && epoch === searchEpoch.current && q === current.current.query && capturedScope === scopeRef.current)
        setResult(previous => continuation && previous ? { ...r, choices: [...previous.choices, ...r.choices].filter((v, i, a) => a.findIndex(x => x.choiceRef === v.choiceRef) === i) } : r);
    } catch { if (visible() && !c.signal.aborted && epoch === searchEpoch.current) setResult({ state: "unavailable", choices: [], continuation: null, reason: "Access or campaign context changed. Retry country search." }); }
    finally { controllers.current.delete(c); if (visible() && epoch === searchEpoch.current) { searching.current = false; setLoading(false); } }
  };
  useEffect(() => {
    ++searchEpoch.current; searchController.current?.abort(); searching.current = false; setResult(null); setLoading(false);
    if (!query.trim()) return;
    const timer = setTimeout(() => void search(), 350); debounce.current = timer;
    return () => { clearTimeout(timer); ++searchEpoch.current; };
  }, [query, scope]);
  const resolve = async (choiceRef?: string) => {
    if (!client || !visible() || resolving.current) return;
    const epoch = ++selectionEpoch.current, codes = [...current.current.value.locations], capturedScope = scopeRef.current;
    const c = new AbortController(); controllers.current.add(c); resolving.current = true; setSelecting(true);
    try {
      const r = await client.call("resolveAudience", { ...context(), choiceRefs: choiceRef ? [choiceRef] : [], selected: choiceRef ? [] : codes }, { signal: c.signal });
      if (!visible() || c.signal.aborted || epoch !== selectionEpoch.current || scopeRef.current !== capturedScope || codes.join(",") !== current.current.value.locations.join(",")) return;
      const next = choiceRef ? [...selected.filter(s => !r.selections.some(n => n.code === s.code)), ...r.selections] : r.selections;
      setSelected(next); setMessage(r.reason ?? "");
      onChange({ ...current.current.value, locations: choiceRef ? [...new Set([...codes, ...r.selections.map(s => s.code)])] : codes });
    } catch { if (visible() && !c.signal.aborted && epoch === selectionEpoch.current && capturedScope === scopeRef.current) setMessage("This choice is stale or unavailable. Search again or resolve the retained selections."); }
    finally { controllers.current.delete(c); if (mounted.current && epoch === selectionEpoch.current) { resolving.current = false; setSelecting(false); } }
  };
  return <fieldset ref={root} className="choice-picker"><legend>Countries</legend>
    <p>Meta · {grant.label}. Up to 20 countries. Native preflight checks the exact selections again.</p>
    <div className="selected-choices" aria-label="Selected countries">{value.locations.map(code => {
      const s = selected.find(x => x.code === code);
      return <span className="choice-chip" key={code}><span>{s?.label ?? "Unresolved selected country"}{(!s || s.state === "unresolved") && <small>Resolve or remove this selection</small>}</span>
        <button type="button" aria-label={`Remove ${s?.label ?? "unresolved country"}`} onClick={() => { ++selectionEpoch.current; resolving.current = false; setSelecting(false); onChange({ ...value, locations: value.locations.filter(x => x !== code) }); }}>×</button></span>;
    })}{!value.locations.length && <small>No countries selected</small>}</div>
    {value.locations.length > 0 && <><button type="button" disabled={selecting} onClick={() => void resolve()}>Resolve selected countries</button>
      <details><summary>Country identifiers</summary><p>{value.locations.join(", ")}</p></details></>}
    <label>Search countries<input type="search" value={query} maxLength={80} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void search(); } if (e.key === "Escape") { abort(); setLoading(false); setSelecting(false); setQuery(""); } }} /></label>
    <button type="button" disabled={!query.trim() || loading || !client} onClick={() => void search()}>Search countries</button>
    <p role="status">{loading ? "Searching countries…" : result?.state === "empty" ? "No matching countries. Try another name; saved selections are retained." : result?.reason ?? message}</p>
    <div className="choice-list actions">{result?.choices.map(c => <button className="choice-row" type="button" key={c.choiceRef} disabled={selecting || value.locations.length >= 20} onClick={() => void resolve(c.choiceRef)}>Select {c.label}</button>)}</div>
    {result?.continuation && <button type="button" disabled={loading} onClick={() => void search(result.continuation!)}>More countries</button>}
    {!client && <p>Mount this editor with the Marketing client to search countries.</p>}
  </fieldset>;
}
