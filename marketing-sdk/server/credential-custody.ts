import { Store } from "./store.js";
import type { CredentialCipher } from "../support/vault-crypto.js";
/** Shared existing encrypted Store boundary. Server-only; refs convey no authority.
 * Callers must authorize before/after awaits. Inspection never decrypts a value. */
export class EncryptedCredentialCustody {
  constructor(readonly store: Store, readonly cipher: CredentialCipher) {}
  async retain(project: string, ref: string, value: unknown) {
    await this.store.put(project, "vault", ref, this.cipher.encryptPayload(JSON.stringify(value)));
  }
  async inspect(project: string, ref: string): Promise<boolean> {
    const row = await this.store.db.prepare("SELECT body FROM records WHERE project_id=? AND kind='vault' AND id=?").get(project, ref);
    if (!row) return false;
    const sealed = JSON.parse(String(row.body));
    return typeof sealed.encrypted === "string" && typeof sealed.keyId === "string";
  }
  async read<T>(project: string, ref: string): Promise<T> {
    const sealed = await this.store.get<{ encrypted: string; keyId: string }>(project, "vault", ref);
    return JSON.parse(this.cipher.decryptPayloadAsString(sealed.encrypted, sealed.keyId));
  }
}
