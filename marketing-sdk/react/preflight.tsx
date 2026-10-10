import { useEffect, useRef, useState } from "react";
import type { Campaign, CampaignCheck, MarketingClient } from "../core/index.js";

const corrections: Record<string, string> = {
  selected_country_unresolved: "A selected country could not be resolved. Open Audience, resolve the retained choices, or remove and select a current country before checking again.",
  country_search_unavailable: "Country lookup is temporarily unavailable. Your selections remain saved; retry this check after access recovers.",
  connection_configuration_changed: "Connection configuration or access policy changed. Review the existing connection in Connections, then check again.",
  provider_access_expired_or_denied: "Current provider access could not be confirmed. Review the existing connection and its approved scope in Connections.",
  provider_scope_conflict: "The provider returned conflicting scope information. Resolve the connection status, then check again.",
  tracking_source_changed: "The first-party source changed. Review and save the current Tracking configuration.",
  tracking_material_or_binding_changed: "Tracking no longer matches this campaign. Review and save its current configuration.",
  asset_bytes_missing_or_changed: "Retained artwork is missing or changed. Reselect intact media in Studio and save the updated campaign.",
  campaign_check_read_deadline: "Provider reads did not finish within two minutes. Read the saved status or explicitly start another check.",
  first_party_inquiry_required: "Save current first-party inquiry Tracking configuration for this campaign.",
  targeting_catalogue_required: "These selected targeting options need a qualified targeting catalogue. Connections supplies publishing identities only.",
  campaign_prerequisite_tuple_unqualified: "This check currently supports Meta single-image ordinary traffic only. This provider or delivery combination remains unqualified.",
  provider_account_status_or_billing_unverified: "The provider did not confirm an active account with a billing signal. Check the selected account's status and billing.",
  provider_account_role_missing: "The connected identity lacks advertising access to this account. Review its existing access in Connections.",
  provider_account_context_changed: "The provider account, currency or timezone differs from this campaign. Review the selected account and campaign settings.",
  provider_discovery_conflict: "Provider account or Page results conflict. Resolve the conflicting provider records, then check again.",
  provider_discovery_incomplete: "The provider returned incomplete account or Page results. Check again when complete reads are available.",
  provider_read_unavailable: "Provider reads are temporarily unavailable. Read the saved status or explicitly try another check.",
  campaign_prerequisites_stale: "Campaign data or access changed during the check. Review the campaign and check again.",
  meta_daily_budget_semantics_unverified: "Meta daily budgets remain unqualified. Review this campaign's budget before continuing.",
};
const checkError = (error: unknown) => corrections[error instanceof Error ? error.message : ""] ??
  "The check response could not be confirmed. Read its saved status before starting another check.";
export function CampaignPrerequisites({ client, campaign, grantRevision, canEdit, onState }: {
  client: MarketingClient; campaign: Campaign; grantRevision: number; canEdit: boolean;
  onState: (ready: boolean) => void;
}) {
  const [check, setCheck] = useState<CampaignCheck | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const flight = useRef<{ epoch: number; active: boolean; running?: boolean; controller?: AbortController; key?: string }>({ epoch: 0, active: true });
  const notify = useRef(onState); notify.current = onState;
  const apply = (v: CampaignCheck | null) => { setCheck(v); notify.current(v?.state === "ready" && Date.parse(v.expiresAt ?? "") > Date.now()); };
  useEffect(() => {
    const f = flight.current; f.active = true; const epoch = ++f.epoch; f.controller = new AbortController(); notify.current(false);
    void client.call("campaignCheck", { campaignId: campaign.id }, { signal: f.controller.signal }).then(v => {
      if (f.active && f.epoch === epoch) apply(v);
    }).catch(e => { if (f.active && f.epoch === epoch && !f.controller?.signal.aborted) setError(checkError(e)); });
    return () => { f.active = false; ++f.epoch; f.controller?.abort(); notify.current(false); };
  }, [client, campaign.id, campaign.revision, grantRevision]);
  useEffect(() => {
    if (check?.state !== "ready") return;
    const timer = setTimeout(() => apply({ ...check, state: "stale", reasons: ["This check expired. Check updated campaign before preparing."] }), Math.max(0, Date.parse(check.expiresAt!) - Date.now()));
    return () => clearTimeout(timer);
  }, [check]);
  async function run(recover = false) {
    const f = flight.current; if (f.running || !f.active) return;
    f.running = true;
    const epoch = ++f.epoch; f.controller?.abort(); f.controller = new AbortController(); setBusy(true); setError(""); notify.current(false);
    if (!recover) f.key = crypto.randomUUID();
    try {
      const v = recover ? await client.call("campaignCheck", { campaignId: campaign.id, ...(f.key ? { requestKey: f.key } : {}) }, { signal: f.controller.signal })
        : await client.call("checkCampaign", { campaignId: campaign.id, expectedRevision: campaign.revision, expectedGrantRevision: grantRevision, requestKey: f.key! }, { signal: f.controller.signal });
      if (f.active && f.epoch === epoch) apply(v);
    } catch (e) { if (f.active && f.epoch === epoch) setError(checkError(e)); }
    finally { if (f.epoch === epoch) f.running = false; if (f.active && f.epoch === epoch) setBusy(false); }
  }
  function cancel() { const f = flight.current; ++f.epoch; f.running = false; f.controller?.abort(); setBusy(false); notify.current(false); setError("Check left in history. Read its saved status or explicitly start a new check."); }
  const labels = { checking: "Checking prerequisites", ready: "Ready for preparation", blocked: "Prerequisites blocked", incomplete: "Check incomplete", stale: "Campaign check stale" };
  return <section aria-label="Campaign prerequisites" className="card">
    <h3>{busy ? labels.checking : check ? labels[check.state] : "Check campaign prerequisites"}</h3>
    <p>Checks current prerequisites for attempting separately authorized paused preparation. This does not approve the advertisement, policy review, delivery, spend or attribution. Media upload and created objects still need provider acceptance and readback.</p>
    {check?.evidence === "fixture" && <p>Synthetic HTTP fixture check. Actual account eligibility is not established.</p>}
    {check?.checkedAt && <p>Last checked: <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString()}</time></p>}
    {check?.state === "ready" && <ul>{check.facts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
    {!!check?.reasons.length && <ul>{check.reasons.map(r => <li key={r}>{corrections[r] ?? r.replaceAll("_", " ")}</li>)}</ul>}
    {error && <p role="alert">{error}</p>}
    <div className="actions">
      <button disabled={busy || !canEdit} onClick={() => void run()}>{check?.state === "stale" ? "Check updated campaign" : check?.state === "ready" ? "Refresh campaign check" : "Check this campaign"}</button>
      {(error || check?.state === "checking" || check?.state === "incomplete") && <button disabled={busy} onClick={() => void run(true)}>Read saved campaign check</button>}
      {busy && <button onClick={cancel}>Cancel check</button>}
    </div>
  </section>;
}
