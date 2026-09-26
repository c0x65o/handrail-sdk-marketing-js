import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** The host owns key custody and rotation. No environment or filesystem fallback. */
export interface CredentialCipher {
  encryptPayload(plaintext: string): { encrypted: string; keyId: string };
  decryptPayloadAsString(encrypted: string, keyId: string): string;
}

/** Retains the AES-256-GCM iv || tag || ciphertext envelope of existing records. */
export function createCredentialCipher(
  activeKeyId: string,
  resolveKey: (keyId: string) => Uint8Array,
): CredentialCipher {
  const key = (id: string) => {
    const bytes = resolveKey(id);
    if (!id || bytes?.byteLength !== 32) throw new Error("invalid_credential_key");
    return bytes;
  };
  key(activeKeyId);
  return {
    encryptPayload(plaintext) {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key(activeKeyId), iv);
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return { encrypted: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64"), keyId: activeKeyId };
    },
    decryptPayloadAsString(encrypted, keyId) {
      const bytes = Buffer.from(encrypted, "base64");
      if (bytes.length < 28) throw new Error("invalid_credential_envelope");
      const decipher = createDecipheriv("aes-256-gcm", key(keyId), bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    },
  };
}
