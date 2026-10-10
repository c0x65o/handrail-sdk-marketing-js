// A separate process/connection; no shared JS mutex or AsyncLocalStorage.
import { testStore } from "./datastore.js";
const store = await testStore(process.argv[2]!);
process.send!({ event: "ready", pid: process.pid });
process.once("message", async (message: { session: string; hold: boolean; action: string }) => {
  try {
    process.send!({ event: "attempt" });
    await store.transaction(async () => {
      if (message.action === "disable") await store.db.prepare("UPDATE fixture_host_users SET disabled=1,revision=revision+1 WHERE subject='alice'").run();
      else if (message.action === "role") await store.db.prepare("UPDATE fixture_host_memberships SET role='analyst' WHERE subject='alice'").run();
      else if (message.action === "project") await store.db.prepare("DELETE FROM fixture_host_memberships WHERE subject='alice'").run();
      else if (message.action === "configuration") await store.db.prepare("UPDATE fixture_host_users SET revision=revision+1 WHERE subject='alice'").run();
      else if (message.action === "expiry") await store.db.prepare("UPDATE fixture_host_sessions SET expires_at=0 WHERE id=?").run(message.session);
      else await store.db.prepare("UPDATE fixture_host_sessions SET revoked=1 WHERE id=?").run(message.session);
      if (message.hold) {
        process.send!({ event: "locked" });
        await new Promise<void>(resolve => process.once("message", () => resolve()));
      }
    });
    process.send!({ event: "committed" });
  } finally { await store.close(); process.disconnect!(); }
});
