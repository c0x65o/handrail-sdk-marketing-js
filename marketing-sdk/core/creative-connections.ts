/** Safe metadata only. No credential values or custody references cross this boundary. */
export type CreativeProvider = "openai" | "xai";
export interface CreativeConnectionStatus {
  id: string; revision: number; projectId: string; environment: string;
  provider: CreativeProvider; purpose: "image" | "video" | "text"; model: string;
  configurationRevision: string; expiresAt: string; grantId: string | null;
  credential: "missing" | "configured" | "expired" | "revoked" | "unavailable";
  /** Retention is distinct from current permission to use the binding. */
  credentialStored: boolean;
  generationAuthority: "missing" | "configured" | "expired" | "revoked" | "unavailable";
  providerVerification: "unverified";
  billing: { state: "configured" | "unavailable"; currency?: string; maxUnitMinor?: number; expiresAt?: string };
  paidOperation: "blocked";
  reasons: string[]; path: string;
}
