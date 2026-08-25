# Data Model Guide

YunCMS stores project content in MySQL collections. A collection has a stable API/database key, a human-readable display name, fields and optional relations. Studio's **Data Model** screen is the normal place to build and maintain this structure; the same operations are also available through the schema REST API.

![YunCMS Data Model with navigation folders, ordering and visibility controls](assets/screenshots/studio-data-model.png)

## Understand the Data Model list

The landing screen combines schema navigation with Content-menu presentation:

- **Create collection** adds a MySQL-backed project collection;
- **Create folder** adds a presentation-only navigation group;
- the collection icon and name open its fields/relations/settings;
- the `1` control toggles supported single-item presentation;
- the eye controls whether the collection appears under Content;
- a crossed-out eye means the collection is hidden from Content;
- the six-dot handle reorders a collection/folder or moves a collection into a folder.

Dragging near the top or bottom edge of a row changes order. Dropping over the highlighted center of a folder moves the collection into that folder. The helper text under the list summarizes the same behavior in Studio.

Folders, order and visibility are interface metadata. They never grant data access; Roles & Permissions remains authoritative.

## Collection names and API keys

Keep the human label separate from the machine key:

```json
{
  "name": "Customer Requests",
  "collection": "customer_requests"
}
```

`name` is what people see in Studio. `collection` is the stable identifier used by REST URLs, permissions, extensions and MySQL. Renaming the display name does not rename the API key or table.

A collection can also carry a note, navigation/display metadata, visibility settings and selected system fields.

## Create a collection in Studio

1. Open **Settings → Data Model**.
2. Choose **New collection**.
3. Enter a display name and confirm or edit the generated API key.
4. Select any system fields you want YunCMS to maintain automatically.
5. Create the collection, then add normal fields and relations.

After creation, return to the landing list when you want to place the collection in a folder, change its order or hide it from Content. Open the collection itself when you want to change fields, relations or collection settings.

Use stable lowercase API keys such as `orders`, `customer_requests` and `invoice_lines`. Treat an API key as part of your integration contract after external applications begin using it.

## Supported field types

| YunCMS type | MySQL storage | Typical use |
| --- | --- | --- |
| `integer` | `INT` | quantities, counters |
| `bigint` | `BIGINT` | large integer identifiers/counters |
| `decimal` | `DECIMAL(p,s)` | money and exact decimal values |
| `string` | `VARCHAR(n)` | names, codes, short text |
| `text` | `TEXT` | long-form text |
| `boolean` | `TINYINT(1)` | yes/no state |
| `date` | `DATE` | calendar date without time |
| `datetime` | `DATETIME(3)` | date/time value |
| `timestamp` | `TIMESTAMP(3)` | timestamp values and automatic time presets |
| `json` | `JSON` | structured JSON data |
| `uuid` | `CHAR(36)` | UUID values, relations and Files-backed controls |

### String length

`string` defaults to 255 characters and supports lengths from 1 to 4096.

### Decimal precision and scale

`decimal` defaults to precision 18 and scale 2. Precision may be 1–65, scale 0–30, and scale cannot be larger than precision.

```json
{
  "name": "Total",
  "field": "total",
  "type": "decimal",
  "precision": 12,
  "scale": 2
}
```

### Required and default values

Set `required: true` when a field must be non-null. Normal scalar fields can have literal defaults where supported.

`datetime` and `timestamp` fields can use the current-time preset:

```json
{
  "field": "published_at",
  "type": "datetime",
  "defaultPreset": "now"
}
```

They can also use `autoUpdate: true` when the value should be refreshed by MySQL whenever the row changes.

Literal defaults for `text` and `json` are not part of the current field contract.

## Display interfaces

Storage type and Studio interface are separate concepts. For example, a UUID field can be presented as a normal UUID input, a File picker or an Image picker.

File control:

```json
{
  "name": "Attachment",
  "field": "attachment",
  "type": "uuid",
  "interface": "file"
}
```

Image control:

```json
{
  "name": "Cover Image",
  "field": "cover_image",
  "type": "uuid",
  "interface": "image",
  "options": {
    "accept": "image/*",
    "preview": true
  }
}
```

