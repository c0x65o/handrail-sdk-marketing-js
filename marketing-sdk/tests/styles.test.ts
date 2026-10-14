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

test('daily-only review and draft promotion preserve absence instead of displaying zero lifetime spend',async()=>{
  const {MaterialReview}=await import('../react/index.js');
  const {promotionMaterial}=await import('../react/guided.js');
  const grant={id:'g',projectId:'p',revision:1,provider:'meta' as const,accountId:'act_123',label:'Fixture',currency:'USD',timezone:'UTC',permissions:[],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null};
  const draft={id:'d',projectId:'p',revision:1,state:'draft' as const,connection:'unconnected' as const,grantId:null,receipt:null,
    material:{name:'Original terms',budget:null,endAt:null,advertisingBudget:{daily:{currency:'USD',minor:500}},audience:{provider:'meta' as const}}};
  const material=promotionMaterial(draft,grant);
  assert.equal(material.budget,null);assert.equal(material.endAt,null);
  const html=renderToStaticMarkup(createElement(MaterialReview,{material,assets:[],client:createMarketingClient('','p')}));
  assert.match(html,/No lifetime cap configured/);assert.match(html,/No end date/);assert.match(html,/5\.00/);
});
