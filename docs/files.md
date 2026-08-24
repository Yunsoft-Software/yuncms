# Files and Storage

YunCMS Files combines metadata stored in MySQL with binary objects stored by a registered storage driver. The built-in drivers are local filesystem storage and S3-compatible object storage.

Files can be managed from Studio's **Files** screen or through the REST API. File/Image fields in project collections store a UUID that points to a Files record.

## Permissions

Files is an explicitly permission-managed system resource. It is not restricted to Administrator-only use.

Use the `yuncms_files` resource in role permissions to grant the actions a role needs:

- `read` — list metadata, read metadata and download content;
- `create` — upload files;
- `update` — edit permitted file metadata;
- `delete` — remove permitted files.

The Public role can also receive an intentional Files read grant. This is useful for public image galleries, public downloads or site assets. Public access remains deny-by-default until you create that permission.

Files read permissions can include a row filter, so a public or normal role can expose only a bounded subset of file records rather than the entire library. The same effective read permission is enforced for `/files/:id/content`; hiding metadata while leaving the binary publicly readable is not a bypass.

Administrative/system accountability can perform maintenance operations such as reconciliation.

See [Roles and permissions](permissions.md).

## Studio Files library

Open **Files** in Studio to browse uploaded assets. The Files UI supports gallery-oriented browsing and media previews for supported image/media types, along with the metadata actions allowed by the current role.

Typical workflow:

1. upload an asset to the selected storage driver;
2. set a human title/filename and MIME type;
3. preview or download it from the library;
4. select it from a collection field whose interface is `file` or `image`.

Deleting a Files record is a real storage operation, not merely hiding the asset from Studio.

## REST endpoints

```text
GET    /files
POST   /files
POST   /files/reconcile
GET    /files/:id
GET    /files/:id/content
PATCH  /files/:id
DELETE /files/:id
```

Authenticated requests normally send:

```http
Authorization: Bearer <access-token-or-api-token>
```

If the Public role has the required read permission, the read/content endpoints can also be used without a Bearer token.

## Upload a file

Upload bytes directly instead of base64-encoding them in JSON:

```bash
curl 'http://localhost:3008/files?storage=local' \
  -X POST \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-Filename: product-photo.png' \
  -H 'X-Mimetype: image/png' \
  -H 'X-Title: Product photo' \
  --data-binary '@./product-photo.png'
```

Upload headers:

```text
X-Filename: URL-encoded user-visible filename
X-Mimetype: MIME type
X-Title: optional human title
```

Choose a registered driver with the `storage` query parameter:

```text
POST /files?storage=local
POST /files?storage=s3
```

The request body is capped by `FILES_MAX_UPLOAD_BYTES`; an oversized body returns HTTP 413.

YunCMS generates the physical object key. User-visible filenames are metadata and do not become arbitrary filesystem paths.

## List and read metadata

```bash
curl 'http://localhost:3008/files' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Read one:

```bash
curl 'http://localhost:3008/files/FILE_ID' \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

Only records allowed by the effective Files read permission/row filter are returned.

## Download content

```bash
curl 'http://localhost:3008/files/FILE_ID/content' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  --output downloaded-file.bin
```

Built-in storage drivers currently proxy downloads through the YunCMS API. This keeps the Files permission check authoritative for both local and S3-compatible storage.

## Update metadata

```bash
curl 'http://localhost:3008/files/FILE_ID' \
  -X PATCH \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"Homepage hero image"}'
```

The current role must have Files update access to the target record.

## Delete

```bash
curl 'http://localhost:3008/files/FILE_ID' \
  -X DELETE \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

YunCMS removes the metadata and then cleans up the storage object. If metadata deletion succeeds but storage cleanup fails, the API reports `FILE_STORAGE_CLEANUP_FAILED` so operators can investigate the orphan instead of silently ignoring it.

File lifecycle operations emit `files.create`, `files.update` and `files.delete` events for trusted extension/audit consumers.

# Storage drivers

## Local storage

```env
FILES_LOCAL_ROOT=.yuncms/uploads
FILES_MAX_UPLOAD_BYTES=26214400
```

The default upload limit is 25 MiB.

The local driver restricts physical keys to safe single-segment storage keys and checks path containment before filesystem access. If you use local storage in production, the upload directory is production data and must be included in backup/restore procedures.

## S3-compatible storage

```env
S3_BUCKET=your-bucket
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

When `S3_BUCKET` is configured, YunCMS registers an `s3` driver in addition to `local`.

Custom endpoints and path-style addressing allow compatible object-storage providers. If explicit access-key variables are omitted, the AWS SDK credential chain can be used where the deployment environment provides credentials.

## Storage contract for extensions

Built-in storage drivers implement the runtime operations needed by Files:

```text
put(key, contents)
get(key)
delete(key)
stat(key)
getSignedUrl(key)
```

Built-in local and S3 drivers also support inventory listing used by reconciliation. A storage implementation that cannot list inventory fails reconciliation explicitly rather than pretending the storage has no orphan objects.

# Reconciliation

`POST /files/reconcile` compares Files metadata with a storage inventory. It is an administrative maintenance operation and is dry-run by default.

```bash
curl 'http://localhost:3008/files/reconcile' \
  -X POST \
  -H 'Authorization: Bearer ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "storage":"local",
    "deleteOrphans":false,
    "minimumAgeMs":3600000
  }'
```

The result identifies:

- metadata records whose object is missing;
- storage objects without metadata;
- orphan objects old enough to be eligible for cleanup;
- objects actually deleted when destructive cleanup is requested.

Safety behavior:

- reconciliation never automatically deletes database metadata simply because a storage object is missing;
- `deleteOrphans` defaults to false;
- orphan deletion requires known modification time and the requested/default minimum age;
- the default one-hour age guard protects the upload window where object storage is written before metadata is committed;
- inventories above the bounded maintenance limit are rejected instead of processed without a limit.

Treat reconciliation as a drift-repair tool, not a substitute for backups or storage monitoring.

# Public gallery example

For a public website gallery, a common pattern is:

1. grant the Public role `read` on `yuncms_files`;
2. add a restrictive Files row filter that matches only assets intended for public use;
3. store those Files UUIDs in your gallery/content collection;
4. grant Public read access to that collection too;
5. fetch collection records and their file ids from your frontend, then request `/files/:id/content`.

Do not grant unrestricted Public Files read merely because one image must be public.

## Related guides

- [Roles and permissions](permissions.md)
- [Data model](data-model.md)
- [REST API](rest-api.md)
- [Configuration](configuration.md)
- [Deployment](deployment.md)
