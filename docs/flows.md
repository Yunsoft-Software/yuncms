# Flows

Flows connect a trigger to operations in a visual graph. Use them for content validation, record updates, collection actions, webhooks and scheduled work. They are independent of [AI Automations](ai-automations.md).

![Studio Flow editor with a connected trigger, operation and successful run](assets/screenshots/studio-flows.png)

## Build and run a flow in Studio

1. Sign in as an Administrator and open **Settings → Flows** (`#/flows`).
2. Create a flow, name it and choose its trigger and execution permissions. New flows start **Inactive**.
3. Add operations. Drag nodes to arrange them and drag a connector from the trigger to the first operation.
4. Connect the green **Resolve** output for success or the red **Reject** output for failure to another operation's input. Multiple branches can connect to the same operation. Only the branch selected during this run executes; a merged node does not wait for other branches.
5. Select a node to edit its name, unique data-chain key and options. Operation options use JSON; invalid JSON blocks saving. The collection selector fills the collection option for data operations.
6. Activate and save. **Run saved flow** executes a saved manual flow with the JSON input supplied in the shared confirmation dialog. Unsaved changes must be saved first.
7. Open a run in **Run history** to inspect its output and step trace. The canvas highlights successful and failed steps. A handled rejection can appear as a failed step inside a successful run.

Double-click a connection to remove it. Removing an operation clears its incoming connections and trigger entry. Circular connections are rejected. Use **Duplicate**, **Export** and **Import** to reuse definitions; imports and duplicates start inactive and get a new id when saved. Export contains the definition, not run history. Saving or deleting a stale revision returns `FLOW_REVISION_CONFLICT` (409); reload before continuing.

The editor uses Studio's shared components, typography, spacing, theme tokens and responsive layout. Settings access and flow definitions/history are restricted to Administrators. Ordinary authenticated users see only explicitly granted manual actions in the relevant Content collection list or record editor. Actions requiring selection stay disabled until records are selected. Confirmation is a Studio interaction; direct API callers must provide the same required collection/selection data but do not receive a browser dialog.

## Triggers

| Trigger | Options and behavior |
| --- | --- |
| `manual` | Run through Studio or `POST /flows/:id/run`. `collections` optionally restricts Content destinations; `allowed_roles` grants ordinary roles access. Administrators are allowed. `require_selection` requires a nonempty `keys` array; `require_confirmation` and optional `confirmation` control Studio's dialog. |
| `event` | Select `mode: "filter"` or `"action"`, `events` and `collections`. Filters run synchronously in the native mutation transaction; actions enqueue after commit. |
| `webhook` | `method: "GET"` or `"POST"`, default POST. Private by default and requires an Administrator. Set `public: true` explicitly to allow unauthenticated callers. URL: `/flows/trigger/:id`. Input has `body` and `query`; request headers and authorization credentials are not added to the data chain. |
| `schedule` | `cron` accepts five fields (minute/hour/day/month/weekday) or six fields (second first). UTC only. Supports `*`, numeric lists, ranges and steps on `*` or ranges. Weekday is 0–6; day and weekday restrictions both apply. `0 */5 * * * *` runs every five minutes. Choose explicit public, system or selected-user accountability. |
| `operation` | Invoked by another flow's `trigger` operation. No standalone public execution endpoint. An array payload invokes the child once per element, serially, and returns an array of outputs. |

Blocking events: `items.create`, `items.update`, `items.delete`, `users.update`, `users.delete`, `users.password.update`. Action events additionally include `users.create`, `files.create`, `files.update`, `files.delete`. Match the native collection name, including `yuncms_users`/`yuncms_files` when relevant; the advanced trigger JSON accepts multiple events and collections. Studio's basic collection picker lists project collections.

Event input is `{event, collection, key, payload}` for filters and `{event, collection, payload}` for actions. Payload shapes follow the [native hook contracts](extensions.md). A filter leaves the native payload unchanged unless `options.response` names the replacement data-chain result. Native validation and permission rules still run after a filter returns. An unhandled error rolls back the mutation and any flow data writes on that transaction. Run history for that transaction rolls back too. External HTTP or email side effects cannot be rolled back; use action flows for those effects.

## Execution permissions

Every definition explicitly selects an `accountability`:

