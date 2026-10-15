# Flow recipes

These recipes accompany the [illustrated Flow guide](flows.md). Each linked JSON file is a complete definition that can be pasted into **Settings → Flows → Import**, or sent to `POST /flows` by an Administrator. Every file starts **Inactive** and omits server ids, revisions and run history.

## Before importing

- Create or choose project collections and fields before configuring CRUD nodes. These examples use `articles` with `title` and `status` string fields.
- Replace both trigger collection names and operation collection names if your project uses another collection.
- Replace `11111111-1111-4111-8111-111111111111` with an allowed ordinary role id, `33333333-3333-4333-8333-333333333333` with an active ordinary Run as user id, and `22222222-2222-4222-8222-222222222222` with the saved child flow id where used. These are placeholders, not accounts created by importing.
- Review execution permissions before activation. A normal role needs its own native field and row permissions. The scheduled selected-user example cannot be saved until its Run as placeholder has been replaced with a real eligible user.
- Save, activate and save again when importing through Studio. Imports force inactive status. API updates require the returned current `revision` and the full definition.

The requests below assume `YUNCMS_URL=http://localhost:3008`, an appropriate bearer token in `TOKEN`, and a saved flow id in `FLOW_ID`. Store real credentials locally, outside Git. Recipes 1–7 need no external service. Script recipes require explicit server enablement; recipe 10 requires an operator-controlled HTTPS endpoint.

## 1. Greet a manual caller

**Definition:** [manual-greeting.json](examples/flows/manual-greeting.json). **Requirements:** Administrator account only. **Graph:** trigger → `greeting` (`transform`). **Scope:** verified trigger user.

Operation options:

```json
{ "value": { "message": "Hello {{ $trigger.body.name }}" } }
```

Activate the saved definition, then run:

```bash
curl --fail-with-body "$YUNCMS_URL/flows/$FLOW_ID/run" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"body":{"name":"YunCMS"}}'
```

The response's `data.status` is `succeeded` and `data.output` is `{"message":"Hello YunCMS"}`. `data.trace` contains the `greeting` step. Missing `body.name` produces `FLOW_VARIABLE_NOT_FOUND` rather than an empty replacement. This definition has no ordinary-role grant.

## 2. Branch and merge an approval decision

**Definition:** [approval-branches.json](examples/flows/approval-branches.json). **Requirements:** Administrator account only. **Graph:** `approval` → `accepted` or `rejected` → `result`.

| Node key | Type | Important options/connections |
| --- | --- | --- |
| `approval` | `condition` | `{"rules":{"$trigger.body.approved":{"_eq":true}}}`; resolve → `accepted`, reject → `rejected`. |
| `accepted` | `transform` | `{"value":{"decision":"approved","accepted":true}}`; resolve → `result`. |
| `rejected` | `transform` | `{"value":{"decision":"needs_review","accepted":false}}`; resolve → `result`. |
| `result` | `transform` | `{"value":{"decision":"{{ $last.decision }}","accepted":"{{ $last.accepted }}"}}`. |

