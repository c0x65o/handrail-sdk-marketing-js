# LinkedIn publishing Connections — source qualification candidate

2026-10-07; workspace continuation of Connections review `49a95031` and creative
review `efc0cb63-6fd4-4d9c-a6f0-134cbe8abc96`. This supersedes the former blanket
publishing-discovery gate only. No live app, member, account or Page is qualified.
The SDK owns this workflow through the existing public Connections commands,
React component, Fetch adapter, Store and encrypted custody; no host LinkedIn form.

## Public flow and exact scope contract

Choose reporting or later campaign operations → review exact provider access →
current human approval → provider consent → discover and explicitly select an
account → for publishing, verify/select its associated Page → separately approve
project/account/Page/duration/operations → fresh verification → one local Grant.
Close/reload and lost acknowledgements recover the original durable intent. Cancel
and local revocation do not revoke provider-wide consent or delete campaign history.
Agent is absent from qualification. No campaign or paid operation runs in setup.

| Intent | OAuth scopes | Meaning |
| --- | --- | --- |
| Setup and reporting | `r_ads r_ads_reporting` | Account/role reads and reports; zero organization API calls |
| Campaign creation / sponsored publishing | `rw_ads r_organization_admin w_organization_social r_organization_social` | Advertising management, approved Page-role reads, sponsored post creation and readback |
| Publishing plus explicitly requested reporting | Previous bundle plus `r_ads_reporting` | Reporting is optional in the public command; the UI campaign option explicitly includes it |
| Pause-only / setup-only | `rw_ads` / `r_ads` | No inferred organization access |

`rw_conversions` remains separate. No `rw_organization_admin`, profile scope,
organizationLookup or organizationAuthorizations fallback is introduced.
Provider permissions span eligible accounts/Pages of the consenting member;
selected project binding is narrower. Both reviews explain that authorization can
persist beyond local cancellation and does not authorize spending.

Publishing requires server-owned `OAuthApp.linkedinAdvertising` with nonempty
`appId`, matching OAuth `clientId`, current `revision`, Advertising `tier`
(`development` or `standard`), and an explicit `supportedScopes` array covering
the exact requested bundle. Existing `ConnectionAccessPolicy.allowedOAuthScopes`
and current grant-maker policy must also allow it. These are configuration facts,
not a claim that the token/member has permission. Missing publishing configuration
produces administrator instructions before OAuth; reporting still uses the existing
OAuth app and reporting policy independently. Browser fields cannot supply this
capability. Config/scopes/session changes invalidate the digest and old review.
A blocked intent must be cancelled before a fresh review under corrected config.

Runtime introspection must return active actual scopes covering the exact consent;
extra scopes are rejected too. Contradictory optional client, auth type, status or
expiry metadata denies access. Account and ACL reads provide independent role
observations. Successful token exchange/requested scopes alone cannot verify a
connection. No real app configuration, token or consent was changed by this work.

## Source-qualified discovery boundary

All Marketing reads send `LinkedIn-Version: 202609` and
`X-Restli-Protocol-Version: 2.0.0`; transport rejects redirects.

- [Account-user finder](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-account-users?view=li-lms-2026-09):
  `GET /rest/adAccountUsers?q=authenticatedUser` supplies sponsored account URN,
  member URN and role for the token's member. Every row must have one consistent
  member; the selected account/member/role must match fresh verification. VIEWER
  is reporting-only. CREATIVE_MANAGER cannot qualify this whole campaign-creation
  path; CAMPAIGN_MANAGER, ACCOUNT_MANAGER and ACCOUNT_BILLING_ADMIN can.
