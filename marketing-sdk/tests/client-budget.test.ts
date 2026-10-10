import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketingClient,MarketingRequestError} from '../core/index.js';
test('429 exposes bounded host retry guidance without replaying a command or changing its intent',async()=>{
  const bodies:string[]=[];let denied=true;
  const client=createMarketingClient('https://host.test','p',async(_url,init)=>{bodies.push(String(init?.body));return denied?Response.json({error:'shared_rate_limit'},{status:429,headers:{'retry-after':'12'}}):Response.json({id:'original-operation'});});
  const intent={campaignId:'c',requestKey:'original-request'};
  await assert.rejects(client.call('prepare',intent),error=>{assert.ok(error instanceof MarketingRequestError);assert.equal(error.status,429);assert.equal(error.code,'shared_rate_limit');assert.equal(error.retryAfterSeconds,12);assert.match(error.message,/Retry the original action after 12 seconds/);return true;});
  assert.equal(bodies.length,1);denied=false;await client.call('prepare',intent);assert.equal(bodies[0],bodies[1]);
});
test('invalid retry-after does not invent an automatic replay time',async()=>{
  for(const value of ['invalid','-1','9007199254740992']){
    const client=createMarketingClient('https://host.test','p',async()=>Response.json({error:'limit'},{status:429,headers:{'retry-after':value}}));
    await assert.rejects(client.call('workspace',{}),error=>{assert.ok(error instanceof MarketingRequestError);assert.equal(error.retryAfterSeconds,null);assert.match(error.message,/Wait before retrying/);return true;});
  }
});
