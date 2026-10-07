# First-time Connections — reviewed interaction blueprint

Normative appendix to [PRODUCT.md](../PRODUCT.md). The reviewed blueprint below is
retained; the uncommitted advertising candidate now renders this manual journey.
See [candidate status](ACCEPTANCE.md#connections-implementation-candidate-2026-10-06) for
implemented, blocked and unverified cases. No live connection is delivered.
Screen values below are synthetic. Implementation
must satisfy the [public contracts](CONNECTIONS-CONTRACT.md) and [proof cases](ACCEPTANCE.md).

## Entry and layout

A fresh project with zero grants opens **Connections** inside MarketingWorkspace.
A persistent project heading and navigation stay visible. At desktop widths, use
main content for the catalogue or active step and a secondary progress/evidence
column. At narrow embedded widths (390 and 320 CSS px), stack content in the same
reading order; no horizontal table, clipped actions or viewport-dependent layout.
Use the containing Marketing root's width, not the host window. These are layout
intentions, not a CSS change or a claim of visual QA.

Connections is a persistent route/panel, not a modal containing a long technical
form. An active setup detail has a **Back to Connections** link; returning keeps
the operation and the catalogue. Desktop can show a compact catalogue alongside
detail; narrow detail uses that link to the always-available catalogue. The catalogue
is never conditional on grants, and configured accounts never replace provider cards.

```text
Fieldwork / Marketing                         [Project: Fieldwork ▾]
Overview   Connections   Campaigns   Studio   Tracking   Launch   Results

Connections
Connect an advertising account to prepare your first campaign.
You will choose an account and review access before saving a connection.

ADVERTISING
[ Meta                         ] [ Google Ads                  ]
[ Facebook / Instagram feeds   ] [ Search text ads              ]
[ Not connected               ] [ Host setup needed            ]
[ Connect Meta                ] [ View setup requirements      ]
[ LinkedIn                     ]
[ Single-image feed ads        ]
[ Not connected                ]
[ Connect LinkedIn             ]

CREATIVE AI
[ OpenAI · Images              ] [ xAI · Video                  ]
[ Set up image generation      ] [ Set up video generation      ]
[ Separate generation budget  ] [ Video ad launch unavailable  ]

You can save campaign ideas while connections are being set up.
[Create a draft]
```

Each provider card always names its actual purpose, bounded formats, safe status,
reason, current actor and one starting/continuing action. “Host setup needed” opens
a readable checklist; it is not a disabled Connect button. A read-only user sees
“An editor or administrator can start setup” plus the permitted requirements view.
No raw provider IDs or JSON entry is the default task. IDs are shortened secondary
metadata for distinguishing identically named accounts; full safe IDs are in details.

For multiple accounts, retain one provider card with a labelled account list and
**Connect another account**. Each row has account/business label, suffix, verification
age and action-specific status. A project default is an explicit choice; adding an
account never silently changes the account used by existing campaigns.

## Step hierarchy, content and actions

The detail heading says **Connect Meta to Fieldwork** with saved-progress status.
Progress steps: Requirements → Discover → Choose account → Review access → Verify.
Discover includes **Review provider authorization** before any new OAuth grant.
Provider sign-in establishes identity; OAuth authorization gives the app access.
They must not be presented as the same harmless login step.
Each step has Complete / Current / Waiting / Needs attention, never color alone.
Above the primary action, state “Next: you”, “Next: project administrator”, “Next:
provider consent”, or “Checking with Meta”. Agent activity, if enabled, names the
permitted operation; it never impersonates the human actor.

| Screen / checkpoint | Required content | Actions and next state |
| --- | --- | --- |
| C1 Requirements | Purpose and bounded formats; project; app/broker/callback readiness, provider-account role needed; no credentials. Example: “Your host has not configured a Google OAuth app. An administrator must register the return URL and bind its credentials securely.” | **Continue with Meta** if configured; **View administrator setup** otherwise. **Save and close** retains request; **Cancel setup** explicitly cancels it. Manual is default; optional **Use Agent assistance** only if qualified |
| C2 Discover | “Find accounts you can access.” First show whether an existing authorized session covers this exact read or a new provider authorization is needed. New access review names the app, exact OAuth scopes, accessible account range (possibly not yet enumerable), offline/refresh access, provider persistence and local expiry/custody. Explain that provider access can persist even without a project Grant | Human **Approve provider access for discovery** approves a server-created summary before the authorization URL is issued. Then **Continue securely with Meta**. Decline has no provider effect. Existing session reuse requires current scope/actor/project checks; insufficient scope returns to review. Loading shows status and Stop |
| C3 Choose account | Returned accounts as radios: business/name, suffix, currency, reporting timezone provenance, available Page/organization, current role/access warning. Search is scoped/paginated by the server. Synthetic choices: “Studio retail · …2041” and “Trade catalog · …3170” | No auto-selection, even one result; explicit **Use Studio retail**. No results: **Check provider account access**, **Refresh accounts**, **Back**. Partial/error pages cannot be represented as an exhaustive empty list |
| C3i Choose publishing identity | When the requested action needs it, SDK-owned labelled choices for Meta Page/connected Instagram identity, LinkedIn organization, or Google manager/customer relationship; verified against the selected account. Reporting-only setup explains which later actions still need an identity | **Use this identity** retains an opaque server choice; no raw-ID form or host-built picker. Missing rights show **Check publishing access**. Changing account clears these choices and dependent approvals |
| C4 Review access | Exact project, account, provider app, intended operations, duration/expiry and who may use the resulting project connection. Separate “Requested”, “Provider consent” and “Project access approval”. Explain persistent custody and no ad/generation-spend authorization. Show differences on reauthorization | Human **Approve this connection's access** creates the exact server decision; then **Continue securely with Meta** if provider consent remains required. **Back** invalidates selection-dependent decision; **Cancel** denies this setup |
| C4h Human takeover | “Complete consent on Meta. Return here when finished.” Expected provider origin, selected account summary, expiry, safe checkpoint status, current actor. Login/challenges/terms stay on provider origin | Provider-origin navigation from authenticated broker route. **Check progress** is read-only. **Resume verification** uses server evidence, never a “I connected” boolean. Popup blocked: same-tab secure continuation. Expired handoff: **Create a new secure handoff**, after authority checks |
| C5 Verify | Rows: consent receipt; selected account identity/currency/timezone; account role; relevant identity ownership; permitted operations. Timestamp/source/evidence class for each. Pending reads cannot show successful capability badges | On success **Continue to campaign** and **Connect another account**. On failure action names the failed check: **Retry verification**, **Choose another account**, **Renew access**, or **View configuration requirements** |
| C6 Connection detail | “Studio retail verified for reporting” or “Account verified; campaign-specific preparation checks remain.” Evidence freshness and exact ready actions; explicit unsupported/blocked capabilities | **Recheck**, **Manage access**, **Reconnect**, **Back to Connections**. Manage access requires current authority; revocation is a separate explicit confirmed action with affected operations/campaigns, not cancellation of a wizard |

The original discovery → account choice → consent → verified sequence remains,
with explicit action-time approval **before** any new OAuth grant needed to discover.
A provider login cookie alone permits no API discovery. If the account list cannot
be known until OAuth completes, the first review must truthfully describe the exact
provider-wide scope and account range, including any broader bundled access; it
cannot promise selected-account-only provider access. No broad/offline/perpetual
access by default. If the necessary bundle cannot be qualified and approved under
host policy, block with the exact dependency. C4 separately approves the narrower
selected project/account/identity binding. A later scope increase needs another
provider-access review before handoff. Neither approval substitutes for the other
or authorizes spending. Do not pre-provision fake Grants for `setup(grantId)`.

A ready account is only ready for listed operations. Google reporting verification
must read “Campaign-specific write validation still required”. Meta/LinkedIn exact
material qualification stays in later campaign readiness; setup cannot produce a
universal green launch badge. A connection with missing write permission can be
saved as verified reporting access only after the user accepts that narrower scope.
Do not silently downgrade an explicit requested action to success.

## Concrete review replay

This is a synthetic acceptance walkthrough, not a connection receipt.

1. **Empty:** Fieldwork has no grants. User sees all three advertising cards and two
   creative-AI cards. Meta is configured; Google shows missing host OAuth app;
   LinkedIn shows its own configuration facts. Click **Connect Meta**.
2. **Requirements:** “You need access to your ad account and Page. You will review
   persistent project access. No campaign will be created.” Continue manually;
   no Agent SDK installation is necessary.
3. **Discover:** if no existing authorized session covers discovery, show the exact
   new provider authorization and obtain human approval first; only then open the
   provider sign-in/consent page. Authenticated, scope-checked discovery returns
   Studio retail and Trade catalog. The user selects Studio retail and any required
   publishing identity. A duplicate label is disambiguated by business and suffix.
4. **Review:** show Fieldwork / Studio retail / requested setup and reporting plus
   any explicitly requested later operations / expiry / project usage. Human
   approves that exact persistent access. Provider approval can still be pending.
5. **Handoff:** user completes the exact provider consent/challenge. Closing the
   tab midway leaves “Waiting for you”; reloading returns to this checkpoint.
6. **Verification timeout:** retained consent exists but account read timed out.
   Show “Access received; account verification incomplete”. Retry performs only
   verification, not another consent or account creation.
7. **Verified:** show account/currency/timezone and reporting evidence with safe
   receipt reference/time. “Create campaign” enters the SDK campaign flow with this
   account selected. Launch still requires material capability and exact approval.
8. **Later revoked:** the same detail shows “Access revoked; new actions blocked”.
   Reconnect requires fresh exact human approval; old campaigns/unknown operations
   remain inspectable according to current permissions and never get recreated.

Review must also replay a genuinely unconfigured host. All cards remain useful;
“View administrator setup” explains the dependency without pretending to connect.
This branch is not sufficient acceptance of the happy path.

## Creative-AI connection branch

OpenAI and xAI cards use Requirements → Review access → Secure configuration →
Verify. Do not pretend these providers use the advertising OAuth workflow.
The user selects an existing authorized credential binding or enters an existing
key on the SDK-owned private human secure-entry page. That script-free route is
isolated from ordinary Marketing forms; values never enter chat, domain commands,
React state or logs. Entry-screen evidence must mask the password input. The server binding has
a provider, project, allowed operations/model constraints, expiry and billing policy.

Human approval is required before persistent generation access. Verification checks
secure binding availability, provider/model configuration and existing billing
capability using separately authorized non-generating checks where available. If
no qualified harmless verification exists, show **Configured; generation unverified**.
Never submit a paid image/video merely to test connection. The first actual paid
job remains separately authorized. Ready labels distinguish “Ready to request an
image quote” from “Generated successfully”. xAI always explains the video/ad-media
incompatibility and offers later studio use, not an X account selection.

## Navigation, retries and competing actors

| Situation | Visible behavior / durable rule |
| --- | --- |
| Double click / repeated start | UI disables the in-flight action with reason; retain one stable request key. Server returns same operation for same payload. A changed payload with that key conflicts. New key cannot bypass an unresolved operation |
| Back before approval | Keep non-secret choices; changing provider/account/purpose invalidates downstream approvals and verification. Returning without changing does not erase confirmed work |
| Back after consent | Show retained consent and exact selected account. Selecting another account needs a new scoped review; never retarget the old grant or consume its evidence |
| Save and close / browser Back | Retain server checkpoint. Warn only about unsaved local selection. Return to catalogue with **Resume setup**; do not revoke persisted access or auto-cancel |
| Cancel before dispatch | Mark cancelled under revision check, invalidate pending decisions/handoff leases. Keep minimal audit/idempotency evidence under host retention. No grant created |
| Cancel with callback/effect in flight | Show “Cancellation requested; checking outcome”. Stop new effects, fence callback from minting authority, reconcile retained facts. Cannot promise provider-side consent was undone. Existing grant removal needs separate confirmed revocation |
| Reload / process restart | Read operation by authenticated project/id and fresh membership; recover current actor and checkpoint. Never auto-resubmit a consumed OAuth code or mint a new request key |
| Lost response | Read by original operation/key. If outcome unknown, show **Check outcome**; no automatic replay. Failed token exchange after consumed state may require fresh human consent only after retained result lookup; no false ready |
| Duplicate callback | Return retained safe status after current authorization, do not repeat exchange or duplicate grant. Expired/replayed/foreign state rejected without revealing another user's connection |
| Multi-account | Separate setup/grant/evidence per account. Account switch refreshes readiness and invalidates account-bound decisions; no reuse of old capability receipts |
| Two tabs / two editors | Expected revision and exact consent digest guard all transitions. Loser sees “Updated by another collaborator” and reloads safe state. No silent merging of access scopes |
| Another user resumes | Collaborator sees only permitted safe progress. Same-user provider handoff cannot transfer cookies/codes. Explicit human reassignment under host permission creates a fresh user-bound handoff and decision when needed |
| Membership expires during an awaited call | Recheck current membership/user kind/connection revision before committing or next effect. Show access-expired message, clear protected client data, deny new reads; do not return late account lists. Restricted audit retains uncertain effect for authorized recovery |
| Project switch | Abort local requests; fence late responses by project and client instance. Clear selections/provider data from prior scope. Durable old operation remains in its own project; return later via reauthorization. No cross-project callback redirect |
| Logout / session or provider identity switch | Clear prior protected UI immediately and invalidate active handoff binding. Same user in a new host session is not the old handoff session; explicitly rebind through a fresh authenticated action. A different provider identity requires rediscovery and review; never silently attach its accounts to the previous decision |
| Agent unavailable / interrupted | Manual path remains. “Agent assistance unavailable” gives reason. An interrupted Agent yields checkpoint/actor to the same UI; user can continue without changing authority or bypassing human consent |
| Offline / transport failure | Keep saved-progress timestamp, local unsaved selection clearly labelled, and retry/read-state action. Do not show disconnection or revoke merely because a read timed out |

## Actionable failure states

| State | User-facing explanation | Action / responsible actor |
| --- | --- | --- |
| Host configuration missing | “The host has not configured Meta sign-in for this environment.” Name missing app/broker/callback item without secret values | View setup checklist; host admin configures outside Marketing credential fields |
| Bad callback/app configuration | “The registered return address does not match this host.” Show safe expected return URI and environment | Admin corrects config; recheck. Do not retry token exchange blindly |
| Provider access pending / denied | “This app/account has not been approved for the requested feature” or “Consent declined” | Provider administrator resolves access or user retries deliberate consent; save draft remains available |
| No account / wrong business role | “No eligible account was returned for this signed-in identity” | Check account access on provider; scoped refresh or sign in with correct identity; no raw-ID bypass |
| Partial permissions | “Reporting verified. Preparing ads is unavailable with this access.” | Review requested access or retain explicitly accepted reporting-only connection |
| Expired token / grant | “Verification expired” versus “Persistent access expired” with separate times | Recheck token where permitted, otherwise renew human-approved access; expiry cannot be extended by browser claim |
| Revoked access | “This connection's access was revoked. Existing campaign history is retained.” | Authorized reconnect/reapproval; never auto-refresh around revocation |
| Provider verification error | “Account verification could not finish. Your choices are saved.” | Retry safe verification; bounded backoff; evidence remains unverified |
| Identity mismatch | “The provider returned a different account/currency than selected.” | Stop; rediscover/review exact account. No coercion or fallback to submitted ID |
| Capability unsupported | “Video ads are unavailable in this SDK” / exact unsupported tuple | Choose supported format in Studio or retain draft; no disabled unexplained placeholder |
| Capability not ready | “Supported format; this account's eligibility has not been verified.” | Run permitted specific verification or show missing app/account dependency; cannot replace with fixture success |

A configuration repair never silently resumes persistent consent, paid generation,
or launch. Human actions and uncertain effects retain their own gates.

## Keyboard, focus and responsive behavior

Use one page heading, labelled sections, native buttons/links, radio account choices
and accessible status text. Navigation indicates current location with `aria-current`;
if tabs are used, implement roving focus and arrow/Home/End selection consistently.
Search results retain focus on the query while updating, announce count and whether
more pages remain. Arrow keys select radio choices; Enter/Space activates explicit
actions. No hover-only requirements or icon-only status explanations.

On explicit step transition focus its heading; on validation failure focus the
error summary linked to affected fields. Background progress uses polite live
announcements and never steals focus. Handoff returns to the saved step heading and
announces the server-observed status. Loading retains the active control's place;
if removed, focus its stable step heading. Escape closes only a confirmation dialog,
returns focus to the trigger and never discards the setup. Destructive/cancel
confirmation traps focus correctly, makes cancellation the safe default and has
an accessible name describing the exact operation.

At 320/390, project identity, progress/current actor, step heading, content and
primary/secondary actions stack. Full labels wrap. Accounts are selectable cards,
not a table with horizontal scrolling; technical details expand vertically. Footer
actions must not cover inputs with the mobile keyboard or browser safe area. The
provider flow uses an approved system browser and host-owned secure return/deep-link
association on native targets, never an embedded arbitrary webview claiming consent.
System Back returns to saved progress. Dynamic text size, 200% zoom, keyboard-only,
screen reader and touch are explicit later QA cases, not assertions in this design.

## Resolved choices and rationale

- **Catalogue plus persistent detail instead of a grant list:** makes zero-grant
  start and missing configuration observable; adding an account remains obvious.
- **Manual default, optional Agent on the same operation:** host needs no Agent SDK
  install for ordinary connection. Agent can accelerate safe discovery but cannot
  create a parallel authority or approval flow.
- **Early exact approval when discovery needs new OAuth access:** avoids impossible
  unauthenticated enumeration without disguising a persistent provider grant as
  temporary sign-in. Provider authorization and selected project binding are distinct.
- **SDK-owned domain/discovery screens instead of provider-specific host forms:**
  hosts supply custody and transport configuration; SDK adapters retain mapping,
  state transitions and error copy. No raw-ID escape hatch masquerades as guided UX.
- **Action-specific evidence instead of one connected boolean:** account readiness
  cannot qualify an unknown campaign or spending action.
- **Retained checkpoints and compare-and-swap instead of restart-on-error:** avoids
  duplicate consent/write attempts and supports project switches and collaborators.

These reversible design choices need independent review, not an owner question to
finish this documentation milestone. Deferred policy decisions are listed in the
[acceptance appendix](ACCEPTANCE.md#dependencies-and-deferred-product-decisions).
