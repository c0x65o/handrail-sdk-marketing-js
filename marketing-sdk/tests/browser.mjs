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
import { defaultCampaignSchedule } from "../../.marketing-build/react/schedule.js";
import { localDate } from "../../.marketing-build/server/reporting.js";
import { MarketingServer } from "../../.marketing-build/server/service.js";

const dir = await mkdtemp(join(tmpdir(), "marketing-browser-"));
const evidence = resolve(
  process.env.MARKETING_EVIDENCE_DIR || "artifacts/browser",
);
await mkdir(evidence, { recursive: true });
const password = randomBytes(32).toString("base64url");
const { store, service: fixtureService } = await runtime(
  {
    MARKETING_MODE: "fixture",
    MARKETING_PUBLIC_URL: "http://127.0.0.1",
  },
  await testStore(join(dir, "qa.sqlite")),
);
// Keep the historical rollover case valid even when this regression runs later.
// Session expiry still uses the real host/DB clock.
let campaignNow;
const service = new MarketingServer(
  store, fixtureService.providers, fixtureService.generation, fixtureService.agent,
  "fixture", () => campaignNow ?? Date.now(), fixtureService.readDestination,
);
await seedQa(store, { username: "qa-browser", password });
const budgetPolicy = { id: "browser-policy", projectId: "qa-alpha", scope: "project", projectIds: ["qa-alpha"], currency: "USD", timezone: "America/Chicago",
  from: "2020-01-01T06:00:00Z", until: "2100-01-01T06:00:00Z", dailyCeilingMinor: 100000, periodCeilingMinor: 100000,
  campaignDailyCeilingMinor: 10000, campaignLifetimeCeilingMinor: 10000, maxObservationAgeMs: 600000 };
await service.advertisingBudgets.configure(budgetPolicy);
await service.advertisingBudgets.observe("qa-alpha", { policyId: budgetPolicy.id, from: budgetPolicy.from, until: budgetPolicy.until,
  day: localDate(Date.now(), budgetPolicy.timezone), currency: budgetPolicy.currency, timezone: budgetPolicy.timezone,
  observedAt: new Date().toISOString(), todayMinor: 0, periodMinor: 0, source: "fixture", receipt: "disposable-complete-fixture" });
