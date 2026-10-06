import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { createRequire } from "node:module";
const { renderToStaticMarkup } = createRequire(import.meta.url)("react-dom/server") as {
  renderToStaticMarkup: (element: ReturnType<typeof createElement>) => string;
};
import { ChoicePicker } from "../react/choices.js";

test("choice labels retain Unicode, distinguish same-name IDs and never silently rename saved selections", () => {
  const label = "採用 équipe — مهارات دولية — 👩🏽‍💻";
  const html = renderToStaticMarkup(createElement(ChoicePicker, { label: "Titles",
    options: [{ id: "one", label }, { id: "two", label }, { id: "saved", label: "Renamed" }],
    selected: [{ id: "saved", label: "Original saved name" }, { id: "missing", label: "Unknown retained" }], onChange: () => {} }));
  assert.ok(html.includes(label));
  for (const text of ["<small>one</small>", "<small>two</small>", "Original saved name", "Unknown retained", "Current catalog name: Renamed", "Remove and select again to confirm", "Unresolved in this account catalog"])
    assert.ok(html.includes(text), text);
  assert.ok(html.includes('type="search"'));
  assert.ok(html.includes("<legend>Titles</legend>"));
});
test("conflicting labels for one ID are unavailable; catalog limits remain explicit and bounded", () => {
  const html = renderToStaticMarkup(createElement(ChoicePicker, { label: "Titles",
    options: [{ id: "ambiguous", label: "A" }, { id: "ambiguous", label: "B" },
      ...Array.from({ length: 6000 }, (_, i) => ({ id: String(i), label: `Title ${i}` }))],
    selected: [{ id: "ambiguous", label: "Saved" }], onChange: () => {} }));
  assert.ok(html.includes("Conflicting names for the same identifier were withheld"));
  assert.ok(html.includes("Showing the first 5,000 supplied choices"));
  assert.equal((html.match(/type="checkbox"/g) || []).length, 20);
  assert.ok(html.includes("Unresolved in this account catalog"));
});
