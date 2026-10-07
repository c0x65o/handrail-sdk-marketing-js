import { useMemo } from "react";
import { createMarketingClient } from "@handrail/marketing";
import { MarketingWorkspace } from "@handrail/marketing/react";
import "@handrail/marketing/react/style.css";

/** Host supplies project selection, same-origin API and a non-secret UI epoch
 * that changes on login/logout/session replacement (never a session token). */
export function EmbeddedMarketing({ projectId, sessionEpoch }: { projectId: string; sessionEpoch: string }) {
  const client = useMemo(
    () => createMarketingClient(window.location.origin, projectId),
    [projectId, sessionEpoch],
  );
  return <MarketingWorkspace key={`${projectId}:${sessionEpoch}`} client={client} />;
}