Run with `{"body":{"approved":true}}` or `{"body":{"approved":false}}`. The final `accepted` value remains a JSON boolean. The string `"true"` is not equal to the boolean `true`. Only one branch executes, and the shared result runs once. The false path handles a condition rejection, so that run still succeeds. See the [graph and trace screenshots](flows.md#connect-branches-and-merge-the-result).

## 3. Mark selected Content records for review

**Definition:** [manual-content-review.json](examples/flows/manual-content-review.json). **Requirements:** `articles.status`, an ordinary authenticated user, read/update permission and its role id replacing the placeholder. **Graph:** trigger → `mark_review` (`update`). **Scope:** trigger user.

Trigger options:

```json
{
  "response": "$last",
  "collections": ["articles"],
  "allowed_roles": ["11111111-1111-4111-8111-111111111111"],
  "require_selection": true,
  "require_confirmation": true,
  "confirmation": "Set the selected records to review status?"
}
```

Operation options:

```json
{
  "collection": "articles",
  "ids": "{{ $trigger.keys }}",
  "payload": { "status": "review" },
  "emit_events": false
}
```

Studio supplies the selected collection and ids. Select one or more saved records, click **Mark for review** and confirm. For an API client, provide those values explicitly with the ordinary user's token:

```bash
curl --fail-with-body "$YUNCMS_URL/flows/$FLOW_ID/run" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"collection":"articles","keys":["ARTICLE_UUID"],"body":{}}'
```

The output is an array of native updated-item results. Each permitted selected record has status `review`. An empty selection is rejected; a different collection or role is denied. A matching role grant does not bypass its row filter or field allowlist. `emit_events: false` avoids starting additional Flow event handlers while preserving native extension guards and audit behavior. Multiple updates are not one graph-wide transaction.

## 4. Reject creation without a title

**Definition:** [event-title-required.json](examples/flows/event-title-required.json). **Requirements:** `articles.title`; permission to create an article. **Trigger:** before-write `items.create` filter. **Scope:** native mutation caller.

The title condition is:

```json
{
  "rules": {
    "$trigger.payload.title": { "_nnull": true, "_neq": "" }
  }
}
```

The condition has no Success successor. Its Failure successor is a Throw error node with `{"code":"ARTICLE_TITLE_REQUIRED","status":422,"message":"Provide an article title."}`. Trigger options deliberately omit `response`; a successful validation must preserve the original native payload.

Once active, `POST /items/articles` with `{"title":"Example","status":"draft"}` succeeds according to the native create contract. Input `{"status":"draft"}` or `{"title":""}` returns HTTP 422 with code `ARTICLE_TITLE_REQUIRED`, and no record is created. This checks presence/nonempty text; it does not trim whitespace or replace native field validation.

Unhandled blocking errors roll back the original mutation, transactional flow writes and their run history. Do not expect a rejected run to survive that rollback. To perform work after a successful write, use Action mode instead; its payload shape follows the [native event contract](extensions.md) and it runs from the durable queue.

## 5. Private webhook

**Definition:** [webhook-greeting.json](examples/flows/webhook-greeting.json). **Requirements:** Administrator token only. **Trigger:** private POST webhook. **Scope:** trigger caller.

After activating, copy the webhook URL from the inspector or use the saved id:

```bash
curl --fail-with-body "$YUNCMS_URL/flows/trigger/$FLOW_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"YunCMS"}'
```

The output is `{"message":"Hello YunCMS"}`. Unlike manual input, the HTTP body is automatically placed under `$trigger.body`; do not send an extra `body` wrapper. Query parameters appear under `$trigger.query`.

Calling without the token returns 403 because `public` is false. GET does not match this POST definition and returns 404. Public access must be enabled explicitly and should be reviewed alongside execution scope: choosing public trigger access and system execution would intentionally allow privileged work through that URL. This example retains private access and trigger-user execution.

## 6. Read a review queue every day

**Definition:** [schedule-read.json](examples/flows/schedule-read.json). **Requirements:** `articles.title`, `articles.status`, an active ordinary Run as user and read permission. Replace its Run as UUID before saving. **Trigger:** daily 08:00 UTC.

```json
{
  "collection": "articles",
  "query": {
    "fields": ["id", "title", "status"],
    "filter": { "status": { "_eq": "review" } },
    "limit": 25
  }
}
```

Cron `0 0 8 * * *` includes seconds. Five-field `0 8 * * *` matches the same daily minute at second zero. The operator must convert their intended local time to UTC; the scheduler does not use the browser or host timezone.

Once activated, matching dispatch creates a durable queued run. The worker reads records under the selected user's current native permissions, so row/field restrictions remain effective. The output is an item array in run history; an empty array is a successful empty queue. This read operation does not send mail, change records or acknowledge work.

To test immediately, duplicate the graph, change the copy to Manual, review its options and run it. Keep the actual schedule inactive until its collection, user and UTC time are correct. Schedules run only while the API is running, have no downtime catch-up, and deduplicate a flow's scheduled second across API replicas.

## 7. Call a child once per array element

**Definitions:** [child-normalize.json](examples/flows/child-normalize.json), then [parent-batch.json](examples/flows/parent-batch.json). **Requirements:** Administrator account; no collection or external service. **Scopes:** each flow retains trigger accountability.

1. Import the child, which uses **Another flow**. Activate and save it; copy its saved id.
2. Import the manual parent. In the Trigger flow operation, replace the `2222…` child-id placeholder with that id. Activate and save.
3. Run the parent with:

```json
{
  "body": {
    "rows": [{ "name": "Ada" }, { "name": "Lin" }]
  }
}
```

The parent passes `$trigger.body.rows` as a typed array. The engine calls the child serially with each element. Inside the child the name is `$trigger.name`, not `$trigger.body.name`. Parent output:

```json
[{ "name": "Ada" }, { "name": "Lin" }]
```

Up to 100 inputs are allowed. Direct/indirect recursion is rejected; child execution shares its parent's cooperative deadline and total-step budget. Empty arrays return an empty array. The child's normal **Run saved flow** button is disabled because its trigger is Another flow; test through the parent.

## Extend a recipe with another operation

Select the previous operation's Success or Failure port and connect the next operation's input. Use its result key or `$last` in options; see the [twelve-operation reference](flows.md#built-in-operations).

- To log a safe summary, add `log` with `{"message":"{{ $last }}"}`.
- To call an external service, first allow the intended hostname with `FLOWS_REQUEST_ALLOWED_HOSTS`, restart and configure a Request node. Empty allowlists deny requests; redirects are rejected.
- To send mail, configure native SMTP and use a controlled recipient. Email/HTTP effects cannot be undone by a later node failing.
- To return a particular earlier result, select the trigger and set its response path to that key. `$all` returns the entire data chain, including allowlisted environment values, so choose it deliberately.

See [queue and limits](flows.md#queue-schedules-and-bounds) and [troubleshooting](flows.md#troubleshooting) before enabling a flow that changes data or reaches an external system.

## 8. Calculate an order in a trusted script

**Definition:** [script-order-total.json](examples/flows/script-order-total.json). **Requirements:** trusted Administrator, `FLOWS_SCRIPTS_ENABLED=true`, and the SDK installed with YunCMS. **Graph:** trigger → `calculate` (`script`). No database mutation occurs.

Import, activate and run with:

```json
{"body":{"lines":[{"quantity":2,"unit_price_cents":1490},{"quantity":1,"unit_price_cents":500}]}}
```

The ESM script imports `node:crypto` and the installed `@yunsoft/yuncms-extensions-sdk` package. It returns `total_cents: 3480` and a SHA-256 `fingerprint` of the input lines. An empty/invalid list or invalid quantity/price returns HTTP 422 with `ORDER_INVALID`. Values use integer cents. Open the failed run to inspect the `calculate` step. The [script reference](flows.md#run-script) explains enablement and trust boundaries.

## 9. Use an installed package from CommonJS

**Definition:** [script-commonjs.json](examples/flows/script-commonjs.json). **Requirements:** enabled trusted scripts and `mysql2` in the running project's dependencies. **Graph:** trigger → `script` (`script`).

Run with `{"body":{"value":21}}`. This script uses `require('mysql2')` and `require('node:crypto')`, exports a function through `module.exports`, and returns `query: "SELECT 21 AS value"` plus a SHA-256 fingerprint. It formats a query without executing SQL. Prefer `context.items()` for actual data work so native permissions and transactions apply.

## 10. Verify a private webhook over HTTPS before creating a record

**Definition:** [webhook-https-record.json](examples/flows/webhook-https-record.json). **Requirements:** an `articles` collection with `title`/`status`, a trusted HTTPS verification endpoint, and its exact hostname in `FLOWS_REQUEST_ALLOWED_HOSTS`. **Graph:** private POST webhook → `verification` (Request) → condition → create or error. No script enablement is required.

Replace `https://api.example.test/verify` with an endpoint you control. It must accept JSON `{"approved":true|false}` and return `{"verified":true|false}` with a JSON content type and valid trusted TLS certificate. Choose the desired normal Run as user with native article-create/read permissions, or deliberately keep Administrator trigger authority. Activate and send:

```bash
curl --fail-with-body "$YUNCMS_URL/flows/trigger/$FLOW_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Verified submission","approved":true}'
```

If the endpoint returns `verified: true`, the flow creates one record with `status: "review"` and returns the native created-item array. If it returns false, the API returns 422 `WEBHOOK_VERIFICATION_FAILED` without creating a record. Without authentication the private webhook returns 403. HTTP errors, redirects, untrusted certificates and invalid/oversized JSON fail before creation; inspect run history for the failing step. The HTTPS request is an external side effect and is not transactional.
