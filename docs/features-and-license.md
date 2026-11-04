# Features, editions and licensing

YunCMS Community and Premium share one source tree, build, npm distribution and
container image. Installing Premium does not require a fork, separate database or
replacement CMS. The existing Community services and extensions SDK retain MIT;
new files explicitly marked `LicenseRef-YunCMS-Commercial` use the commercial
terms reproduced in [LICENSE](../LICENSE). Previously released MIT versions,
including 0.1.47, retain their original permissions. The complete distribution
contains both MIT and proprietary components and must not be described as wholly
MIT or wholly open source.

A YunCMS Premium purchase is a one-time, perpetual license per production site
domain. Its www alias and an API hostname serving only that same site are part
of the site, while independent production sites need separate entitlements.
Development/staging hosts and instance transfers must be included in the issued
entitlement. Moving servers does not require buying the same site license again;
request a replacement entitlement from Yunsoft for a domain/instance transfer.
YunPanel is a separate product with its own subscription. Provider AI charges,
managed hosting and support are not included in a YunCMS software license.

## Configure trust

Configure these values on the server, never in the browser bundle:

| Variable | Default | Meaning |
| --- | --- | --- |
| `YUNCMS_LICENSE_PUBLIC_KEY` | unset | Trusted Yunsoft Ed25519 public key in PEM form; literal `\n` is accepted. Obtain the public key through a verified Yunsoft channel. Never configure a private signing key here. |
| `YUNCMS_LICENSE_DOMAIN` | unset | Exact licensed production or staging hostname, without scheme, path or port. |
| `YUNCMS_LICENSE_INSTANCE_ID` | unset | Required when the entitlement is bound to a particular instance. |
| `YUNCMS_LICENSE_TOKEN` | unset | Optional signed entitlement, used when no license has been installed in the database. |
| `YUNCMS_FEATURES_DISABLED` | empty | Comma-separated operator deny list of catalog keys. An unknown key rejects configuration. |

The configured domain is explicit; an untrusted request Host header cannot choose
a licensed domain. Verification checks Ed25519 signature, trusted key identifier,
issuer `yunsoft-commerce`, product `yuncms_premium`, active status, time, hostname
and optional instance. Only explicitly true signed capability keys grant Premium
rights. A perpetual entitlement has `billingModel: one_time_perpetual` and
`exp: null`. Verification is local and does not call a licensing server on every
request. Temporarily losing internet access does not expire a perpetual grant.
The deployment operator controls its trusted configuration; this is not a
sandbox against trusted server code or administrators modifying MIT source.

## Manage an installation

An administrator opens **Settings → Features and license**, installs the signed
token, and enables or disables authorized features. A database-installed token
takes precedence over the environment token and applies without rebuilding or
restarting. Tokens are never returned by the API. Do not include them in logs,
screenshots or support tickets. Back up the database and preserve trusted server
configuration when moving the installation.

| Key | Edition | Controlled entry points |
| --- | --- | --- |
| `aiAssistant` | Community | Official AI HTTP access and provider/tool execution in the server runtime |
| `aiFlows` | Community | AI Flow operations and official legacy automation execution |
| `mcp` | Community | Official MCP HTTP endpoint |
| `flowScripts` | Community | Native Flow script operation; existing script configuration must also allow it |
| `contentHistory` | Premium | Opt-in revision recording, administrator history and restore services |

The effective value requires a licensed capability (for Premium), no operator
deny, and no administrator disable. A Studio checkbox cannot grant a paid
capability or override the operator. Disabling Premium preserves ordinary CRUD,
authentication, permissions, files and existing data. Re-enabling history records
future mutations; it does not reconstruct changes made while recording was off.

### REST and services

* `GET /features`: authenticated users receive effective features; only
  administrators receive a non-secret license status.
* `PATCH /features/:feature` with `{ "enabled": false }`: administrator only.
* `POST /features/license` with `{ "token": "<signed entitlement>" }`:
  administrator only; signature/domain/instance validation precedes persistence.

