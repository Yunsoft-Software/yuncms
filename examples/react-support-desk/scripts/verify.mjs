import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { login, request, origin } from "./http.mjs";
import { requestPayload } from "../src/logic.js";
const state = JSON.parse(await readFile(".demo-state.json", "utf8"));
const admin = await login("admin"),
  agent = await login("agent"),
  viewer = await login("viewer"),
  processor = await login("processor");
const results = [];
async function check(name, run) {
  await run();
  results.push({ name, passed: true });
}
const a = agent.access_token,
  v = viewer.access_token,
  p = processor.access_token,
  t = admin.access_token;
await check("Anonymous request read denied", async () =>
  assert.equal((await request("/items/requests?fields=id")).status, 403),
);
await check("Agent sees own rows only", async () => {
  const r = await request("/items/requests?fields=id,created_by", { token: a });
  assert.equal(r.status, 200);
  assert.ok(r.data.length >= 2);
  assert.ok(r.data.every((x) => x.created_by === agent.user.id));
});
const all = await request("/items/requests?fields=id,created_by", { token: t });
const other = all.data.find((x) => x.created_by !== agent.user.id);
await check("Caller filter cannot widen row permissions", async () => {
  const r = await request(
    `/items/requests?fields=id&filter=${encodeURIComponent(JSON.stringify({ id: { _eq: other.id } }))}`,
    { token: a },
  );
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, []);
});
await check("M2O expansion returns category object", async () => {
  const r = await request(
    `/items/requests/${state.first}?fields=id,category_id.name`,
    { token: a },
  );
  assert.equal(r.status, 200);
  assert.equal(r.data.category_id.name, "Technical");
});
await check("O2M expansion returns comments array", async () => {
  const r = await request(
    `/items/requests/${state.first}?fields=id,comments.body`,
    { token: a },
  );
  assert.equal(r.status, 200);
  assert.ok(r.data.comments.length >= 1);
});
await check("Agent cannot project administrator-only field", async () =>
  assert.equal(
    (
      await request(`/items/requests/${state.first}?fields=id,internal_note`, {
        token: a,
      })
    ).status,
    400,
  ),
);
await check("Agent cannot overwrite AI output", async () =>
  assert.equal(
    (
      await request(`/items/requests/${state.first}`, {
        token: a,
        method: "PATCH",
        body: { summary: "forged" },
      })
    ).status,
    403,
  ),
);
await check("Agent cannot update another creator’s request", async () =>
  assert.equal(
    (
      await request(`/items/requests/${other.id}`, {
        token: a,
        method: "PATCH",
        body: { title: "forged" },
      })
    ).status,
    404,
  ),
);
await check("Viewer can read all three synthetic requests", async () => {
  const r = await request("/items/requests?fields=id", { token: v });
  assert.equal(r.status, 200);
  assert.ok(r.data.some((x) => x.id === other.id));
});
await check("Viewer cannot create", async () =>
  assert.equal(
    (
      await request("/items/requests", {
        token: v,
        body: { title: "Blocked", message: "Blocked" },
      })
    ).status,
    403,
  ),
);
await check("Viewer cannot update", async () =>
  assert.equal(
    (
      await request(`/items/requests/${state.first}`, {
        token: v,
        method: "PATCH",
        body: { status: "closed" },
      })
    ).status,
    403,
  ),
);
await check("Agent cannot delete", async () =>
  assert.equal(
    (
      await request(`/items/requests/${state.first}`, {
        token: a,
        method: "DELETE",
      })
    ).status,
    403,
  ),
);
await check("Priority validation enforced on server", async () => {
  const r = await request(`/items/requests/${state.first}`, {
    token: a,
    method: "PATCH",
    body: { priority: 9 },
  });
  assert.equal(r.status, 400);
  assert.equal(r.code, "VALIDATION_FAILED");
});
await check("AI processor cannot read private field", async () =>
  assert.equal(
    (await request("/items/requests?fields=id,internal_note", { token: p }))
      .status,
    400,
  ),
);
await check("AI processor cannot write source message", async () =>
  assert.equal(
    (
      await request(`/items/requests/${state.first}`, {
        token: p,
        method: "PATCH",
        body: { message: "forged" },
      })
    ).status,
    403,
  ),
);
await check("AI processor cannot administer automations", async () =>
  assert.equal((await request("/automations", { token: p })).status, 403),
);
await check("Decimal is a string and JSON remains structured", async () => {
  const r = await request(
    `/items/requests/${state.first}?fields=id,estimate_hours,context`,
    { token: a },
  );
  assert.equal(r.data.estimate_hours, "1.50");
  assert.equal(r.data.context.source, "demo");
});
await check("Agent can create and update ordinary fields", async () => {
  const r = await request("/items/requests", {
    token: a,
    body: requestPayload({
      title: "Verification request",
      message: "Synthetic local integration check.",
      priority: "2",
      estimate_hours: "0.50",
    }),
  });
  assert.equal(r.status, 201);
  assert.equal(r.data.created_by, agent.user.id);
  assert.equal(
    (
      await request(`/items/requests/${r.data.id}`, {
        token: a,
        method: "PATCH",
        body: { status: "in_progress" },
      })
    ).status,
    200,
  );
});
if (state.rule) {
  await check("Native automation completes both example records", async () => {
    let complete = false;
    for (let i = 0; i < 30; i++) {
      const runs = await request(`/automations/${state.rule}/runs`, {
        token: t,
      });
      complete = [state.first, state.second].every((id) =>
        runs.data.some(
          (r) => String(r.item_key) === id && r.status === "succeeded",
        ),
      );
      if (complete) break;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    assert.ok(complete, "No successful native runs for both sample records");
    const item = await request(
      `/items/requests/${state.first}?fields=id,summary,sentiment`,
      { token: a },
    );
    assert.ok(item.data.summary);
    assert.ok(
      ["neutral", "positive", "negative"].includes(item.data.sentiment),
    );
    if (state.ai_mode === "fixture")
      assert.match(item.data.summary, /TEST FIXTURE/);
  });
}
await writeFile(
  ".verification.json",
  JSON.stringify(
    {
      checked_at: new Date().toISOString(),
      yunCMS: "0.1.37",
      ai_mode: state.ai_mode || "not-configured",
      checks: results,
    },
    null,
    2,
  ),
);
// Revoke only sessions created by this verification run.
for (const session of [admin, agent, viewer, processor])
  await request("/auth/logout", {
    token: session.access_token,
    body: { refresh_token: session.refresh_token },
  });
console.log(
  JSON.stringify({
    passed: results.length,
    origin,
    ai_mode: state.ai_mode || "not-configured",
  }),
);
