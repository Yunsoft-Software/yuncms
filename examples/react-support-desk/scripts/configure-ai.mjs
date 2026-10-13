import { readFile, writeFile } from "node:fs/promises";
import { login, request } from "./http.mjs";
import { automationRule } from "./model.mjs";
const fixture = process.argv.includes("--fixture");
if (
  !fixture &&
  (!process.env.EXAMPLE_AI_BASE_URL ||
    !process.env.EXAMPLE_AI_MODEL ||
    !process.env.EXAMPLE_AI_API_KEY)
)
  throw new Error(
    "Set the three EXAMPLE_AI_* values in .env.local or explicitly pass --fixture.",
  );
const { access_token: token } = await login("admin");
const settings = await request("/ai/settings", {
  token,
  method: "PATCH",
  body: {
    enabled: true,
    writes_enabled: true,
    base_url: fixture
      ? "http://127.0.0.1:3059/v1"
      : process.env.EXAMPLE_AI_BASE_URL,
    model: fixture ? "fixture-no-inference" : process.env.EXAMPLE_AI_MODEL,
    api_key: fixture
      ? "local-fixture-placeholder"
      : process.env.EXAMPLE_AI_API_KEY,
  },
});
if (settings.status !== 200)
  throw new Error(`AI settings rejected (${settings.status})`);
const state = JSON.parse(await readFile(".demo-state.json", "utf8"));
const rule = automationRule(state.processor);
const preview = await request("/automations/preview", {
  token,
  body: { rule, item_key: state.first },
});
if (preview.status !== 200)
  throw new Error(
    `Preview failed (${preview.status}; ${preview.code || "unknown"})`,
  );
console.log(
  JSON.stringify({
    mode: fixture ? "deterministic fixture; no AI inference" : "real provider",
    preview: preview.data,
  }),
);
rule.enabled = true;
const saved = await request(
  state.rule ? `/automations/${state.rule}` : "/automations",
  { token, body: rule, method: state.rule ? "PUT" : "POST" },
);
if (![200, 201].includes(saved.status))
  throw new Error(`Rule save failed (${saved.status})`);
state.rule = saved.data.id;
state.ai_mode = fixture ? "fixture" : "real-provider";
await writeFile(".demo-state.json", JSON.stringify(state, null, 2), {
  mode: 0o600,
});
// Trigger on selected input update. Existing records are not backfilled automatically.
for (const id of [state.first, state.second]) {
  const item = await request(`/items/requests/${id}?fields=id,message`, {
    token,
  });
  const update = await request(`/items/requests/${id}`, {
    token,
    method: "PATCH",
    body: { message: item.data.message },
  });
  if (update.status !== 200) throw new Error("Could not enqueue sample record");
}
console.log(
  "Enabled native automation and queued two synthetic requests. Verify completed runs before claiming success.",
);
