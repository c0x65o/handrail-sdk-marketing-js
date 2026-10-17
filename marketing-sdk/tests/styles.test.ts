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


test('material review shows only selected campaign artwork and explicitly reports missing selected media',async()=>{
  const {MaterialReview}=await import('../react/index.js');
  const {promotionMaterial}=await import('../react/guided.js');
  const grant={id:'g',projectId:'p',revision:1,provider:'meta' as const,accountId:'act_123',label:'Fixture',currency:'USD',timezone:'UTC',permissions:[],expiresAt:'2099-01-01T00:00:00Z',revokedAt:null};
  const draft={id:'d',projectId:'p',revision:1,state:'draft' as const,connection:'unconnected' as const,grantId:null,receipt:null,
    material:{name:'Artwork review',budget:null,endAt:null,advertisingBudget:{daily:{currency:'USD',minor:500}},audience:{provider:'meta' as const}}};
  const material={...promotionMaterial(draft,grant),assetIds:['selected']};
  const asset=(id:string):import('../core/index.js').Asset=>({id,projectId:'p',campaignId:'c',version:1,kind:'image',digest:'a'.repeat(64),mime:'image/png',width:320,height:180,seconds:null,source:'uploaded',rightsReceipt:'Fixture rights',jobId:null,parentAssetIds:[]});
  const assets=[asset('previous'),asset('selected')],client={...createMarketingClient('','p'),assetUrl:(id:string)=>`/media/${id}`};
  const html=renderToStaticMarkup(createElement(MaterialReview,{material,assets,client}));
  assert.match(html,/src="\/media\/selected"/);assert.doesNotMatch(html,/\/media\/previous/);
  const absent=renderToStaticMarkup(createElement(MaterialReview,{material:{...material,assetIds:['missing']},assets,client}));
  assert.match(absent,/Selected artwork is unavailable/);assert.doesNotMatch(absent,/<img/);
  const unselected=renderToStaticMarkup(createElement(MaterialReview,{material:{...material,assetIds:[]},assets,client}));
  assert.doesNotMatch(unselected,/<img|Selected artwork is unavailable/);
});

test('shared campaign artwork picker distinguishes selected, eligible and unavailable image actions',async()=>{
  const {CampaignMedia}=await import('../react/index.js');
  const asset=(id:string,rightsReceipt='Fixture rights'):import('../core/index.js').Asset=>({id,projectId:'p',campaignId:'c',version:1,kind:'image',digest:'a'.repeat(64),mime:'image/png',width:320,height:180,seconds:null,source:'uploaded',rightsReceipt,jobId:null,parentAssetIds:[]});
  const props={assets:[asset('selected'),asset('next'),asset('no-rights','')],assetIds:['selected'],client:createMarketingClient('','p'),onSelect:()=>{}};
  const html=renderToStaticMarkup(createElement(CampaignMedia,props));
  assert.match(html,/Selected for campaign/);assert.equal((html.match(/disabled=""/g)||[]).length,2);
  const locked=renderToStaticMarkup(createElement(CampaignMedia,{...props,disabled:true}));
  assert.equal((locked.match(/disabled=""/g)||[]).length,3);
  const unsupported=renderToStaticMarkup(createElement(CampaignMedia,{...props,selectionUnavailable:'Image replacement is unavailable for this existing LinkedIn creative.'}));
  assert.equal((unsupported.match(/disabled=""/g)||[]).length,3);assert.match(unsupported,/Image replacement is unavailable/);
});
