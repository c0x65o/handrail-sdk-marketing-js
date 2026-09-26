/* global process, URL, console, document, innerWidth */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { chromium } from "playwright";
import { runtime, createHost } from "../../.marketing-build/reference/host.js";
import { testStore } from "../../.marketing-build/tests/datastore.js";
import { seedQa } from "../../.marketing-build/reference/seed.js";

const dir = await mkdtemp(join(tmpdir(), "marketing-browser-"));
const evidence = resolve(
  process.env.MARKETING_EVIDENCE_DIR || "artifacts/browser",
);
await mkdir(evidence, { recursive: true });
const password = randomBytes(32).toString("base64url");
const { store, service } = await runtime(
  {
    MARKETING_MODE: "fixture",
    MARKETING_PUBLIC_URL: "http://127.0.0.1",
  },
  await testStore(join(dir, "qa.sqlite")),
);
await seedQa(store, { username: "qa-browser", password });
// A disposable loopback HTTP host, never a staging substitute.
const host = await createHost({
  store,
  service,
  origin: "http://127.0.0.1",
  staticDir: resolve("marketing-sdk/reference/dist"),
  version: "local-browser-source",
});
await new Promise((r) => host.server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${host.server.address().port}`;
// Align the expected origin with the ephemeral port for CSRF validation.
// Use a second host after reserving a free port; no existing service is changed.
await new Promise((r) => host.server.close(r));
const app = await createHost({
  store,
  service,
  origin: base,
  staticDir: resolve("marketing-sdk/reference/dist"),
  version: "local-browser-source",
});
await new Promise((r) =>
  app.server.listen(Number(new URL(base).port), "127.0.0.1", r),
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.MARKETING_CHROMIUM_PATH || undefined,
  args: ["--no-sandbox"],
});
const report = {
  environment: `local-disposable-${store.db.dialect}-fixture`,
  version: "uncommitted-integration-source",
  observedAt: new Date().toISOString(),
  sourceDigest: JSON.parse(
    await readFile(".marketing-build/source-manifest.json", "utf8"),
  ).digest,
  viewports: [],
  errors: [],
};
try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 1440 ? 1000 : 844 },
      }),
      page = await context.newPage();
    page.on("pageerror", (e) => report.errors.push(e.message));
    const api = async (command, input) => {
      const r = await context.request.post(
        `${base}/api/projects/qa-alpha/${command}`,
        { data: input },
      );
      assert.equal(r.status(), 200, await r.text());
      return r.json();
    };
    const screenshot = async (name) => {
      const overflow = await page.evaluate(() => ({
        document: document.documentElement.scrollWidth,
        viewport: innerWidth,
        offenders: [...document.querySelectorAll("main *,aside *,header *")]
          .filter((e) => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1);
          })
          .map((e) => e.tagName + ":" + e.textContent?.slice(0, 50))
          .slice(0, 8),
      }));
      assert.ok(overflow.document <= width + 1, JSON.stringify(overflow));
      assert.equal(overflow.offenders.length, 0, JSON.stringify(overflow));
      await page.screenshot({
        path: join(evidence, `${width}-${name}.png`),
        fullPage: true,
      });
    };
    let releaseWorkspace;
    const workspaceGate = new Promise((resolve) => {
      releaseWorkspace = resolve;
    });
    await page.route("**/api/projects/qa-alpha/workspace", async (route) => {
      await workspaceGate;
      await route.continue();
    });
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill("qa-browser");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Loading your project…", { exact: true }).waitFor();
    await screenshot("loading");
    releaseWorkspace();
    await page
      .getByRole("heading", { name: "Workspace", exact: true })
      .waitFor();
    await screenshot("workspace");
    await page
      .getByLabel("Campaign name", { exact: true })
      .fill(`QA desk kit ${width}`);
    await page.getByRole("button", { name: "Save campaign draft" }).click();
    await page
      .getByRole("heading", { name: "Connections", exact: true })
      .waitFor();
    const meta = page.locator("section.card").filter({
      has: page.getByRole("heading", {
        name: "meta fixture account",
        exact: true,
      }),
    });
    if (
      await meta
        .getByRole("button", { name: "Connect meta", exact: true })
        .count()
    ) {
      await meta
        .getByRole("button", { name: "Connect meta", exact: true })
        .click();
      await meta
        .getByRole("button", { name: "Confirm fixture takeover" })
        .click();
    }
    await meta.getByRole("button", { name: "Resume and verify" }).click();
    await meta.getByText("ready", { exact: true }).waitFor();
    if (width === 1440)
      for (const provider of ["google", "linkedin"]) {
        const card = page.locator("section.card").filter({
          has: page.getByRole("heading", {
            name: `${provider} fixture account`,
            exact: true,
          }),
        });
        await card
          .getByRole("button", { name: `Connect ${provider}`, exact: true })
          .click();
        await card
          .getByRole("button", { name: "Confirm fixture takeover" })
          .click();
        await card.getByRole("button", { name: "Resume and verify" }).click();
        await card.getByText("ready", { exact: true }).waitFor();
      }
    await screenshot("connections");
    await page.getByRole("button", { name: "Creative", exact: true }).click();
    await page
      .getByLabel("Rights / approved source receipt")
      .fill("Synthetic QA fixture rights, no generated-media claim");
    await page
      .getByRole("button", { name: "Create image", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Use this image", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Use this image", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Create video", exact: true })
      .click();
    await page.locator("video").waitFor();
    await page.locator("video").evaluate((v) => v.play());
    await page.waitForFunction(
      () => document.querySelector("video")?.currentTime > 0,
    );
    await page.locator("video").evaluate((v) => v.pause());
    await page
      .getByLabel("Shot sequence")
      .fill("Fixture storyboard: establish, reveal, close.");
    await page
      .getByRole("button", { name: "Save storyboard", exact: true })
      .click();
    await page.getByRole("link", { name: "Read storyboard" }).waitFor();
    await screenshot("creative");
    await page.getByRole("button", { name: "Audience", exact: true }).click();
    const definition = JSON.parse(
      await page.getByLabel("Audience definition").inputValue(),
    );
    definition.ageMin = 30;
    await page
      .getByLabel("Audience definition")
      .fill(JSON.stringify({ ...definition, expansion: true }));
    await page.getByRole("button", { name: "Save audience revision" }).click();
    await page.getByRole("alert").waitFor();
    await screenshot("error");
    await page.getByRole("button", { name: "Retry read" }).click();
    await page
      .getByLabel("Audience definition")
      .fill(JSON.stringify(definition, null, 2));
    await page.getByRole("button", { name: "Save audience revision" }).click();
    await page.waitForTimeout(400);
    await screenshot("audience");
    // Headless writes and UI inspect the identical versioned backend.
    let data = await api("workspace", {});
    let campaign = data.campaigns.find(
      (c) => c.material.name === `QA desk kit ${width}`,
    );
    const from = new Date(Date.now() - 86400000);
    from.setUTCHours(5, 0, 0, 0);
    const until = new Date(from.getTime() + 7 * 86400000);
    campaign = await api("saveCampaign", {
      id: campaign.id,
      expectedRevision: campaign.revision,
      grantId: campaign.grantId,
      material: {
        ...campaign.material,
        startAt: from.toISOString(),
        endAt: until.toISOString(),
      },
    });
    await page.getByRole("button", { name: "Launch", exact: true }).click();
    await page.getByRole("button", { name: "Prepare paused objects" }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll("button")].some(
        (b) => b.textContent === "Create launch review" && !b.disabled,
      ),
    );
    await page.getByRole("button", { name: "Create launch review" }).click();
    await page
      .getByRole("heading", { name: "Review this exact commitment" })
      .waitFor();
    await screenshot("approval");
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: "Authorize launch", exact: true })
      .click();
    await page.getByRole("button", { name: "Execute fixture launch" }).click();
    await page
      .getByText("Activation intent: enabled. Actual delivery: unverified.", {
        exact: true,
      })
      .waitFor();
    const at = new Date(Date.now() - 1000).toISOString();
    await page
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await page.getByRole("button", { name: "Load conversations" }).click();
    await page
      .getByText(
        "No permissioned conversations are linked to this campaign yet.",
        { exact: true },
      )
      .waitFor();
    await screenshot("empty");
    const eventBase = {
      personId: `person-${width}`,
      campaignId: campaign.id,
      occurredAt: at,
      consentReceipt: `fixture-consent-${width}`,
      revenue: null,
    };
    await api("event", {
      ...eventBase,
      id: `click-${width}`,
      kind: "click",
      sourceReceipt: `fixture-click-source-${width}`,
      clickId: null,
    });
    const form = {
      ...eventBase,
      id: `form-${width}`,
      kind: "form_completed",
      sourceReceipt: `fixture-completed-form-${width}`,
      clickId: `click-${width}`,
    };
    await api("event", form);
    await api("event", form);
    await api("conversation", {
      id: `thread-${width}`,
      campaignId: campaign.id,
      leadEventId: `form-${width}`,
      consentReceipt: eventBase.consentReceipt,
      messages: [
        {
          speaker: "Fixture customer",
          text: "Will the kit fit on my desk?",
          at,
        },
      ],
    });
    await page
      .getByRole("button", { name: "Conversations", exact: true })
      .click();
    await page.getByRole("button", { name: "Load conversations" }).click();
    await page
      .getByText("Will the kit fit on my desk?", { exact: true })
      .waitFor();
    await screenshot("conversations");
    await page.getByRole("button", { name: "Results", exact: true }).click();
    await page.getByRole("button", { name: "Read results" }).click();
    await page.getByText("collector coverage unknown", { exact: true }).count();
    await page.getByRole("button", { name: "Sync provider metrics" }).click();
    await page.getByText("4.00%", { exact: true }).waitFor();
    await screenshot("results");
    const reportData = await api("results", {
      campaignId: campaign.id,
      from: campaign.material.startAt,
      until: campaign.material.endAt,
    });
    assert.equal(reportData.leads.value, 1);
    assert.equal(reportData.qualified.value, 0);
    assert.equal(await page.getByRole("alert").count(), 0);
    report.viewports.push({
      width,
      passed: true,
      paths: [
        "login",
        "loading",
        "workspace",
        "connect",
        "human takeover",
        "resume",
        "image",
        "playable video",
        "storyboard",
        "audience revision",
        "validation error and read retry",
        "empty conversations",
        "paused prepare",
        "human gate",
        "fixture launch",
        "first-party event dedupe",
        "conversations",
        "results",
      ],
      overflow: false,
    });
    await context.close();
  }
  assert.deepEqual(report.errors, []);
} catch (error) {
  report.failure = String(error.stack || error);
  throw error;
} finally {
  await writeFile(
    join(evidence, "browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  await app.idle();
  await new Promise((r) => app.server.close(r));
  await store.close();
  await rm(dir, { recursive: true, force: true });
}
console.log(JSON.stringify(report, null, 2));
