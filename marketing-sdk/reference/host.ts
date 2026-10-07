import { createCredentialCipher } from "../support/vault-crypto.js";
import { openDatastore } from "./datastore.js";
import { bootstrapFixture } from "./seed.js";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Store,
  DomainError,
  requireThat,
  byteDigest,
} from "../server/store.js";
import { createConnections } from "../server/connections.js";
import { MarketingServer } from "../server/service.js";
import {
  FixtureAgent,
  FixtureGeneration,
  FixtureProvider,
} from "../server/fixtures.js";
import { HostAgent, type OAuthApp } from "../server/agent.js";
import { NativeProvider } from "../server/providers.js";
import { NativeGeneration } from "../server/generation.js";
import { BoundGenerationBilling } from "../server/billing.js";
import type { Asset, Command, Commands, Grant, Setup } from "../core/index.js";
async function json(req: IncomingMessage) {
  requireThat(
    req.headers["content-type"]?.split(";")[0] === "application/json",
    "json_required",
    415,
  );
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireThat(size <= 256 * 1024, "body_too_large", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new DomainError("invalid_json", 400);
  }
}
function reply(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "content-type": "application/json",
  });
  res.end(JSON.stringify(value));
}
export async function createHost(options: {
  store: Store;
  service: MarketingServer;
  origin: string;
  staticDir: string;
  version: string;
  agent?: HostAgent;
}) {
  const { store, service } = options;
  // A single serialized drain belongs to this reference application. Embedded
  // hosts call dispatch from their existing executor instead of running this.
  let drain: Promise<void> | null = null;
  let wakeRequested = false;
  const wake = () => {
    wakeRequested = true;
    if (!drain)
      drain = (async () => {
        do {
          wakeRequested = false;
          for (const p of await store.db
            .prepare("SELECT id FROM projects")
            .all()) {
            const project = String(p.id);
            for (const o of (
              await store.list<{
                id: string;
                state: string;
              }>(project, "operation")
            ).filter((x) => x.state === "queued"))
              await service.dispatch(project, o.id);
            for (const j of (
              await store.list<{
                id: string;
                state: string;
              }>(project, "job")
            ).filter((x) => x.state === "queued")) {
              try {
                await service.dispatchGeneration(project, j.id);
              } catch {
                await store.transaction(async () => {
                  const current = await store.get<{ state: string }>(
                    project,
                    "job",
                    j.id,
                  );
                  if (current.state === "queued")
                    await store.put(project, "job", j.id, {
                      ...current,
                      state: "failed",
                      reason: "generation_preflight_denied",
                    });
                });
              }
            }
          }
        } while (wakeRequested);
      })()
        .catch(() => {
          /* Durable running effects remain fenced; health fails on DB/lock loss. */
        })
        .finally(() => {
          drain = null;
        });
    return drain;
  };
  const connectionRoutes = service.connections.routes({ origin: options.origin, authenticate: async request => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") || /(?:^|; )marketing_session=([^;]+)/.exec(request.headers.get("cookie") || "")?.[1] || "";
    return store.authenticate(token);
  } });
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      await store.db.assertExecutor();
      const url = new URL(req.url || "/", options.origin);
      if (req.method === "GET" && (/^\/api\/oauth\//.test(url.pathname) || /\/connections\/[^/]+\/handoff$/.test(url.pathname))) {
        const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
        const response = await connectionRoutes(new Request(url, { headers }));
        if (response) { res.writeHead(response.status, Object.fromEntries(response.headers)); return res.end(await response.text()); }
      }
      if (req.method === "GET" && url.pathname === "/healthz") {
        requireThat(
          await store.db
            .prepare("SELECT version FROM migrations WHERE version=2")
            .get(),
          "schema_unavailable",
          503,
        );
        return reply(res, 200, {
          ok: true,
          version: options.version,
          source: existsSync(new URL("../source-manifest.json", import.meta.url))
            ? JSON.parse(
                readFileSync(new URL("../source-manifest.json", import.meta.url), "utf8"),
              ).digest
            : null,
          mode: service.mode,
          schema: 1,
          sessionSchema: 2,
          datastore: store.db.dialect,
          browserAgent: "unavailable",
          setup: "oauth-consent-and-native-verification",
        });
      }
      // No forwarded headers are trusted by default. For a TLS ingress origin,
      // secure cookies are set from the configured canonical public URL.
      if (req.method === "POST")
        requireThat(
          !req.headers.origin || req.headers.origin === options.origin,
          "origin_denied",
          403,
        );
      if (req.method === "POST" && url.pathname === "/api/login") {
        const input = await json(req);
        requireThat(
          typeof input.username === "string" &&
            typeof input.password === "string" &&
            input.password.length <= 4096,
          "invalid_credentials",
          401,
        );
        const token = await store.login(
          input.username,
          input.password,
          req.socket.remoteAddress || "unknown",
        );
        requireThat(token, "invalid_credentials", 401);
        res.setHeader(
          "set-cookie",
          `marketing_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${options.origin.startsWith("https:") ? "; Secure" : ""}`,
        );
        return reply(res, 200, {
          ok: true,
        });
      }
      const token =
        req.headers.authorization?.replace(/^Bearer /, "") ||
        /(?:^|; )marketing_session=([^;]+)/.exec(
          req.headers.cookie || "",
        )?.[1] ||
        "";
      if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/fixture-takeover/")
      ) {
        const principal = await store.authenticate(token);
        if (url.pathname === "/api/logout" && req.method === "POST") {
          await store.revokeSession(token);
          res.setHeader(
            "set-cookie",
            "marketing_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
          );
          return reply(res, 200, {
            ok: true,
          });
        }
        if (url.pathname === "/api/healthz") {
          await store.db
            .prepare("SELECT version FROM migrations WHERE version=2")
            .get();
          return reply(res, 200, {
            ok: true,
            userId: principal.userId,
            version: options.version,
            mode: service.mode,
            datastore: store.db.dialect,
          });
        }
        if (url.pathname === "/api/me") {
          const rows = await store.db
            .prepare(
              "SELECT p.id,p.name,m.role FROM memberships m JOIN projects p ON p.id=m.project_id WHERE m.user_id=?",
            )
            .all(principal.userId);
          return reply(res, 200, {
            projects: rows,
          });
        }
        const callback =
          /^\/api\/oauth\/([^/]+)\/(meta|google|linkedin)\/callback$/.exec(
            url.pathname,
          );
        if (callback && req.method === "GET") {
          requireThat(options.agent, "oauth_unavailable");
          await options.agent.complete(
            principal,
            callback[1]!,
            callback[2] as Grant["provider"],
            (await url.searchParams.get("state")) || "",
            (await url.searchParams.get("code")) || "",
          );
          res.writeHead(303, {
            location: "/",
          });
          return res.end();
        }
        const takeover = /^\/fixture-takeover\/([^/]+)\/([^/]+)$/.exec(
          url.pathname,
        );
        if (takeover) {
          requireThat(
            service.mode === "fixture",
            "fixture_route_disabled",
            404,
          );
          const project = takeover[1]!,
            setupId = takeover[2]!;
          await store.authorize(principal, project, ["admin", "editor"], true);
          await store.get<Setup>(project, "setup", setupId);
          if (req.method === "POST") {
            await json(req);
            await store.put(project, "fixtureTakeover", setupId, {
              setupId,
              actorId: principal.userId,
            });
            return reply(res, 200, {
              ok: true,
            });
          }
          // GET has no side effect; the app shows an explicit human-only confirmation.
          return reply(res, 200, {
            fixture: true,
            setupId,
            action: "Return to Connections and confirm fixture takeover",
          });
        }
        const match = /^\/api\/projects\/([^/]+)\/([^/]+)(?:\/([^/]+))?$/.exec(
          url.pathname,
        );
        requireThat(match, "not_found", 404);
        const project = decodeURIComponent(match[1]!),
          action = match[2]!;
        await store.authorize(principal, project);
        if (action === "oauth" && req.method === "GET") {
          requireThat(options.agent, "oauth_unavailable");
          const location = await options.agent.begin(
            principal,
            project,
            match[3]!,
          );
          res.writeHead(303, {
            location,
          });
          return res.end();
        }
        if (action === "assets" && req.method === "GET") {
          const a = await store.get<Asset>(project, "asset", match[3]!);
          const row = await store.db
            .prepare("SELECT bytes FROM blobs WHERE project_id=? AND digest=?")
            .get(project, a.digest);
          requireThat(row, "asset_missing", 404);
          const bytes = Buffer.from(row.bytes as Uint8Array);
          requireThat(
            byteDigest(bytes) === a.digest,
            "asset_integrity_failure",
          );
          const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
          if (range) {
            const start = Number(range[1]),
              end = range[2]
                ? Math.min(Number(range[2]), bytes.length - 1)
                : bytes.length - 1;
            requireThat(
              start <= end && start < bytes.length,
              "invalid_range",
              416,
            );
            res.writeHead(206, {
              "content-type": a.mime,
              "accept-ranges": "bytes",
              "content-range": `bytes ${start}-${end}/${bytes.length}`,
              "content-length": end - start + 1,
            });
            return res.end(bytes.subarray(start, end + 1));
          }
          res.writeHead(200, {
            "content-type": a.mime,
            "content-length": bytes.length,
            "accept-ranges": "bytes",
          });
          return res.end(bytes);
        }
        if (action === "events" && req.method === "GET") {
          const cursor = Number((await url.searchParams.get("after")) || 0);
          requireThat(
            Number.isSafeInteger(cursor) && cursor >= 0,
            "invalid_cursor",
            422,
          );
          const rows = await store.db
            .prepare(
              "SELECT `cursor`,aggregate_id,type,body,created_at FROM outbox WHERE project_id=? AND `cursor`>? ORDER BY `cursor` LIMIT 100",
            )
            .all(project, cursor);
          return reply(res, 200, {
            events: rows.map((r) => ({
              ...r,
              body: JSON.parse(String(r.body)),
            })),
            cursor: rows.at(-1)?.cursor || cursor,
          });
        }
        requireThat(req.method === "POST", "method_not_allowed", 405);
        const output = await service.call(
          principal,
          project,
          action as Command,
          (await json(req)) as Commands[Command]["input"],
        );
        reply(res, 200, output);
        void wake();
        return;
      }
      requireThat(req.method === "GET", "method_not_allowed", 405);
      let target = resolve(
        options.staticDir,
        `.${decodeURIComponent(url.pathname)}`,
      );
      requireThat(
        target.startsWith(resolve(options.staticDir) + sep) ||
          target === resolve(options.staticDir),
        "not_found",
        404,
      );
      if (!existsSync(target) || !statSync(target).isFile())
        target = resolve(options.staticDir, "index.html");
      const bytes = readFileSync(target);
      const type =
        (
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
          } as Record<string, string>
        )[extname(target)] || "application/octet-stream";
      res.writeHead(200, {
        "content-type": type,
      });
      res.end(bytes);
    } catch (error) {
      reply(res, error instanceof DomainError ? error.status : 400, {
        error: error instanceof DomainError ? error.code : "request_failed",
        retry: "Inspect retained operation before retrying a write.",
      });
    }
  });
  await store.db.acquireExecutor(() => {
    server.close();
    server.closeAllConnections();
  });
  await service.recover();
  server.on("listening", () => {
    void wake();
  });
  return {
    server,
    wake,
    idle: async () => {
      await drain;
    },
  };
}
export async function runtime(
  env: NodeJS.ProcessEnv = process.env,
  testStore?: Store,
) {
  requireThat(
    ["fixture", "live"].includes(env.MARKETING_MODE || ""),
    "explicit_marketing_mode_required",
  );
  requireThat(env.MARKETING_PUBLIC_URL, "public_url_required");
  const store = testStore || (await openDatastore(env));
  const mode = env.MARKETING_MODE as "fixture" | "live";
  let agent: HostAgent | undefined;
  let service: MarketingServer;
  if (mode === "fixture") {
    const provider = new FixtureProvider(store);
    service = new MarketingServer(
      store,
      {
        meta: provider,
        google: provider,
        linkedin: provider,
      },
      new FixtureGeneration(),
      new FixtureAgent(store),
      mode,
    );
  } else {
    requireThat(env.MARKETING_CREDENTIAL_KEY && /^[a-fA-F0-9]{64}$/.test(env.MARKETING_CREDENTIAL_KEY), "credential_key_required");
    const keyId = env.MARKETING_CREDENTIAL_KEY_ID || "default";
    const cipher = createCredentialCipher(keyId, requested => {
      requireThat(requested === keyId, "credential_key_unavailable");
      return Buffer.from(env.MARKETING_CREDENTIAL_KEY!, "hex");
    });
    const apps = env.MARKETING_OAUTH_APPS_PATH
      ? (JSON.parse(
          readFileSync(env.MARKETING_OAUTH_APPS_PATH, "utf8"),
        ) as Partial<Record<Grant["provider"], OAuthApp>>)
      : {};
    agent = new HostAgent(store, env.MARKETING_PUBLIC_URL, apps, cipher);
    const billing = new BoundGenerationBilling(
      store,
      env.MARKETING_GENERATION_BINDINGS_PATH,
    );
    const generation = new NativeGeneration(
      async (provider, project, grantId) =>
        await billing.credentials(provider, project, grantId),
      billing,
    );
    service = new MarketingServer(
      store,
      {
        meta: new NativeProvider("meta", agent, store),
        google: new NativeProvider("google", agent, store),
        linkedin: new NativeProvider("linkedin", agent, store),
      },
      generation,
      agent,
      mode,
      undefined, undefined, { connections: createConnections({ store, custody: agent }) },
    );
  }
  return {
    store,
    service,
    agent,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const env = process.env;
  const { store, service, agent } = await runtime(env);
  await bootstrapFixture(store, env);
  const host = await createHost({
    store,
    service,
    agent,
    origin: env.MARKETING_PUBLIC_URL!,
    staticDir: fileURLToPath(new URL("../../marketing-sdk/reference/dist", import.meta.url)),
    version: env.MARKETING_RELEASE_SHA || "uncommitted-local",
  });
  host.server.listen(Number(env.PORT || 8080), "0.0.0.0", () =>
    console.log("Marketing reference host ready"),
  );
  const shutdown = async () => {
    await host.server.close(async () => {
      await host.idle();
      await store.close();
    });
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