These correspond to `FeaturesService.readStatus()`, `.update(name, { enabled })`,
`.activate(token)` and `.assertEnabled(name)`. Pass the deployment's `featurePolicy`
when constructing services in a custom server. Use `createFeaturePolicy(config.features)`;
never derive grants from client input. Unlicensed access returns
`FEATURE_NOT_LICENSED` (403), disabled access `FEATURE_DISABLED` (403), rejected
activation `INVALID_LICENSE` (400). Unknown feature keys are rejected.

## Concurrent content editing

Project collections use `metadata.contentTracking: { enabled: true, history: false }`
by default. Existing project collections gain this default during migration;
ordinary data and normal REST response shapes remain unchanged.

Use `Prefer: yuncms-edit-state` when reading an item. The response adds
`meta.revision`, an opaque unsigned integer **string**. A preferred list response
adds `meta.primaryKey` and `meta.revisions` indexed by authorized item keys.
Data and revisions come from one repeatable-read snapshot. A filtered response
cannot disclose revisions of inaccessible records. Do not convert revisions to
JavaScript Number. Existing records with no tracked mutations start at `"0"`.

Send the original token in `x-yuncms-item-revision` on PATCH or DELETE. A mismatch
returns `ITEM_REVISION_CONFLICT` (409) and does not apply that write. Preferred
create/update responses include the new token from the write transaction.
Omitting the header preserves the existing unconditional API contract. Tracked bulk update/delete calls are limited to 5,000 matched rows; split larger
operations into bounded batches. Bulk writes still advance tokens; disabling and re-enabling edit tracking does not
make previously issued tokens valid again. Tracking is not a distributed cache
validator and does not cover SQL performed outside native services.

Studio uses these tokens for full/quick editing, selected deletes and existing
translation/relation children. A conflict preserves the draft for comparison;
open the latest record in another tab before resolving it. Relation saves use
separate native HTTP requests: an earlier successful parent/child is committed
if a later child conflicts. The editor keeps confirmed IDs and tokens so a retry
does not duplicate successfully created children. This is not an atomic graph save.

Services accept `ItemsService.updateOne(id, payload, { expectedRevision })` and
`.deleteOne(id, { expectedRevision })`. `readEditState(id)` and `readEditStates(ids)`
respect native read permissions. When combining a service data read with its edit
state, use the same `withTransaction(..., { isolationLevel: 'REPEATABLE READ' })`;
separate transactions cannot guarantee that data and token describe one version.

## Premium content history

An administrator enables recording under **Features and license → Content history**
by choosing a collection and enabling **Record content changes**. The record editor
then offers a **Content history** dialog for inspecting and restoring revisions.
Alternatively enable recording through schema metadata, retaining other
metadata keys: `contentTracking: { enabled: true, history: true }`. A valid
`contentHistory` entitlement and enabled feature are also required. Each native
mutation records a revision in the same transaction as data and its version;
rollback rolls back all three. Existing snapshots remain when recording stops.
History is administrator-only; normal editor CRUD permissions do not grant
access to old hidden values.

* `GET /items/:collection/:id/revisions?limit=25&offset=0` lists metadata, newest
  first (limit 1–100).
* `GET /items/:collection/:id/revisions/:revision` reads one snapshot.
* `POST /items/:collection/:id/revisions/:revision/restore`, with the current
  `x-yuncms-item-revision`, restores writable scalar fields using native
  validation, hooks, audit and a new revision.

`ContentRevisionsService` exposes `readRevisions`, `readRevision` and
`restoreRevision`. This is existing-record recovery, not deleted-record recovery,
a multi-stage approval system or a backup replacement. Related records/files
are not copied into snapshots. Password/secret/token/credential fields and
binary data are excluded. A JSON field containing sensitive key names is omitted
as a whole, preserving its live value on restore. Arbitrary sensitive prose
cannot be detected automatically; enable history only for appropriate collections
and apply your database backup/retention/access policy to the stored history.