`file` and `image` interfaces require UUID storage and select records from the YunCMS Files library.

## System fields

A project collection may opt into any of these fields at creation time:

| Field | Behavior |
| --- | --- |
| `created_at` | timestamp set when a record is created |
| `updated_at` | timestamp set on create and update |
| `created_by` | current authenticated user on create |
| `updated_by` | current authenticated user on create/update |

These fields are read-only and maintained by YunCMS. User fields must not try to overwrite them. User-reference fields use foreign keys to the users resource and become `null` if the referenced user is removed.

## Relations

Relations use collection/field API keys. Relation expansion and permissions are handled by the same Items service used for ordinary reads.

### Many-to-one (M2O)

Example: many articles belong to one author.

```json
{
  "manyCollection": "articles",
  "manyField": "author_id",
  "oneCollection": "authors",
  "onDelete": "SET NULL"
}
```

The physical foreign-key field lives on the many side. Read it as an object by projecting target fields:

```text
GET /items/articles?fields=id,title,author_id.name
```

### One-to-one (O2O)

One-to-one uses the same many/one declaration but YunCMS also enforces uniqueness on the relation field. The direct side returns an object or `null`, and the reverse virtual side also returns one object or `null`.

### Reverse one-to-many (O2M)

You do not create a second physical foreign key for the reverse view. If `comments.article_id` points to `articles.id`, YunCMS exposes a virtual reverse relation on articles:

```text
GET /items/articles?fields=id,title,comments.text
```

That alias returns an array. Relation metadata may explicitly define a safe reverse alias; otherwise YunCMS derives one and avoids collisions with physical field names.

### Many-to-many (M2M)

Many-to-many uses a managed junction collection. Example:

```json
{
  "junctionCollection": "article_tags",
  "leftCollection": "articles",
  "rightCollection": "tags"
}
```

Consumers query the virtual target relation instead of manually assembling junction rows:

```text
GET /items/articles?fields=id,title,tags.id,tags.name
```

The junction remains part of authorization: a caller must be allowed to read the source, junction and target data required for the projection.

## Relation deletion behavior

Choose foreign-key deletion behavior deliberately. For example, `SET NULL` preserves the child row when the parent is removed while clearing its relation. Destructive schema removal is separately guarded by schema-admin permissions and explicit destructive flags on relevant REST endpoints.

## Nested relation reads

Relation selection supports nested paths up to four levels:

```text
fields=id,author_id.company_id.country_id.name
```

Use `*.*` when you want all readable scalar root fields plus all readable first-level relations:

```text
fields=*.*
```

This is still bounded by field, relation-node, relation-row and query-cost limits. See [Items query language](api-query-language.md).

## Singletons

A collection can be presented as a singleton when your application needs exactly one logical record, such as site settings or company profile data. Studio routes singleton collections directly to their record-oriented editing experience rather than presenting them as a normal list.

Permissions still apply to the underlying collection and record.

## Collection visibility and navigation

Collection visibility in Studio is presentation, not authorization. Hiding a collection from navigation does not grant or revoke API access; roles and permissions remain authoritative.

Studio supports organizing visible collections into navigation groups and saving their order/collapse presentation. A user still sees only the sections and data their effective access permits.

Use a hidden collection for internal/junction/supporting data that should not clutter Content. The row remains visible in Data Model, appears dimmed and uses the crossed-out eye so Administrators can restore it without guessing where it went.

## Changing schema safely

Display-only metadata changes are different from physical MySQL schema changes. Changes such as nullability/index-related schema settings use the schema mutation path and should be treated as database changes.

Before deleting a field, collection or managed junction from a production project:

1. back up the database/project;
2. confirm no API client, extension or relation still depends on the key;
3. use the explicit destructive schema operation;
4. verify affected permissions and Studio views afterward.

## Related guides

- [Using Studio](studio.md)
- [REST API](rest-api.md)
- [Items query language](api-query-language.md)
- [Roles and permissions](permissions.md)
- [Files](files.md)
