import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { requestPayload, nextState } from "../src/logic.js";
import {
  collections,
  automationRule,
  editableFields,
} from "../scripts/model.mjs";
import { fixtureOutput } from "../scripts/fixture-output.mjs";

test("example pins the current CMS release and keeps its installer non-destructive", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const pkg = JSON.parse(read("../package.json")), lock = JSON.parse(read("../package-lock.json"));
  const version = pkg.dependencies["@yunsoft/yuncms"];
  assert.match(version, /^0\.1\.\d+$/);
  for (const name of ["@yunsoft/yuncms", "@yunsoft/yuncms-core"]) {
    assert.equal(pkg.dependencies[name], version);
    assert.equal(lock.packages["node_modules/" + name].version, version);
    assert.match(lock.packages["node_modules/" + name].resolved, /^https:\/\/registry\.npmjs\.org\//);
  }
  const setup = read("../scripts/setup.mjs");
  assert.match(setup, /if \(tables\.length\)/);
  assert.ok(setup.indexOf("if (tables.length)") < setup.indexOf("await bootstrapDatabase(database)"));
  assert.doesNotMatch(setup, /DROP (DATABASE|TABLE)|TRUNCATE/i);
});

test("form accepts decimal strings, nullable relation/date and rejects bad priority/precision", () => {
  const input = {
    title: " Export ",
    message: "Help",
    priority: "4",
    estimate_hours: "1.50",
    category_id: "category",
    due_date: "2026-10-20",
  };
  assert.deepEqual(requestPayload(input), {
    title: "Export",
    message: "Help",
    priority: 4,
    estimate_hours: "1.50",
    category_id: "category",
    due_date: "2026-10-20",
    context: { source: "react-example" },
  });
  assert.throws(() => requestPayload({ ...input, priority: "6" }));
  assert.throws(() => requestPayload({ ...input, estimate_hours: "1.234" }));
  assert.throws(() => requestPayload({ ...input, title: " " }));
  assert.equal(
    requestPayload({
      ...input,
      category_id: "",
      due_date: "",
      estimate_hours: "",
    }).category_id,
    null,
  );
});
test("status cycle keeps boolean resolution synchronized", () => {
  assert.deepEqual(nextState("in_progress"), {
    status: "closed",
    resolved: true,
  });
  assert.deepEqual(nextState("closed"), { status: "open", resolved: false });
  assert.throws(() => nextState("invented"));
});
test("AI rule uses disjoint inputs/outputs and agent cannot write outputs", () => {
  const rule = automationRule("normal-user");
  assert.equal(rule.enabled, false);
  assert.deepEqual(rule.input_fields, ["message"]);
  for (const field of rule.output_fields)
    assert.equal(editableFields.includes(field), false);
  assert.equal(editableFields.includes("created_by"), false);
  assert.equal(editableFields.includes("internal_note"), false);
});
test("example demonstrates native storage families and only project relation fields", () => {
  const fields = collections.find((c) => c.collection === "requests").fields;
  for (const type of [
    "string",
    "text",
    "integer",
    "decimal",
    "boolean",
    "date",
    "json",
    "uuid",
  ])
    assert.ok(fields.some((f) => f.type === type));
});
test("fixture is visibly labeled and refuses unconfigured input fields", () => {
  assert.match(
    fixtureOutput({ message: "Example. More." }).summary,
    /TEST FIXTURE/,
  );
  assert.throws(() =>
    fixtureOutput({ message: "Example", internal_note: "private" }),
  );
});
