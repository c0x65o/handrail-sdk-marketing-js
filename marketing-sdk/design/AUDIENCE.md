# SDK-owned country Audience journey

2026-10-08 · implementation contract, qualification pending.

PRODUCT P5/S02 and P9/I01 require provider choices and reuse without host-authored
marketing controls. The next bounded path is ordinary Meta v26 traffic/LINK_CLICKS,
single image, lifetime budget and first-party inquiry. SDK country search replaces
the dependency on host `targetingOptions` and manually entered country IDs on that
path. Other providers, languages/interests/exclusions, strict targeting, Employment,
daily budgets and unsupported media remain separately unqualified or blocked.

The existing public client/server exposes search, resolve-selected and status.
Browser results contain country labels, kind, opaque choices and continuation
references, with loading/empty/partial/unavailable/unsupported states. The server
retains exact returned country keys and names. Provider credentials, URLs, raw
responses and authority digests are private. A partial search never proves an
omitted country invalid; unresolved selected countries remain visible for repair.

The [Meta-owned targeting example](https://github.com/facebookincubator/catalogue-of-api-solutions/blob/main/solutions/miscellaneous/targeting-reach-estimate.md)
documents global `/search`, `type=adgeolocation`, `location_types=["country"]`,
bounded `q`, and stable keys rather than names. The SDK fixes v26.0, rejects other
geo kinds, malformed/unknown keys and conflicting duplicates, and never follows
provider URLs. Query, pages, bytes, deadline, cursors and total work are bounded.

Display observations and selected-country proof are distinct. Every cache access
checks project/principal/session/provider/account/grant/connection revisions,
configuration/custody, API version, locale/facet/query and material restrictions.
Observations use existing Store records without changing Grant.revision. Native
preflight freshly resolves each selected key and exact country type through the
provider read path. Renaming cannot substitute another key. Preparation and native
readback must preserve the same countries and existing plan/material identity.

SDK UI owns debounced explicit search, keyboard choices, chips/removal, retained
edits, account context, Back/reload/retry and stale recovery. Late/hidden/disposed
responses cannot repaint or trigger more work. Account changes invalidate authority
without translating or silently discarding draft selections. Manual setup needs no
Agent. No idle polling or increase to the shared 120/minute budget is allowed.

F9 is prerequisite: legacy setup/resume and campaign save must separate external
observation/effects and decode from short session → source → Store guards. Durable
intent precedes setup effects; duplicate/lost acknowledgements preserve original
identity and unknown outcomes. Fresh authority, exact revisions and material,
configuration/custody bindings fence finalization. Newer decisions always win.

Acceptance requires focused SQLite/PostgreSQL concurrency and hostile-boundary
checks, then an installed public-export consumer with external SQL sessions and
actual NativeProvider under deterministic HTTP fixtures. Starting with zero grants,
complete Connections/Studio/AI-edited option/media/Tracking/promotion; search/select
two countries, reload/edit/remove/reselect/save, preflight, paused preparation,
exact approval, activation/readback and same-campaign Results. Preserve first-party
submissions/people and QA exclusions, hashes, screenshots at 1440/390/320, traces,
identity chain and request timelines. Prior failures and snapshots remain immutable.

Local synthetic evidence does not qualify real provider eligibility, published Git
installation, hosted Preview, native devices, whole-product Ready or publication.
Actual check results and remaining work belong to the new receipt, not this design.

## Independent review · 2026-10-08

`artifacts/audience-review-f3ec105b/receipt.json` records the reviewed entry,
repairs, exact checks and remaining acceptance gates. Existing receipts and failed
attempts remain immutable. Country resolution now releases its UI latch when the
account changes or the editor hides, and older completion/error handlers cannot
clear a newer request's state. The existing Studio Cancel action disposes pending
country requests before restoring saved edits, so a late selection cannot undo
the cancellation. Superseded searches are cancelled; Enter cancels
debounce. Concurrent identical status observations share the pending read only;
returning after it settles still reauthorizes. Retained country codes remain edits,
not account authority. The browser driver includes two independently approved
synthetic Connections, same-label choices, old responses and cross-account reuse.

Campaign save and Studio promotion observe media bodies outside the session/source/
SQL guards. The final transaction compares exact retained metadata and bytes using
SQL equality, without transferring or decoding the body under the guards. Changed
bytes reject commit. Studio promotion also binds the original session inspection
and full draft through the unlocked observation. These changes preserve historical
write receipts and do not resubmit unknown provider effects.

The receipt distinguishes a copied candidate consumer from a supported dependency
installation. The project dependency rule requires a published HTTPS Git full SHA
and matching lockfile; this dirty candidate cannot satisfy that while committing
and publication are prohibited. Local projection evidence never clears that gate.
Request-budget, complete journey, SQL dialect and visual results must be read from
the actual new receipt, rather than inferred from predecessor counts. No broader
provider, actual account, host, native-device, accessibility or Ready claim follows.
