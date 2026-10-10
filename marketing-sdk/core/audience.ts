import type { DraftMaterial } from "./index.js";

/** Display scope only. These inputs cannot confer preparation readiness. */
export interface AudienceContext {
  grantId: string;
  expectedGrantRevision: number;
  material: DraftMaterial;
  facet: "country";
  locale: "en_US";
}
export interface AudienceChoice { choiceRef: string; label: string; kind: "country"; }
export interface AudienceSelection extends AudienceChoice {
  /** Existing material identity, for persistence/optional technical details. */
  code: string;
  state: "resolved" | "unresolved";
}
export interface AudienceSearch {
  state: "available" | "empty" | "partial" | "unavailable" | "unsupported";
  choices: AudienceChoice[];
  continuation: string | null;
  reason: string | null;
}
export interface AudienceCommands {
  searchAudience: { input: AudienceContext & { query: string; continuation?: string }; output: AudienceSearch };
  resolveAudience: { input: AudienceContext & { choiceRefs: string[]; selected: string[] }; output: { selections: AudienceSelection[]; reason: string | null } };
  audienceStatus: { input: AudienceContext & { selected: string[] }; output: { selections: AudienceSelection[]; reason: string | null } };
}
