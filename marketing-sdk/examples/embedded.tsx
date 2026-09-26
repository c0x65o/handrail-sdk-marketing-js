import { useMemo } from "react";
import { createMarketingClient } from "../core/index.js";
import { MarketingWorkspace } from "../react/index.js";
import "../react/style.css";

/** Host supplies its authenticated project selection and same-origin API. */
export function EmbeddedMarketing({ projectId }: { projectId: string }) {
  const client = useMemo(
    () => createMarketingClient(window.location.origin, projectId),
    [projectId],
  );
  return <MarketingWorkspace key={projectId} client={client} />;
}
