/* global process, fetch, console */
// Run against the same reference host after a human signs in. Supply the
// session via a private environment/Vault binding; never paste it in source.
import { createMarketingClient } from "../../.marketing-build/core/index.js";
const { MARKETING_PUBLIC_URL, MARKETING_PROJECT_ID, MARKETING_SESSION_TOKEN } =
  process.env;
if (!MARKETING_PUBLIC_URL || !MARKETING_PROJECT_ID || !MARKETING_SESSION_TOKEN)
  throw new Error("Host URL, project and private session binding required");
const transport = (url, init) =>
  fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${MARKETING_SESSION_TOKEN}`,
    },
  });
const marketing = createMarketingClient(
  MARKETING_PUBLIC_URL,
  MARKETING_PROJECT_ID,
  transport,
);
const workspace = await marketing.call("workspace", {});
console.log(
  JSON.stringify(
    {
      project: workspace.project,
      campaigns: workspace.campaigns.map((c) => ({
        id: c.id,
        revision: c.revision,
        state: c.state,
      })),
    },
    null,
    2,
  ),
);
// Mutations use the same typed client. An agent can prepare material and
// request a packet; only a separately authenticated human can call decide.