// Both projects belong to this disposable test principal; live seeds are untouched.
const user = await store.db.prepare("SELECT id FROM users WHERE login=?").get("qa-browser");
await store.db.prepare("INSERT INTO memberships VALUES(?,?,?)").run(user.id, "qa-beta", "analyst");
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
        timezoneId: "Asia/Tokyo", // Browser zone must not override the account zone.
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
    let reads = 0;
    const failRead = (route) => route.fulfill({
      status: 408, contentType: "application/json", body: JSON.stringify({ error: "fixture_read_failure" }),
    });
    const passRead = (route) => route.continue();
    let read = failRead;
    await page.route("**/api/projects/qa-alpha/workspace", async (route) => {
      await workspaceGate;
      reads++;
      await read(route);
    });
    await page.goto(base);
    await page.getByLabel("Username", { exact: true }).fill("qa-browser");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByText("Loading your project…", { exact: true }).waitFor();
    await screenshot("loading");
    releaseWorkspace();
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor();
    await screenshot("initial-read-failure");
    const firstReads = reads;
    await page.getByRole("button", { name: "Retry read" }).click();
    while (reads === firstReads) await page.waitForTimeout(20);
    assert.match(await page.getByRole("alert").innerText(), /fixture read failure/);
    // Keep the error visible while the retry is pending, then clear it on success.
    let pending;
    const retryPending = new Promise((resolve) => { pending = resolve; });
    read = async (route) => { pending(); await retryGate; await route.continue(); };
    let releaseRetry;
    const retryGate = new Promise((resolve) => { releaseRetry = resolve; });
    await page.getByRole("button", { name: "Retry read" }).click();
    await retryPending;
    assert.match(await page.getByRole("alert").innerText(), /fixture read failure/);
    read = passRead;
    releaseRetry();
    await page
      .getByRole("heading", { name: "Workspace", exact: true })
      .waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await screenshot("initial-retry-recovered");
    read = failRead;
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor();
    await screenshot("loaded-read-failure");
    read = passRead;
    await page.getByRole("alert").waitFor({ state: "detached" });
    await screenshot("polling-recovered");
    if (width === 1440) {
      const stale = await api("workspace", {});
      stale.project.name = "STALE RESPONSE MUST NOT RENDER";
      const holdNextRead = () => new Promise((resolve) => {
        read = (route) => { read = passRead; resolve(route); };
      });
      // Older failure after a newer success must not resurrect an error.
      const oldFailure = await holdNextRead();
      const newer = reads;
      while (reads === newer) await page.waitForTimeout(20);
      await page.waitForTimeout(100);
      await failRead(oldFailure);
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole("alert").count(), 0);
      // Older success after a newer failure must not hide the current failure.
      const oldSuccess = await holdNextRead();
      read = failRead;
      await page.getByRole("alert").waitFor();
      await oldSuccess.fulfill({ json: stale });
      await page.waitForTimeout(100);
      assert.equal(await page.getByText(stale.project.name, { exact: true }).count(), 0);
      assert.match(await page.getByRole("alert").innerText(), /fixture read failure/);
      read = passRead;
      await page.getByRole("button", { name: "Retry read" }).click();
      await page.getByRole("alert").waitFor({ state: "detached" });
      // Client changes without a caller key must clear old data and local drafts.
      await page.getByLabel("Campaign name", { exact: true }).fill("old project draft");
      const oldProject = await holdNextRead();
      let captureBeta;
      const betaPending = new Promise((resolve) => { captureBeta = resolve; });
      await page.route("**/api/projects/qa-beta/workspace", (route) => captureBeta(route));
      await page.locator(".session-bar select").selectOption("qa-beta");
      const betaRead = await betaPending;
      await page.getByText("Loading your project…", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Campaign name", { exact: true }).count(), 0);
      await oldProject.fulfill({ json: stale });
      await page.waitForTimeout(100);
      assert.equal(await page.getByText(stale.project.name, { exact: true }).count(), 0);
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.unroute("**/api/projects/qa-beta/workspace");
      await betaRead.continue();
      await page.getByText("Isolation · QA Beta", { exact: true }).last().waitFor();
      await page.locator(".session-bar select").selectOption("qa-alpha");
      await page.getByLabel("Campaign name", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "Autumn desk kit");
      const oldUnmount = await holdNextRead();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      await failRead(oldUnmount);
      await page.waitForTimeout(100);
      assert.equal(await page.getByRole("alert").count(), 0);
      await page.getByLabel("Username", { exact: true }).fill("qa-browser");
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.getByLabel("Campaign name", { exact: true }).waitFor();
    }
    await screenshot("workspace");
    const scheduleNow = new Date("2026-09-27T03:50:00Z");
    campaignNow = scheduleNow.getTime();
    await page.clock.setFixedTime(scheduleNow);
    assert.match(await page.locator("form").innerText(), /tomorrow in America\/Chicago for seven calendar days/);
    await page
      .getByLabel("Campaign name", { exact: true })
      .fill(`QA desk kit ${width}`);
    await page.getByLabel("Daily media budget (USD)", { exact: false }).fill("5");
    await page.getByRole("button", { name: "Save campaign draft" }).click();
    await page
      .getByRole("heading", { name: "Connections", exact: true })
      .waitFor();
    const saved = (await api("workspace", {})).campaigns.find((c) => c.material.name === `QA desk kit ${width}`);
    assert.deepEqual({ startAt: saved.material.startAt, endAt: saved.material.endAt }, defaultCampaignSchedule("America/Chicago", scheduleNow));
    assert.equal(saved.material.startAt, "2026-09-27T05:00:00.000Z");
    assert.deepEqual(saved.material.advertisingBudget, { lifetime: { currency: "USD", minor: 4200 }, daily: { currency: "USD", minor: 500 } });
    await page.clock.setFixedTime(new Date());
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
    // Workspace polls cannot dismiss an unrelated failed mutation.
    const mutationError = await page.getByRole("alert").innerText();
    await page.waitForTimeout(1700);
    assert.equal(await page.getByRole("alert").innerText(), mutationError);
    read = failRead;
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor();
    read = passRead;
    await page.getByRole("button", { name: "Retry read" }).click();
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert").innerText(), mutationError);
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
    // Inspect the unmodified default schedule in the persisted approval packet.
    await page.getByRole("button", { name: "Launch", exact: true }).click();
    await page.getByRole("button", { name: "Prepare paused objects" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "Create launch review" && !b.disabled,
    ));
    await page.getByRole("button", { name: "Create launch review" }).click();
    await page.getByRole("heading", { name: "Review this exact commitment" }).waitFor();
    const approval = page.getByRole("region", { name: "Launch approval" });
    assert.ok((await approval.innerText()).includes(`${saved.material.startAt} → ${saved.material.endAt}`));
    assert.match(await approval.innerText(), /Daily media budget[\s\S]*USD 5.00/);
    const scheduledPacket = (await api("workspace", {})).packets.find((p) => p.campaignId === campaign.id);
    assert.equal(scheduledPacket.material.startAt, saved.material.startAt);
    assert.equal(scheduledPacket.material.endAt, saved.material.endAt);
    await screenshot("default-schedule-approval");
    campaignNow = undefined;
    campaign = (await api("workspace", {})).campaigns.find((c) => c.id === campaign.id);
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
    const at = new Date(Date.parse(campaign.material.startAt) + 3600000).toISOString();
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
    await api("event", { ...form, id: `second-form-${width}`, sourceReceipt: `second-source-${width}` });
    await api("event", { ...eventBase, id: `qa-click-${width}`, kind: "click", sourceReceipt: `qa-click-source-${width}`, clickId: null, test: true });
    await api("event", { ...form, id: `qa-form-${width}`, sourceReceipt: `qa-source-${width}`, clickId: `qa-click-${width}`, test: true });
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
    await page.getByLabel("Reporting window", { exact: true }).selectOption("campaign");
    assert.equal(await page.getByRole("button", { name: "Sync provider metrics" }).isDisabled(), true);
    await page.getByRole("button", { name: "Read results" }).click();
    const submissionCard = page.locator("article.card").filter({ has: page.getByRole("heading", { name: "Completed submissions", exact: true }) });
    await submissionCard.getByText("2", { exact: true }).waitFor();
    await screenshot("full-window-results");
    await page.getByLabel("Reporting window", { exact: true }).selectOption("completed");
    await page.getByRole("button", { name: "Read results" }).click();
    await page.getByRole("button", { name: "Sync provider metrics" }).click();
    await page.getByText("4.00%", { exact: true }).waitFor();
    await screenshot("results");
    const reportData = await api("results", {
      campaignId: campaign.id,
      from: campaign.material.startAt,
      until: campaign.material.endAt,
    });
    assert.equal(reportData.leads.value, 1);
    assert.equal(reportData.completedSubmissions.value, 2);
    assert.equal(reportData.reportingBasis.window, "partial-or-open-window");
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
        "initial retry and continued read failure",
        "polling recovery preserves mutation errors",
        "account-local default schedule matches persisted approval",
        ...(width === 1440 ? ["out-of-order read completion", "client/project replacement", "unmount with pending read"] : []),
        "empty conversations",
        "paused prepare",
        "human gate",
        "fixture launch",
        "first-party event dedupe",
        "conversations",
        "typed daily and lifetime budgets in draft and approval",
        "completed-day selection and full-window sync disabled",
        "separate submissions, people and excluded QA",
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
