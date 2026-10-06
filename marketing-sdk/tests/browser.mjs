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
for (const provider of ["meta", "linkedin"]) {
  const g = await store.get("qa-alpha", "grant", `${provider}-qa`);
  g.selectionOptions = [{ kind: provider === "meta" ? "page" : "organization", id: "987654", label: "Fixture organization with a deliberately long international regional marketing identity label" }];
  g.targetingOptions = [ ...(g.targetingOptions || []), ...(provider === "meta" ? [{ kind: "locations", id: "US", label: "United States — fixture country catalog" }] : []),
    ...Array.from({ length: 125 }, (_, i) => ({ kind: provider === "meta" ? "interests" : "titles", id: provider === "meta" ? String(i + 1) : `urn:li:title:${i + 1}`, label: `Fixture specialty ${String(i + 1).padStart(3, "0")} — 国際採用 équipe professionnelle — مهارات دولية — 👩🏽‍💻 deliberately long readable label` })) ];
  await store.put("qa-alpha", "grant", g.id, g);
}
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
    const screenshot = async (name, fullPage = true) => {
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
        fullPage,
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
    {
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
      // The project caption is intentionally hidden on mobile; verify the
      // loaded workspace identity, independently of the responsive caption.
      await page.locator(".project-label").filter({ hasText: "Isolation · QA Beta" }).waitFor({ state: "attached" });
      assert.equal(await page.locator(".session-bar select").inputValue(), "qa-beta");
      await page.locator(".session-bar select").selectOption("qa-alpha");
      await page.getByLabel("Campaign name", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "");
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
    const localDraft = page.getByRole("region", { name: "Unconnected drafts" });
    const draftCard = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Unconnected draft", exact: true }) });
    await draftCard.getByLabel("Draft name", { exact: true }).fill(`Local plan ${width}`);
    await draftCard.getByRole("button", { name: "Save local draft", exact: true }).dblclick();
    await page.getByRole("heading", { name: `Local plan ${width}`, exact: true }).waitFor();
    assert.equal((await api("workspace", {})).drafts.filter(d => d.material.name === `Local plan ${width}`).length, 1);
    const savedLocalCard = page.locator("section.card").filter({ has: page.getByRole("heading", { name: `Local plan ${width}`, exact: true }) });
    await savedLocalCard.getByRole("button", { name: "Review promotion to account", exact: true }).click();
    const incompletePromotion = page.locator("section.promotion");
    await incompletePromotion.getByRole("group", { name: "Promotion account", exact: true }).locator("summary").click();
    await incompletePromotion.getByRole("radio", { name: /meta · meta fixture account/ }).check();
    const selectedAccount = incompletePromotion.getByRole("group", { name: "Promotion account", exact: true }).getByLabel("Selected Promotion account", { exact: true });
    assert.match(await selectedAccount.innerText(), /meta · meta fixture account/);
    assert.doesNotMatch(await selectedAccount.innerText(), /Unresolved|Current catalog name/);
    assert.equal(await incompletePromotion.getByLabel("Lifetime media budget (USD)", { exact: true }).inputValue(), "");
    assert.equal(await incompletePromotion.getByLabel("Purpose", { exact: true }).inputValue(), "");
    await incompletePromotion.getByRole("button", { name: "Review planning campaign", exact: true }).click();
    assert.equal(await incompletePromotion.getByRole("button", { name: "Create planning campaign", exact: true }).isDisabled(), true);
    assert.match(await incompletePromotion.innerText(), /Complete or resolve before promotion/);
    await screenshot("promotion-missing-fields");
    await incompletePromotion.getByRole("button", { name: "Cancel promotion", exact: true }).click();
    const malformed = await api("saveDraft", { requestKey: `malformed-${width}`, material: { name: `Legacy malformed ${width}`, audience: { provider: "meta", expansion: false }, settings: { provider: "meta", targeting: { languages: null } } } });
    const malformedCard = page.locator("section.card").filter({ has: page.getByRole("heading", { name: malformed.material.name, exact: true }) });
    await malformedCard.getByRole("button", { name: "Review promotion to account", exact: true }).click();
    await incompletePromotion.getByRole("group", { name: "Promotion account", exact: true }).locator("summary").click();
    await incompletePromotion.getByRole("radio", { name: /meta · meta fixture account/ }).check();
    await incompletePromotion.getByRole("button", { name: "Reconstruct provider settings for review", exact: true }).click();
    assert.equal(await incompletePromotion.getByLabel("I acknowledge the nondiscrimination requirements.").isChecked(), false);
    assert.equal(await incompletePromotion.getByLabel("Lifetime media budget (USD)", { exact: true }).inputValue(), "");
    await screenshot("malformed-draft-reconstruction");
    await incompletePromotion.getByRole("button", { name: "Cancel promotion", exact: true }).click();
    assert.deepEqual((await api("workspace", {})).drafts.find(d => d.id === malformed.id), malformed);
    void localDraft;
    await page.getByLabel("Campaign name", { exact: true }).fill("Account-specific abandoned material");
    await page.getByLabel("Account", { exact: true }).selectOption("linkedin-qa");
    await page.getByText("Current objective: WEBSITE_VISIT", { exact: false }).waitFor();
    assert.match(await page.locator("form").innerText(), /Current objective: WEBSITE_VISIT/);
    assert.equal(await page.getByLabel("Manual bid (USD)", { exact: true }).inputValue(), "");
    assert.equal(await page.getByRole("button", { name: "Save campaign draft" }).isDisabled(), true);
    await page.getByLabel("Campaign name", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(await page.getByLabel("Purpose", { exact: true }).evaluate(e => e === document.activeElement), true);
    await page.getByLabel("Manual bid (USD)", { exact: true }).fill("1.25");
    const liTuple = page.getByRole("group", { name: "Objective, optimization and bid", exact: true });
    await liTuple.locator("summary").click();
    await liTuple.getByRole("radio", { name: /Website visits · Maximize clicks · auto CPM/ }).check();
    await liTuple.getByRole("radio", { name: /Website visits · Manual click bid · manual CPC/ }).check();
    assert.equal(await page.getByLabel("Manual bid (USD)", { exact: true }).inputValue(), "1.25");
    await page.getByLabel("Purpose", { exact: true }).selectOption("recruitment");
    assert.match(await liTuple.innerText(), /Incompatible with the selected purpose/);
    assert.equal(await page.getByLabel("I acknowledge the nondiscrimination requirements.").isChecked(), false);
    await page.getByLabel("Purpose", { exact: true }).selectOption("acquisition");
    await liTuple.locator("summary").click();
    await screenshot("linkedin-guided-editor");
    await page.getByLabel("Manual bid (USD)", { exact: true }).scrollIntoViewIfNeeded();
    await screenshot("linkedin-guided-controls", false);
    await page.getByLabel("End date (exclusive)", { exact: true }).scrollIntoViewIfNeeded();
    await screenshot("linkedin-guided-budget", false);
    await page.getByLabel("Account", { exact: true }).selectOption("meta-qa");
    assert.equal(await page.getByLabel("Campaign name", { exact: true }).inputValue(), "");
    assert.match(await page.locator("form").innerText(), /Current objective: OUTCOME_TRAFFIC/);
    const tuple = page.getByRole("group", { name: "Objective, optimization and bid", exact: true });
    await tuple.locator("summary").click();
    await tuple.getByRole("radio", { name: /Traffic · Reach · strict/ }).check();
    await page.getByRole("button", { name: "Add AND interest group", exact: true }).click();
    const interests = page.getByRole("group", { name: "Interest group 1 (OR)", exact: true });
    await interests.locator("summary").click();
    assert.equal(await interests.getByRole("checkbox").count(), 20);
    await interests.getByRole("button", { name: "Show more interest group 1 (or)", exact: true }).click();
    assert.equal(await interests.getByRole("checkbox").count(), 40);
    await interests.getByLabel("Search interest group 1 (or)", { exact: true }).fill("125");
    await interests.getByRole("checkbox").focus();
    await page.keyboard.press("Space");
    assert.equal(await interests.getByRole("checkbox").isChecked(), true);
    await interests.locator("summary").click();
    await interests.getByRole("button", { name: /Remove Fixture specialty 125/ }).focus();
    await page.keyboard.press("Enter");
    assert.equal(await interests.locator("summary").evaluate(e => e === document.activeElement), true);
    await page.keyboard.press("Enter");
    await interests.getByRole("checkbox").check();
    await interests.scrollIntoViewIfNeeded();
    await screenshot("searchable-long-selection", false);
    await page.route("**/workspace", async route => {
      const response = await route.fetch(), body = await response.json();
      for (const g of body.grants) if (g.id === "meta-qa") g.targetingOptions = g.targetingOptions.filter(x => x.kind !== "interests");
      await route.fulfill({ response, json: body });
    });
    await interests.getByText("Unresolved in this account catalog", { exact: true }).waitFor();
    assert.match(await interests.innerText(), /125/);
    await screenshot("retained-unavailable-selection", false);
    await page.unroute("**/workspace");
    await interests.getByRole("checkbox").waitFor();
    await tuple.getByRole("radio", { name: /Traffic · Link clicks · ordinary/ }).check();
    assert.match(await page.locator("form").innerText(), /ordinary traffic not strict/);
    assert.equal(await interests.getByRole("checkbox").isChecked(), true); // No silent broadening.
    await page.getByRole("button", { name: "Remove interest group 1", exact: true }).click();
    await tuple.locator("summary").click();
    const languages = page.getByRole("group", { name: "Languages", exact: true });
    await languages.locator("summary").click();
    assert.match(await languages.innerText(), /No resolved choices supplied/);
    await languages.scrollIntoViewIfNeeded();
    await screenshot("missing-catalog", false);
    await languages.locator("summary").click();
    await screenshot("workspace");
    const scheduleNow = new Date("2026-09-27T03:50:00Z");
    campaignNow = scheduleNow.getTime();
    await page.clock.setFixedTime(scheduleNow);
    assert.match(await page.locator("form").innerText(), /tomorrow in America\/Chicago for seven calendar days/);
    await page
      .getByLabel("Campaign name", { exact: true })
      .fill(`QA desk kit ${width}`);
    await page.getByLabel("Headline", { exact: true }).fill("A little room to think");
    await page.getByLabel("Copy", { exact: true }).fill("Explore a calmer workspace.");
    await page.getByLabel("Destination URL", { exact: true }).fill("https://fieldwork.example/desk-kit");
    await page.getByLabel("Lifetime media budget (USD)", { exact: true }).fill("42");
    await page.getByText("Manual location identifiers", { exact: true }).click();
    await page.getByLabel("Locations", { exact: true }).fill("US");
    await page.getByLabel("Minimum age", { exact: true }).fill("25");
    await page.getByLabel("Maximum age", { exact: true }).fill("54");
    await page.getByText("Exact UTC instants", { exact: true }).click();
    await page.getByLabel("Daily media budget (USD)", { exact: false }).fill("5");
    const requestedSchedule = defaultCampaignSchedule("America/Chicago", scheduleNow);
    await page.getByLabel("Start (UTC)", { exact: true }).fill(requestedSchedule.startAt);
    await page.getByLabel("End (UTC, exclusive)", { exact: true }).fill(requestedSchedule.endAt);
    await page.getByLabel("I acknowledge the nondiscrimination requirements.").check();
    let captureRoute;
    const capturePending = new Promise(resolve => { captureRoute = resolve; });
    await page.route("**/captureDestination", route => captureRoute(route));
    await page.getByRole("button", { name: "Save campaign draft" }).click();
    const heldCapture = await capturePending;
    assert.equal(await page.getByLabel("Account", { exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "Save campaign draft" }).isDisabled(), true);
    await page.unroute("**/captureDestination");
    let loseSave = true;
    await page.route("**/planningWrite", async route => {
      if (!loseSave) return route.continue();
      loseSave = false;
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 200, await accepted.text());
      await route.fulfill({ status: 408, contentType: "application/json", body: JSON.stringify({ error: "fixture_save_response_lost" }) });
    });
    await heldCapture.continue();
    await page.getByRole("alert").filter({ hasText: "fixture save response lost" }).waitFor();
    await page.getByLabel("Campaign name", { exact: true }).fill(`Changed after uncertain result ${width}`);
    await page.getByRole("button", { name: "Save campaign draft" }).click();
    await page.getByRole("alert").filter({ hasText: "unresolved planning write" }).waitFor();
    assert.equal((await api("workspace", {})).campaigns.filter(c => c.material.name === `Changed after uncertain result ${width}`).length, 0);
    await page.getByLabel("Campaign name", { exact: true }).fill(`QA desk kit ${width}`);
    // A new key cannot replace the original intent: resolve the retained result
    // after reload, then open its connection workflow without creating again.
    await page.reload();
    await page.getByRole("heading", { name: "Review saved planning result", exact: true }).waitFor();
    await screenshot("uncertain-create-reload");
    await page.getByRole("button", { name: "Open saved campaign", exact: true }).click();
    await page.getByRole("button", { name: "Acknowledge saved planning result", exact: true }).click();
    await page.getByRole("heading", { name: "Review saved planning result", exact: true }).waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Connections", exact: true }).click();
    await page
      .getByRole("heading", { name: "Connections", exact: true })
      .waitFor();
    await page.unroute("**/planningWrite");
    assert.equal((await api("workspace", {})).campaigns.filter(c => c.material.name === `QA desk kit ${width}`).length, 1);
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
    await page.getByLabel("Creative brief", { exact: true }).fill("Fixture test pattern for browser validation");
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
    const audienceCard = page.locator("section.card").filter({ has: page.getByRole("heading", { name: "Who can see this campaign?", exact: true }) });
    await audienceCard.getByLabel("Minimum age", { exact: true }).fill("17");
    await page.getByRole("button", { name: "Save audience revision" }).click();
    await page.getByRole("alert").waitFor();
    await screenshot("error");
    const mutationError = await page.getByRole("alert").innerText();
    await page.waitForTimeout(1700);
    assert.equal(await page.getByRole("alert").innerText(), mutationError);
    read = failRead;
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor();
    read = passRead;
    await page.getByRole("button", { name: "Retry read" }).click();
    await page.getByRole("alert").filter({ hasText: "fixture read failure" }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("alert").innerText(), mutationError);
    await audienceCard.getByLabel("Minimum age", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Save audience revision" }).click();
    await page.waitForTimeout(400);
    const editor = page.locator("details").filter({ has: page.getByText("Edit complete campaign material", { exact: true }) });
    await editor.locator(":scope > summary").click();
    await editor.getByLabel("Headline", { exact: true }).fill("Cancelled headline");
    await editor.getByRole("button", { name: "Review changes", exact: true }).click();
    await editor.getByRole("button", { name: "Back to editing", exact: true }).click();
    assert.equal(await editor.getByLabel("Headline", { exact: true }).inputValue(), "Cancelled headline");
    await editor.getByRole("button", { name: "Cancel changes", exact: true }).click();
    assert.equal(await editor.getByLabel("Headline", { exact: true }).inputValue(), "A little room to think");
    await editor.getByLabel("Headline", { exact: true }).fill("Reviewed headline");
    await editor.getByRole("button", { name: "Review changes", exact: true }).click();
    await screenshot("guided-material-review");
    await editor.getByRole("button", { name: "Save material revision", exact: true }).dblclick();
    await page.waitForTimeout(400);
    await screenshot("audience");
    // Headless writes and UI inspect the identical versioned backend.
    let data = await api("workspace", {});
    let campaign = data.campaigns.find(
      (c) => c.material.name === `QA desk kit ${width}`,
    );
    // Inspect the unmodified default schedule in the persisted approval packet.
    await page.getByRole("button", { name: "Launch", exact: true }).click();
    // Read-only live-mode projection proves the UI daily denial; all backing
    // services remain disposable fixtures and no provider action is authorized.
    await page.route("**/workspace", async route => {
      const response = await route.fetch(), body = await response.json();
      await route.fulfill({ response, json: { ...body, mode: "live" } });
    });
    await page.getByText("meta daily budget semantics unverified", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Prepare paused objects" }).isDisabled(), true);
    await screenshot("meta-daily-live-denial");
    await page.unroute("**/workspace");
    await page.waitForFunction(() => [...document.querySelectorAll("button")].some(
      b => b.textContent === "Prepare paused objects" && !b.disabled,
    ));
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
    assert.equal(await page.getByRole("heading", { name: "Completed MOU requests", exact: true }).count(), 0);
    await page.getByLabel("Reporting window", { exact: true }).selectOption("custom");
    await page.getByRole("button", { name: "Use all completed days", exact: true }).click();
    assert.equal(await page.getByRole("button", { name: "Read results", exact: true }).isDisabled(), false);
    await screenshot("completed-day-picker");
    await page.getByLabel("Report end date (exclusive)", { exact: true }).fill("2099-01-01");
    assert.equal(await page.getByRole("button", { name: "Sync provider metrics", exact: true }).isDisabled(), true);
    await page.getByLabel("Reporting window", { exact: true }).selectOption("completed");
    let captureResults;
    const pendingResults = new Promise(resolve => { captureResults = resolve; });
    await page.route("**/results", route => captureResults(route));
    await page.getByRole("button", { name: "Read results" }).click();
    const heldResults = await pendingResults;
    await page.getByLabel("Reporting window", { exact: true }).selectOption("campaign");
    await page.unroute("**/results");
    await heldResults.continue();
    await page.getByRole("button", { name: "Read results" }).waitFor();
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].find(b => b.textContent === "Read results")?.disabled);
    assert.equal(await page.getByRole("heading", { name: "Completed MOU requests", exact: true }).count(), 0);
    await screenshot("late-results-discarded");
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
    // Two actual browser clients promote the same saved revision/account. One
    // loses the successful response; the durable binding must still return one campaign.
    const source = await api("saveDraft", { requestKey: `promotion-source-${width}`, material: {
      ...campaign.material, name: `Promoted local plan ${width}`, assetIds: [], destinationDigest: "",
    } });
    const originalSource = JSON.stringify(source);
    await page.getByRole("button", { name: "Workspace", exact: true }).click();
    const otherPage = await context.newPage();
    await otherPage.goto(base);
    await otherPage.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
    const openPromotion = async (p, selectedSource = source) => {
      const card = p.locator("section.card").filter({ has: p.getByRole("heading", { name: selectedSource.material.name, exact: true }) });
      await card.getByRole("button", { name: "Review promotion to account", exact: true }).click();
      await p.getByRole("button", { name: "Cancel promotion", exact: true }).click();
      assert.equal(await card.getByRole("button", { name: "Review promotion to account", exact: true }).evaluate(e => e === document.activeElement), true);
      await card.getByRole("button", { name: "Review promotion to account", exact: true }).click();
      const panel = p.locator("section.promotion");
      await panel.getByRole("group", { name: "Promotion account", exact: true }).locator("summary").click();
      await panel.getByRole("radio", { name: /meta · meta fixture account/ }).check();
      await panel.getByRole("button", { name: "Review planning campaign", exact: true }).click();
      await panel.getByRole("button", { name: "Back to promotion editing", exact: true }).click();
      assert.equal(await panel.getByLabel("Campaign name", { exact: true }).inputValue(), selectedSource.material.name);
      await panel.getByRole("button", { name: "Review planning campaign", exact: true }).click();
      return panel;
    };
    const panel = await openPromotion(page), otherPanel = await openPromotion(otherPage);
    await screenshot("promotion-review");
    await panel.getByRole("heading", { name: "Review planning campaign", exact: true }).scrollIntoViewIfNeeded();
    await screenshot("promotion-review-detail", false);
    let releasePromotionCapture;
    const promotionCapture = new Promise(resolve => { releasePromotionCapture = resolve; });
    await page.route("**/captureDestination", route => releasePromotionCapture(route));
    let unexpectedPromotion = 0;
    await page.route("**/planningWrite", route => { unexpectedPromotion++; return route.continue(); });
    await panel.getByRole("button", { name: "Create planning campaign", exact: true }).click();
    const abandonedCapture = await promotionCapture;
    await panel.getByRole("button", { name: "Cancel promotion", exact: true }).click();
    await page.unroute("**/captureDestination");
    await abandonedCapture.continue();
    await page.waitForTimeout(150);
    assert.equal(unexpectedPromotion, 0);
    await page.unroute("**/planningWrite");
    await openPromotion(page);
    let lostPromotion = true;
    await page.route("**/planningWrite", async route => {
      if (!lostPromotion) return route.continue();
      lostPromotion = false;
      const accepted = await route.fetch();
      assert.equal(accepted.status(), 200, await accepted.text());
      await route.fulfill({ status: 408, contentType: "application/json", body: JSON.stringify({ error: "fixture_promotion_response_lost" }) });
    });
    await Promise.all([panel, otherPanel].map(p => p.getByRole("button", { name: "Create planning campaign", exact: true }).click()));
    await panel.getByRole("alert").waitFor();
    await otherPanel.waitFor({ state: "detached" });
    await screenshot("promotion-lost-response");
    await panel.getByRole("button", { name: "Create planning campaign", exact: true }).click();
    await panel.waitFor({ state: "detached" });
    await page.unroute("**/planningWrite");
    await page.reload();
    await page.getByRole("button", { name: "Open planning campaign", exact: true }).last().waitFor();
    const promotedWorkspace = await api("workspace", {});
    assert.equal(promotedWorkspace.campaigns.filter(c => c.draftOrigin?.draftId === source.id).length, 1);
    assert.equal(JSON.stringify(promotedWorkspace.drafts.find(d => d.id === source.id)), originalSource);
    const promoted = promotedWorkspace.campaigns.find(c => c.draftOrigin?.draftId === source.id);
    assert.equal(promoted.state, "draft"); assert.equal(promoted.receipt, null);
    assert.equal(promotedWorkspace.operations.filter(o => o.campaignId === promoted.id).length, 0);
    await screenshot("promotion-reload-recovery");
    await otherPage.close();
    // Cancellation after commit but before HTTP delivery must retain the result,
    // without a late navigation, acknowledgment or second planning campaign.
    const lateSource = await api("saveDraft", { requestKey: `late-source-${width}`, material: { ...source.material, name: `Late response plan ${width}` } });
    const latePanel = await openPromotion(page, lateSource);
    let committed, release;
    const savedBeforeResponse = new Promise(r => { committed = r; });
    const delayedResponse = new Promise(r => { release = r; });
    await page.route("**/planningWrite", async route => {
      const response = await route.fetch(); assert.equal(response.status(), 200, await response.text());
      committed(); await delayedResponse; await route.fulfill({ response });
    });
    await latePanel.getByRole("button", { name: "Create planning campaign", exact: true }).click();
    await savedBeforeResponse;
    await latePanel.getByRole("button", { name: "Cancel promotion", exact: true }).click();
    release();
    await page.getByRole("heading", { name: "Review saved planning result", exact: true }).waitFor();
    await page.unroute("**/planningWrite");
    await page.reload();
    await page.getByRole("heading", { name: "Review saved planning result", exact: true }).waitFor();
    await screenshot("canceled-promotion-retained-result");
    const lateWorkspace = await api("workspace", {});
    assert.equal(lateWorkspace.planningWrites.length, 1);
    assert.equal(lateWorkspace.campaigns.filter(c => c.draftOrigin?.draftId === lateSource.id).length, 1);
    await page.getByRole("button", { name: "Acknowledge saved planning result", exact: true }).click();
    await page.getByRole("heading", { name: "Review saved planning result", exact: true }).waitFor({ state: "detached" });
    if (width === 1440) {
      const sessionSource = await api("saveDraft", { requestKey: "session-switch-source", material: { ...source.material, name: "Session replacement review" } });
      const sessionPanel = await openPromotion(page, sessionSource);
      const priorWorkspace = await api("workspace", {});
      // Hold the old workspace projection while another tab replaces the login.
      await page.route("**/workspace", route => route.fulfill({ json: priorWorkspace }));
      let capture;
      const pendingCapture = new Promise(r => { capture = r; });
      await page.route("**/captureDestination", route => capture(route));
      await sessionPanel.getByRole("button", { name: "Create planning campaign", exact: true }).click();
      const route = await pendingCapture;
      const relogin = await context.request.post(`${base}/api/login`, { headers: { origin: base }, data: { username: "qa-browser", password } });
      assert.equal(relogin.status(), 200, await relogin.text());
      await page.unroute("**/captureDestination"); await route.continue();
      await sessionPanel.getByRole("alert").filter({ hasText: "planning session changed" }).waitFor();
      assert.equal((await api("workspace", {})).campaigns.filter(c => c.draftOrigin?.draftId === sessionSource.id).length, 0);
      await screenshot("session-replacement-denied");
      await page.unroute("**/workspace");
      await sessionPanel.getByRole("button", { name: "Cancel promotion", exact: true }).click();
      await page.reload();
      await page.getByRole("heading", { name: "Workspace", exact: true }).waitFor();
    }
    const recruitmentMaterial = { ...promoted.material, purpose: "recruitment", applicantGoal: { event: "ApplicantRequestMOU", meaning: "completed_mou_request" }, name: `Recruitment result fixture ${width}`,
      audience: { provider: "meta", locations: ["US"], ageMin: 18, ageMax: 65, expansion: false },
      settings: { ...promoted.material.settings, objective: "OUTCOME_LEADS", optimization: "OFFSITE_CONVERSIONS", delivery: "employment", specialAdCategory: "EMPLOYMENT", specialAdCategoryCountry: "US", conversion: { pixelId: "1", customConversionId: "2", event: "ApplicantRequestMOU" } } };
    const recruitment = await api("saveCampaign", { grantId: "meta-qa", material: recruitmentMaterial });
    await page.getByLabel("Campaign", { exact: true }).selectOption(recruitment.id);
    await page.getByRole("button", { name: "Creative", exact: true }).click();
    assert.equal(await page.getByLabel("Creative brief", { exact: true }).inputValue(), "");
    assert.equal(await page.getByLabel("Rights / approved source receipt", { exact: true }).inputValue(), "");
    await page.getByRole("button", { name: "Results", exact: true }).click();
    await page.getByLabel("Reporting window", { exact: true }).selectOption("campaign");
    await page.getByRole("button", { name: "Read results", exact: true }).click();
    await page.getByRole("heading", { name: "Completed MOU requests", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Completed submissions", exact: true }).count(), 0);
    assert.equal(await page.getByRole("heading", { name: "Revenue (minor)", exact: true }).count(), 0);
    await screenshot("recruitment-results");

    report.viewports.push({
      width,
      passed: true,
      paths: [
        "two-browser promotion race, lost response retry and reload recovery",
        "changed campaign-create form after uncertain result blocked; retained result reopened after reload",
        "malformed legacy draft explicitly reconstructed without source mutation or consent",
        "removed catalog retains Unicode selection and identifier",
        "cancel after committed promotion before delayed response retains unresolved result across reload",
        ...(width === 1440 ? ["replacement valid login during destination capture rejects old planning session scope"] : []),
        "search, pagination, long selected labels, keyboard checkbox and missing catalogs",
        "incompatible tuple preserves interest targeting",
        "custom completed-day picker with invalid date rejection",
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
        "guided Back/Cancel and repeated material save",
        "unconnected draft repeated save and rendering",
        "cross-account form reset and readiness blockers",
        "keyboard Tab from campaign name to purpose",
        "lost campaign-save response retried with one durable campaign",
        "complete guided material review and 320px LinkedIn controls",
        "late results discarded after reporting-window switch",
        "validation error and read retry",
        "initial retry and continued read failure",
        "polling recovery preserves mutation errors",
        "account-local default schedule matches persisted approval",
        "out-of-order read completion", "client/project replacement", "unmount with pending read",
        "account switching fenced during a delayed destination response",
        "empty conversations",
        "paused prepare",
        "live-mode Meta daily preparation denied in read-only workspace projection",
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
