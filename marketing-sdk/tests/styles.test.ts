import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRequire } from "node:module";
import { MarketingRoot, MarketingWorkspace } from "../react/index.js";
import { createMarketingClient } from "../core/index.js";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup: (element: ReturnType<typeof createElement>) => string;
};

test("workspace initial loading renders inside the optional styling boundary", () => {
  const html = renderToStaticMarkup(createElement(MarketingWorkspace, { client: createMarketingClient("", "unconnected") }));
  assert.match(html, /^<div class="marketing-root"><main class="loading">/);
  assert.match(html, /role="status"/);
});

test("standalone host session/panel boundary preserves host attributes and children", () => {
  const html = renderToStaticMarkup(createElement(MarketingRoot, {
    className: "host-marketing-slot", "aria-label": "Marketing", children: createElement("p", { role: "alert" }, "Session error"),
  }));
  assert.match(html, /class="marketing-root host-marketing-slot"/);
  assert.match(html, /aria-label="Marketing"/);
  assert.match(html, /<p role="alert">Session error<\/p>/);
});
