import { fork } from "node:child_process";
import { once } from "node:events";

/** Existing SQL host fixture, changed by a separate process and connection. */
export async function revokeIndependently(path: string, session: string, action = "revoke") {
  const child = fork(new URL("./session-race-child.js", import.meta.url), [path], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
  const exit = once(child, "exit");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await once(child, "message");
    const committed = new Promise<void>(resolve => child.on("message", (m: any) => { if (m.event === "committed") resolve(); }));
    child.send({ session, hold: false, action });
    await Promise.race([committed, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Independent revocation blocked by delayed work")), 1500); })]);
    await exit;
  } finally { clearTimeout(timer); child.kill("SIGTERM"); await exit; }
}
