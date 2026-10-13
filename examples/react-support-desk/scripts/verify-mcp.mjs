import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { login, request, origin } from "./http.mjs";
const admin = await login("admin"),
  agent = await login("agent");
const checks = [];
async function call(method, params, token, host) {
  if (host) {
    // Fetch may normalize Host. Raw HTTP sends the exact hostile Host being tested.
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        origin + "/mcp",
        {
          method: "POST",
          headers: {
            host,
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            authorization: `Bearer ${token}`,
          },
        },
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            try {
              resolve({ status: res.statusCode, payload: JSON.parse(raw) });
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on("error", reject);
      req.end(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }));
    });
  }
  const res = await fetch(origin + "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(host ? { host } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const raw = await res.text();
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  return {
    status: res.status,
    payload: raw ? JSON.parse(dataLine ? dataLine.slice(6) : raw) : null,
  };
}
try {
  const configured = await request("/mcp/settings", {
    token: admin.access_token,
    method: "PATCH",
    body: {
      enabled: true,
      writes_enabled: false,
      require_authentication: true,
      allowed_hosts: [new URL(origin).host],
      allowed_origins: [],
    },
  });
  assert.equal(configured.status, 200);
  const list = await call("tools/list", {}, agent.access_token);
  assert.equal(list.status, 200);
  const names = list.payload.result.tools.map((t) => t.name);
  assert.ok(names.includes("items.read_many"));
  assert.equal(names.includes("items.create"), false);
  assert.equal(
    names.some((n) => n.startsWith("automations.")),
    false,
  );
  checks.push(
    "Ordinary agent receives read tools without writes or automation administration",
  );
  const schema = await call(
    "tools/call",
    {
      name: "schema.describe_collection",
      arguments: { collection: "requests" },
    },
    agent.access_token,
  );
  assert.equal(schema.status, 200);
  assert.equal(schema.payload.result.isError, undefined);
  assert.equal(
    JSON.stringify(schema.payload.result).includes("internal_note"),
    false,
  );
  checks.push("MCP schema respects hidden fields");
  const records = await call(
    "tools/call",
    {
      name: "items.read_many",
      arguments: { collection: "requests", fields: "id,created_by", limit: 25 },
    },
    agent.access_token,
  );
  assert.equal(records.status, 200);
  const parsed = JSON.parse(
    records.payload.result.content.find((c) => c.type === "text").text,
  );
  // MCP wraps the Items {data,meta} result inside its own {data} envelope.
  const rows = parsed.data.data;
  assert.ok(rows.length);
  assert.ok(rows.every((row) => row.created_by === agent.user.id));
  checks.push("MCP item reads preserve own-row scope");
  assert.ok([401, 403].includes((await call("tools/list", {})).status));
  checks.push("Anonymous MCP denied");
  assert.equal(
    (await call("tools/list", {}, agent.access_token, "untrusted.example"))
      .status,
    403,
  );
  checks.push("Unallowlisted Host denied");
  await writeFile(
    ".verification-mcp.json",
    JSON.stringify(
      { checked_at: new Date().toISOString(), passed: checks.length, checks },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length, writes_enabled: false }));
} finally {
  for (const s of [admin, agent])
    await request("/auth/logout", {
      token: s.access_token,
      body: { refresh_token: s.refresh_token },
    });
}
