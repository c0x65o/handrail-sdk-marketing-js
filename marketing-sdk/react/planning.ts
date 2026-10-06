import type { Commands, MarketingClient, PlanningInput } from "../core/index.js";

/** Server-retained result must be resolved before a different planning intent.
 * Keys may be lost on reload; the pending result cannot be lost with them. */
export async function planningWrite<K extends PlanningInput["command"]>(
  client: MarketingClient, command: K, input: Commands[K]["input"], requestKey: string, scope: string | undefined, isCurrent = () => true,
): Promise<Commands[K]["output"]> {
  if (!scope) throw new Error("Reload the workspace before saving this plan");
  const receipt = await client.call("planningWrite", { command, input, requestKey, scope } as Commands["planningWrite"]["input"]);
  if (!isCurrent()) throw new Error("Saved result retained for review after scope changed");
  // Receiving the result resolves uncertainty. A failed acknowledgment leaves
  // the saved result visible for explicit review; it must not hide this success.
  await client.call("acknowledgePlanningWrite", { id: receipt.id }).catch(() => {});
  return receipt.result as Commands[K]["output"];
}
