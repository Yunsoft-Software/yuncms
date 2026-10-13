import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  bootstrapDatabase,
  createDatabasePool,
  closeDatabasePool,
  loadConfig,
  createInitialAdmin,
  createSystemAccountability,
  SchemaCache,
  CollectionsService,
  FieldsService,
  RelationsService,
  RolesService,
  UsersService,
  PermissionsService,
  ItemsService,
  ensurePublicRole,
} from "@yunsoft/yuncms-core";
import {
  collections,
  requestFields,
  editableFields,
  ownRows,
  requestValidation,
} from "./model.mjs";

const config = loadConfig(process.env);
if (
  !/^yuncms_example_dev_[a-z0-9_]+$/.test(config.database.database) ||
  process.env.EXAMPLE_SETUP_CONFIRM !== "empty-example-database"
) {
  throw new Error(
    "Setup requires an empty yuncms_example_dev_* database and EXAMPLE_SETUP_CONFIRM=empty-example-database",
  );
}
const database = createDatabasePool(config.database);
try {
  const [tables] = await database.query("SHOW TABLES");
  if (tables.length)
    throw new Error(
      "Database is not empty. Choose a new empty example database; no data was changed.",
    );
  await bootstrapDatabase(database);
  await ensurePublicRole(database); // Deliberately grant no anonymous data access.
  const options = {
    database,
    accountability: createSystemAccountability(),
    schemaCache: new SchemaCache({ versionCheckTtlMs: 0 }),
  };
  const password = () => randomBytes(24).toString("base64url");
  const accounts = {
    admin: { email: "admin@example.test", password: password() },
  };
  await createInitialAdmin(database, accounts.admin);
  const roles = new RolesService(options),
    users = new UsersService(options),
    permissions = new PermissionsService(options);
  const roleIds = {};
  for (const [key, name] of [
    ["agent", "Support Agent"],
    ["viewer", "Read-only Viewer"],
    ["processor", "AI Processor"],
  ]) {
    const role = await roles.createOne({ name });
    roleIds[key] = role.id;
    accounts[key] = { email: `${key}@example.test`, password: password() };
    const user = await users.createOne({
      ...accounts[key],
      role: role.id,
      status: "active",
      first_name: name,
    });
    accounts[key].id = user.id;
  }
  const cs = new CollectionsService(options),
    fs = new FieldsService(options),
    rs = new RelationsService(options);
  for (const spec of collections) {
    await cs.createOne({
      collection: spec.collection,
      name: spec.name,
      systemFields: ["created_at", "updated_at", "created_by", "updated_by"],
    });
    for (const field of spec.fields) await fs.createOne(spec.collection, field);
  }
  await rs.createM2O({
    manyCollection: "requests",
    manyField: "category_id",
    oneCollection: "categories",
    onDelete: "SET NULL",
  });
  await rs.createM2O({
    manyCollection: "comments",
    manyField: "request_id",
    oneCollection: "requests",
    onDelete: "CASCADE",
  });
  const grant = (role, collection, action, fields, extra = {}) =>
    permissions.createOne({
      role: roleIds[role],
      collection,
      action,
      fields,
      ...extra,
    });
  for (const role of ["agent", "viewer"]) {
    await grant(role, "categories", "read", ["id", "name", "color"]);
    await grant(
      role,
      "requests",
      "read",
      requestFields,
      role === "agent" ? { filter: ownRows } : {},
    );
    await grant(
      role,
      "comments",
      "read",
      ["id", "request_id", "body", "created_at", "created_by"],
      role === "agent" ? { filter: ownRows } : {},
    );
  }
  await grant("agent", "requests", "create", editableFields, {
    validation: requestValidation,
  });
  await grant("agent", "requests", "update", editableFields, {
    filter: ownRows,
    validation: requestValidation,
  });
  // Comment creation is omitted: this minimal app demonstrates reverse reads without accepting arbitrary relation IDs.
  await grant("processor", "requests", "read", [
    "id",
    "message",
    "summary",
    "sentiment",
  ]);
  await grant("processor", "requests", "update", ["summary", "sentiment"], {
    validation: { sentiment: { _in: ["neutral", "positive", "negative"] } },
  });
  const categories = new ItemsService("categories", options);
  const technical = await categories.createOne({
    name: "Technical",
    color: "#4967e8",
  });
  const billing = await categories.createOne({
    name: "Billing",
    color: "#a25bd6",
  });
  const requests = new ItemsService("requests", {
    ...options,
    accountability: {
      user: accounts.agent.id,
      role: roleIds.agent,
      admin: false,
    },
  });
  const first = await requests.createOne({
    title: "Export stops at the last step",
    message:
      "The CSV export stops after choosing a date range. I tried again in another browser and the same issue occurs. Please help us complete the monthly report.",
    category_id: technical.id,
    priority: 4,
    estimate_hours: "1.50",
    due_date: "2026-10-20",
    context: { browser: "Chrome", source: "demo" },
  });
  const second = await requests.createOne({
    title: "Where can I find my invoice?",
    message:
      "The payment succeeded, but I cannot find the invoice in the account page. Could you tell me where to download it?",
    category_id: billing.id,
    priority: 2,
    estimate_hours: "0.25",
    due_date: "2026-10-22",
    context: { source: "demo" },
  });
  // Only synthetic setup data uses explicit system accountability.
  await new ItemsService("comments", {
    ...options,
    accountability: { ...options.accountability, user: accounts.agent.id },
  }).createOne({
    request_id: first.id,
    body: "Reproduced using the demo dataset. Checking the export response.",
  });
  await new ItemsService("requests", options).createOne({
    title: "Another account’s request",
    message: "This synthetic record demonstrates row isolation.",
    status: "open",
    priority: 1,
    internal_note: "Synthetic administrator-only field.",
  });
  await writeFile(".demo-accounts.json", JSON.stringify(accounts, null, 2), {
    mode: 0o600,
  });
  await writeFile(
    ".demo-state.json",
    JSON.stringify(
      { first: first.id, second: second.id, processor: accounts.processor.id },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Created 3 collections, 2 relations and 3 ordinary roles. Random local credentials saved in ignored .demo-accounts.json (0600).",
  );
} finally {
  await closeDatabasePool(database);
}
