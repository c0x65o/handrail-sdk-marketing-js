import type { TextPlanningConnection } from '@handrail/marketing';
import { CreativeConnections, createNativeTextPlanning, createTextPlanningAccess, MarketingServer, type Store, type SessionAuthority, type EncryptedCredentialCustody, type CreativeAccessPolicy, type TextPurposePermission, type TextPlanningBilling, type Principal } from '@handrail/marketing/server';
/** Existing host authority/custody/billing only. Mount SDK routes before the
 * ordinary JSON command route; never enable request-body logging on private entry.
 * Agent is absent. No actual permission or provider configuration is created. */
export function textPlanningServer(host:{
  store:Store; sessions:SessionAuthority; custody:EncryptedCredentialCustody; environment:string;
  setupPolicy(p:Principal,project:string,provider:'openai'|'xai'):Promise<CreativeAccessPolicy|null>;
  textPermission(p:Principal,project:string,binding:Awaited<ReturnType<CreativeConnections['textBinding']>>):Promise<TextPurposePermission|null>;
  withTextPermission<T>(expected:TextPlanningConnection,local:()=>Promise<T>):Promise<T>;
  billing:TextPlanningBilling;
}) {
  const connections=new CreativeConnections({store:host.store,custody:host.custody,environment:host.environment,purpose:'text',sessionAuthority:host.sessions,accessPolicy:host.setupPolicy});
  const planning=createNativeTextPlanning({store:host.store,custody:host.custody,sessions:host.sessions,environment:host.environment,connections,access:createTextPlanningAccess(connections,{inspect:host.textPermission,withCurrent:host.withTextPermission}),billing:host.billing});
  const server=MarketingServer.unconnected(host.store,{studio:{sessions:host.sessions,textPlanning:planning}});
  return {server,connections,
    // The existing sole executor calls this after approveTextPlan acknowledgment.
    // Do not schedule/retry an unknown operation. Reopening UI reads saved status.
    dispatch:(project:string,requestId:string,signal?:AbortSignal)=>server.studio.dispatchPlanning(project,requestId,signal)};
}
