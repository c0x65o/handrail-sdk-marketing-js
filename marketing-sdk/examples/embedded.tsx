import { useMemo } from "react";
import { createMarketingClient } from "@handrail/marketing";
import { MarketingWorkspace } from "@handrail/marketing/react";
import "@handrail/marketing/react/style.css";

/** Host supplies project selection, same-origin API and a non-secret UI epoch
 * that changes on login/logout/session replacement (never a session token).
 * Inject the existing host fetcher for required mutation/CSRF headers. */
export function EmbeddedMarketing({ projectId, sessionEpoch, fetcher = fetch }: {
  projectId: string; sessionEpoch: string; fetcher?: typeof fetch;
}) {
  const client = useMemo(
    () => createMarketingClient(window.location.origin, projectId, fetcher),
    [projectId, sessionEpoch, fetcher],
  );
  return <MarketingWorkspace key={`${projectId}:${sessionEpoch}`} client={client} />;
}
