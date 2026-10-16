import type { Campaign, Packet } from '../core/index.js';
import type { ExecutionAuthority, HostActivationApproval } from './execution-authority.js';
import { digest, requireThat, type Principal, type Store } from './store.js';

export interface RetainedHostActivationApproval {
  id: string;
  projectId: string;
  campaignId: string;
  packetId: string;
  packetDigest: string;
  actorId: string;
  actorBinding: string;
  source: 'host_owner_authority';
  approval: HostActivationApproval;
  retainedAt: string;
}

export async function readHostActivationApproval(store: Store, projectId: string, packetId: string): Promise<RetainedHostActivationApproval | null> {
  const row = await store.db.prepare('SELECT body FROM records WHERE project_id=? AND kind=? AND id=?')
    .get(projectId, 'hostActivationApproval', packetId);
  return row ? JSON.parse(String(row.body)) as RetainedHostActivationApproval : null;
}

/** Trusted server composition only. Public commands cannot provide this port.
 * Local retention occurs inside the caller's host guard and SDK transaction;
 * the native receipt is checked again before every provider effect. */
export async function assertHostActivationApproval(store: Store, authority: ExecutionAuthority | undefined,
  principal: Principal, campaign: Campaign, packet: Packet, retain: boolean, now: () => number): Promise<boolean> {
  const prior = await readHostActivationApproval(store, campaign.projectId, packet.id);
  if (!authority?.activationApproval && !prior) return false;
  requireThat(authority?.activationApproval, 'host_activation_authority_required', 403);
  await authority.assertCurrent(principal, campaign, 'activate');
  const approval = structuredClone(await authority.activationApproval(principal, campaign, structuredClone(packet)));
  const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
  requireThat(approval && text(approval.authorityId) && text(approval.revision) && Array.isArray(approval.receiptReferences) &&
    approval.receiptReferences.length > 0 && approval.receiptReferences.length <= 100 && approval.receiptReferences.every(text),
  'host_activation_approval_invalid', 403);
  requireThat(Object.keys(approval).every(key => ['authorityId', 'revision', 'receiptReferences'].includes(key)), 'host_activation_approval_invalid', 403);
  const current = {id: packet.id, projectId: campaign.projectId, campaignId: campaign.id, packetId: packet.id,
    packetDigest: packet.digest, actorId: principal.userId, actorBinding: digest(principal), source: 'host_owner_authority' as const, approval};
  if (prior) requireThat(digest({...prior, retainedAt: undefined}) === digest(current), 'host_activation_approval_changed', 403);
  else {
    requireThat(retain, 'host_activation_approval_not_retained', 403);
    const record: RetainedHostActivationApproval = {...current, retainedAt: new Date(now()).toISOString()};
    // Insert only. Replays verify the original record; corrections never replace it.
    await store.db.prepare('INSERT INTO records(project_id,kind,id,revision,body) VALUES(?,?,?,?,?)')
      .run(campaign.projectId, 'hostActivationApproval', packet.id, 1, JSON.stringify(record));
    await store.append(campaign.projectId, campaign.id, 'execution.host_activation_authorized', {
      packetId: packet.id, packetDigest: packet.digest, actorId: principal.userId,
      source: record.source, approval: record.approval,
    });
  }
  await authority.assertCurrent(principal, campaign, 'activate');
  return true;
}