- `trigger` (default): re-resolve the verified trigger user's current role and active status. A queued event retains the verified actor, not authority from the submitted payload.
- `public`: use current Public role permissions.
- `user`: set `run_as` to an active, ordinary, non-Public, non-Administrator user UUID. The user's current permissions are checked again at execution.
- `system`: explicit internal authority, selected only by an Administrator configuring the flow.

Permission to start a manual flow does not itself grant data access. CRUD nodes call native `ItemsService` with the chosen accountability, including field allowlists, row filters, validation, hooks and audit behavior. Data operations support project collections; they cannot perform generic CRUD on system collections. An intentionally privileged public webhook or manual action can perform privileged work: review both its trigger access and execution permissions before activating it.

## Data chain and templates

The chain contains `$trigger`, `$accountability` (user/role/admin/public/system), `$env`, `$last` and each operation's unique key. `$last` is the last result or safe error object. Use dot paths or numeric array indices: `{{ $trigger.keys[0] }}` or `{{ read_records.0.id }}`.

An entire template preserves JSON types: `"{{ $trigger.keys }}"` becomes an array. A template inside text becomes text: `"Hello {{ $trigger.body.name }}"`. Missing variables fail with `FLOW_VARIABLE_NOT_FOUND`. Prototype traversal is rejected. Templates access data paths; they do not evaluate JavaScript.

Trigger option `response` selects the output path (for example `$last` or `result.message`); `$all` returns the complete chain. No response option returns `$last`. For filters, leave `response` unset unless replacing the native payload deliberately.

`$env` is empty by default. Only server variables named in `FLOWS_ENV_ALLOW_LIST` are exposed. Allowlisted values can reach outputs or destinations selected by a flow; do not allowlist secrets unintentionally.

## Built-in operations

All options accept templates. The following JSON objects are operation **options**, not complete definitions.