- [Additional fields](https://learn.microsoft.com/en-us/linkedin/marketing/additional-info-field?view=li-lms-2026-09)
  and [account schema](https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-accounts?view=li-lms-2026-09):
  account GET projects `id,name,reference,referenceInfo,currency,status`.
  `referenceInfo.organization` supplies display identity only. Its ID, when
  present, must agree with `reference`. Missing labels use the full safe URN with
  a warning, without extra permission. Person references cannot qualify this
  SDK's organization-publishing path.
- [Approved Page-role finder](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-access-control-by-role?view=li-lms-2026-09):
  `GET /rest/organizationAcls?q=roleAssignee&state=APPROVED` requires
  `r_organization_admin`. Each ACL must name the same member; a qualifying row
  must name the exact account-associated organization and state APPROVED. The
  documented `organization` and `organizationTarget` forms are accepted only
  when consistent; conflicting fields deny the snapshot.
- [Posts permissions](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09):
  initially accept ADMINISTRATOR and DIRECT_SPONSORED_CONTENT_POSTER only.
  CONTENT_ADMINISTRATOR (ACL) and CONTENT_ADMIN (Posts) remain gated without a
  qualified mapping. Account reference or display name never proves Page rights.
- [Pagination](https://learn.microsoft.com/en-us/linkedin/shared/api-guide/concepts/pagination):
  these two finders use offset start/count, distinct from adAccounts *search*
  cursor pagination (unused). Complete all pages before exposing a LinkedIn
  snapshot. Validated continuation links or totals take precedence over empty
  pages; a full page without total continues. Reconstruct only the same finder's
  expected next offset, never follow arbitrary URLs. Maximum 40 pages/1,000 rows;
  exhaustion, invalid paging or conflicting rows means incomplete, never verified.
- [Token introspection](https://learn.microsoft.com/en-us/linkedin/shared/authentication/token-introspection)
  supplies actual scope and active-token evidence before discovery, before ACL,
  and again during final verification. Optional metadata cannot contradict the
  bound client/expiry. Existing before/after-await authority guards protect reads
  and parsing; SQL revision/session/grant/expiry checks protect promotion.

The selected Page, adAccount.reference, campaign associatedEntity and post author
must agree **for this SDK-supported associated-organization path**. This is an SDK
restriction, not a universal LinkedIn rule. The resulting Grant stores only that
organization; existing plan construction/readback already binds campaign entity,
image owner and post author to it. This tranche does not change payloads, native
write authority, historical IDs/material, budget/day denials, reports or leads.

## App entitlement and product truth

[Advertising product matrix and tiers](https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access?view=li-lms-2026-09)
include the required read/admin/social scopes under Advertising API. Community
Management approval is not inherently required for this paid-ad discovery path.
Advertising Development allows read access and bounded editing of up to five
accounts; it is not Advertising Standard. Approval emails supplied for app
265827087 identify Advertising Development and Conversions Standard only. Actual
runtime client binding, enabled scopes, member consent, token and account/Page
roles remain UNVERIFIED. Conversions Standard grants neither Advertising Standard
nor organization authority. An email never populates runtime configuration here.

[Organization Lookup](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/organizations/organization-lookup-api?view=li-lms-2026-09)
has its own broader permission contract. It is deliberately unused for labels or
ACL denial recovery. No provider role write or automatic scope expansion occurs.

Public copy distinguishes reporting connected, publishing app configuration
missing, consent required, account-role denial, Page-role denial, member/identity
mismatch, and incomplete/stale discovery. Reporting success explicitly says Page
access still needs a separate review. Fixture evidence never means live readiness.

## Qualification and next gate

Input verification matched all 117 source files, source digest
`6a400f25689359234e0d60b3fc9fbb19ce0437cf26dfda332730b0d45e7e2d9d`,
creative custody SHA `d479357847869b86453e758f0e89691fb8902218bfd824f489295c1a8ca1bb84`,
all 5,187 earlier input artifacts and all 5,475 artifacts present at entry.
Historical external Facebook isolation attempts remain **FAILED**; their bytes and
all new failed attempts are retained. Documentation responses and hashes live in
`artifacts/linkedin-connections/official-sources/manifest.json`.

Final verification, source/custody and screenshots are recorded in
`artifacts/linkedin-connections/verification.json`, `source-manifest.json`,
`custody-final.json` and the browser artifact directories. Tests use synthetic
transport, disposable real SQLite and isolated socket-only PostgreSQL. The packed
public consumer checks 1440/390/320 with Agent absent; it is an uncommitted candidate
projection, not public Git installation or release. The native >5-minute aggregate
skip rule remains; broad native/paid suites are not claimed.

Next gate: independent source/security and pixel review of this exact digest,
then separately authorized real app/account qualification. Publication, Preview
adoption, native dual-session handoff research/implementation and device QA are
separate. No Flutter/Preview change, cookie bridge, WebView, native authentication,
version bump, migration, commit/push, deploy or isolated tranche release. Product
acceptance remains incomplete; this is not Ready for Clinton.

## Independent end-to-end review

The [subsequent review](LINKEDIN-E2E-REVIEW.md) corrects native permission projection,
current-token proof and exact-scope checks, and qualifies the new Connections
grant through actual NativeProvider reporting and campaign preparation/readback.
Its final receipts supersede these historical fixture counts for the changed source.
Live/native/full-product gates remain open.
