import { useId, useRef, useState } from "react";
import type { ResolvedOption } from "../core/index.js";

/** Bounded synchronous host catalogs. Unknown saved selections stay visible and removable. */
export function ChoicePicker({ label, options, selected, onChange, multiple = true, disabled = false, limit = 30, removable = true, unavailableLabel = "Unresolved in this account catalog" }: {
  label: string; options: readonly ResolvedOption[]; selected: ResolvedOption[];
  onChange: (v: ResolvedOption[]) => void; multiple?: boolean; disabled?: boolean; limit?: number; removable?: boolean; unavailableLabel?: string;
}) {
  const [query, setQuery] = useState(""), [page, setPage] = useState(1);
  const search = useRef<HTMLInputElement>(null), chooser = useRef<HTMLDetailsElement>(null), name = useId();
  const unique = new Map<string, ResolvedOption>();
  const ambiguous = new Set<string>();
  for (const item of options.slice(0, 5000))
    if (item && typeof item.id === "string" && item.id.trim() && item.id.length <= 200 && typeof item.label === "string" && item.label.trim() && item.label.length <= 200) {
      if (unique.has(item.id) && unique.get(item.id)!.label !== item.label) ambiguous.add(item.id);
      else unique.set(item.id, { id: item.id, label: item.label });
    }
  for (const id of ambiguous) unique.delete(id);
  const choices = [...unique.values()], needle = query.trim().toLocaleLowerCase();
  const matches = choices.filter(x => `${x.label} ${x.id}`.toLocaleLowerCase().includes(needle));
  return <fieldset className="choice-picker" disabled={disabled}><legend>{label}</legend>
    <div className="selected-choices" aria-label={`Selected ${label}`}>
      {selected.length ? selected.map(x => <span className="choice-chip" key={x.id}>
        <span>{x.label || x.id}<small>{x.id}</small>{(!unique.has(x.id) || unique.get(x.id)?.label !== x.label) && <small>{unavailableLabel}{unique.has(x.id) && ` · Current catalog name: ${unique.get(x.id)!.label}. Remove and select again to confirm.`}</small>}</span>
        {removable && <button type="button" aria-label={`Remove ${x.label || x.id}`} onClick={() => { onChange(selected.filter(s => s.id !== x.id)); (chooser.current?.open ? search.current : chooser.current?.querySelector("summary"))?.focus(); }}>×</button>}
      </span>) : <small>Nothing selected</small>}
    </div>
    <details ref={chooser}><summary>Choose {label.toLocaleLowerCase()}</summary>
      <label>Search {label.toLocaleLowerCase()}<input ref={search} type="search" value={query} maxLength={200} onChange={e => { setQuery(e.target.value); setPage(1); }} /></label>
      {ambiguous.size > 0 && <p>Conflicting names for the same identifier were withheld. Ask your administrator to refresh the catalog.</p>}
      {choices.length === 0 ? <p>No resolved choices supplied. Ask your account administrator to refresh this account’s catalog. Saved unresolved values are retained; this does not verify them.</p>
        : <><p role="status">{matches.length} matching choices · {selected.length} selected{multiple && ` (up to ${limit})`}</p>
          <div className="choice-list">{matches.slice(0, page * 20).map(x => <label className="check choice-row" key={x.id}>
            <input type={multiple ? "checkbox" : "radio"} name={name} checked={selected.some(s => s.id === x.id)} disabled={multiple && selected.length >= limit && !selected.some(s => s.id === x.id)} onChange={() => onChange(multiple ? selected.some(s => s.id === x.id) ? selected.filter(s => s.id !== x.id) : [...selected, x] : [x])} />
            <span>{x.label}<small>{x.id}</small></span>
          </label>)}</div>
          {!matches.length && <p>No matches. Try a shorter name or the exact identifier.</p>}
          {matches.length > page * 20 && <button type="button" onClick={() => setPage(page + 1)}>Show more {label.toLocaleLowerCase()}</button>}
        </>}
      {options.length > 5000 && <p>Showing the first 5,000 supplied choices. Ask your administrator for a narrower catalog if a choice is missing.</p>}
    </details>
  </fieldset>;
}