| Type | Options/example | Result |
| --- | --- | --- |
| `transform` | `{"value":{"name":"{{ $trigger.body.name }}"}}` | JSON value. |
| `condition` | `{"rules":{"$trigger.body.approved":{"_eq":true}}}` | Resolve on match, reject otherwise. Optional `value` supplies an object to test instead of the chain. Missing fields do not match. Supports `_and`, `_or`, `_eq`, `_neq`, `_null`, `_nnull`, `_gt`, `_gte`, `_lt`, `_lte`, `_in`, `_nin`, `_contains`, `_starts_with`, `_ends_with`. |
| `read` | `{"collection":"articles","query":{"fields":["id","title"],"limit":10}}` | Native item array. Optional `ids` reads specific ids; reads are bounded to 100 items. Uses the native [query language](api-query-language.md). |
| `create` | `{"collection":"articles","payload":{"title":"Example"}}` | Created item array. `payload` can contain 1–100 objects. |
| `update` | `{"collection":"articles","ids":"{{ $trigger.keys }}","payload":{"status":"review"}}` | Updated item results, in id order. Requires 1–100 ids. |
| `delete` | `{"collection":"articles","ids":"{{ $trigger.keys }}"}` | Native delete results, in id order. Requires 1–100 ids. |
| `log` | `{"message":"{{ $last }}"}` | Redacted structured application log; result `null`. |
| `sleep` | `{"milliseconds":1000}` | Delay 0–5000 ms; result `null`. |
| `request` | `{"method":"POST","url":"https://api.example.test/task","headers":{},"body":{"id":"{{ $trigger.keys[0] }}"}}` | `{status, body}`. HTTP(S) only, explicit server hostname allowlist, no URL credentials or redirects. GET/POST/PUT/PATCH/DELETE/HEAD; non-2xx fails. JSON response content types are decoded; otherwise body is text. Maximum response 256 KiB. |
| `mail` | `{"to":"reader@example.test","subject":"Updated","text":"Record changed"}` | Native SMTP delivery; `to` may contain up to 20 recipients. Requires [SMTP configuration](configuration.md#smtp-and-account-actions). Result `null`. |
| `trigger` | `{"flow":"CHILD_FLOW_UUID","payload":"{{ $last }}"}` | Child flow output, or outputs for an array of up to 100 inputs. The child must use the `operation` trigger. |
| `error` | `{"code":"REVIEW_REQUIRED","status":422,"message":"Review this record first"}` | Throws a configured 4xx error. Code uses uppercase letters, numbers and underscores. A reject connection may handle it. |

CRUD option `emit_events` defaults to `false`. It suppresses additional **Flow** event dispatch from that operation while native extension guards, audit and transaction behavior remain active. Setting it to `true` enables other matching flows; ancestry tracking still prevents recursive flow loops. Multi-item updates/deletes follow native per-item transaction behavior unless already inside a blocking filter transaction; do not assume a whole manual graph is one atomic transaction.

## REST reference and minimal definition

| Method/path | Access and result |
| --- | --- |
| `GET /flows` | Administrator; newest definitions first, up to 500. |
| `GET /flows/configuration` | Administrator; project collections, roles, eligible users, operation/event catalogue and bounds. |
| `POST /flows` | Administrator; create definition, returns 201 with id/revision. |
| `GET /flows/:id` | Administrator; complete definition. |
| `PUT /flows/:id` | Administrator; replace definition, include current `revision`. |
| `DELETE /flows/:id?revision=1` | Administrator; delete graph and its history, returns 204. |
| `GET /flows/:id/runs` | Administrator; newest 50 runs with safe input, actor, trace and output. |
| `GET /flows/available?collection=articles` | Authenticated; allowed active manual actions with display/confirmation/selection metadata, without graph definitions. |
| `POST /flows/:id/run` | Allowed manual caller; arbitrary JSON object, commonly `{collection, keys, body}`. Returns `{id,status,output,trace}` inside `data`. |
| `GET`/`POST /flows/trigger/:id` | Matching webhook method/access; returns the same execution envelope. |

Example `POST /flows` body:

```json
{
  "name": "Greeting",
  "status": "active",
  "trigger": "manual",
  "accountability": "trigger",
  "options": { "response": "$last", "require_confirmation": true },
  "entry": "greeting",
  "operations": [{
    "id": "greeting", "key": "greeting", "name": "Build greeting",
    "type": "transform", "position": { "x": 380, "y": 100 },
    "options": { "value": { "message": "Hello {{ $trigger.body.name }}" } },
    "resolve": null, "reject": null
  }]
}
```

Run with `POST /flows/FLOW_UUID/run` and `{"body":{"name":"YunCMS"}}`. The output is `{"message":"Hello YunCMS"}`. The definition has no ordinary-role grant, so only Administrators can run this example.

## Queue, schedules and bounds

Action and scheduled runs persist in MySQL. Each API process polls schedules independently and runs one queued job at a time. Schedule checks continue while a job is running. Row locks with `SKIP LOCKED` prevent replicas from claiming the same job. A unique flow/UTC-second key deduplicates scheduled dispatch between replicas. Scheduling is best effort while the API is running; there is no downtime catch-up or hard real-time guarantee.

Queued jobs pin the definition revision. Editing or deactivating a flow skips pending work with `FLOW_DEFINITION_CHANGED`. Queue capacity is 1000 pending/running jobs per flow. Running jobs have a one-minute lease; a worker detects expired leases as `FLOW_RUN_INTERRUPTED`. Interrupted jobs are not automatically retried, avoiding duplicate external side effects. Retained history has no automatic cleanup; deleting a flow removes its runs. Pending jobs retain their input to execute correctly, so secure database access/backups; input is redacted when claimed and in the history API.

Definitions and data chains are limited to 256 KiB, 100 nodes, 100 steps per graph, eight nested levels, 100 child inputs and 500 steps across a nested execution tree. JSON nesting is limited to 32 levels. A graph has a 30-second cooperative deadline shared with child execution: HTTP and delay operations observe cancellation; native database work already in progress cannot be undone solely by a timer. Completion after the deadline fails with `FLOW_TIMEOUT` (504).

Run history redacts sensitive key names using the native audit redactor and bounds each stored value to 64 KiB. Redaction is not detection of secrets embedded in arbitrary text. Avoid embedding credentials in definitions, arbitrary messages, non-secret field names or exported JSON.

The built-in catalogue does not execute arbitrary JavaScript. Trusted server code can supply an `operations` Map to `FlowsService` for additional operations, just as it supplies the native services, emitter and verified accountability. Custom operations remain trusted server code and must honor the supplied deadline and native service boundaries. Internal callers use services directly, not YunCMS HTTP endpoints.

The trigger/data-chain/resolve-reject behavior was studied in the [Directus Flows documentation](https://directus.com/docs/guides/flows/), [trigger guide](https://directus.com/docs/guides/flows/triggers) and [data-chain guide](https://directus.com/docs/guides/flows/data-chain). YunCMS implements its own bounded service and graph contracts; definitions are not a Directus import format.
