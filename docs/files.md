# Files and Storage

YunCMS V1 coordinates file metadata in MySQL with pluggable storage drivers.

## Storage contract

Core file I/O drivers implement:

```text
put(key, contents)
get(key)
delete(key)
stat(key)
getSignedUrl(key)   # may return null when API proxy download is used
```

Built-in local and S3-compatible drivers additionally implement `list()` for maintenance inventory/reconciliation. Third-party drivers may omit inventory support; reconciliation then fails explicitly with `STORAGE_INVENTORY_UNSUPPORTED` rather than pretending it can inspect the backend.

Configured drivers are available through the storage registry and trusted extension contexts.

## Local storage

```text
FILES_LOCAL_ROOT=.yuncms/uploads
FILES_MAX_UPLOAD_BYTES=26214400
```

Physical keys are generated UUIDs. User-visible filenames never become filesystem paths.

The local driver accepts only restricted single-segment keys, performs platform-aware containment checks and lists only valid regular-file storage keys during reconciliation.

## S3-compatible storage

```text
S3_BUCKET=
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

When `S3_BUCKET` is configured YunCMS registers an `s3` driver in addition to `local`.

The driver uses AWS SDK v3, supports custom endpoints/path-style addressing and uses the SDK credential chain when explicit credentials are absent. Inventory uses paginated `ListObjectsV2`; a truncated response without a continuation token fails explicitly.

Downloads currently proxy through the authenticated API, so signed URLs are optional and return `null` in the built-in drivers.

## FilesService

`FilesService` is administrator/system-only in V1.

It coordinates:

- metadata list/read;
- upload/storage write;
- content read;
- metadata update;
- delete/storage cleanup.

Upload writes the storage object before the metadata row. If metadata insert fails, YunCMS attempts to remove the new object.

Delete removes metadata and then the storage object. A post-metadata storage cleanup failure raises `FILE_STORAGE_CLEANUP_FAILED` rather than hiding an orphan.

File lifecycle operations emit `files.create`, `files.update` and `files.delete` for trusted hooks/audit.

## REST API

```text
GET    /files
POST   /files
POST   /files/reconcile
GET    /files/:id
GET    /files/:id/content
PATCH  /files/:id
DELETE /files/:id
```

Upload uses raw `application/octet-stream` plus headers:

```text
X-Filename: <URL-encoded user-visible filename>
X-Mimetype: application/pdf
X-Title: optional title
```

Select storage with:

```text
POST /files?storage=local
POST /files?storage=s3
```

The upload body is capped by `FILES_MAX_UPLOAD_BYTES`; overflow maps to HTTP 413.

## Inventory and reconciliation

`FileReconciliationService` and `POST /files/reconcile` compare DB metadata with the selected storage inventory.

Default behavior is **dry-run**:

```json
{
  "storage": "local",
  "deleteOrphans": false,
  "minimumAgeMs": 3600000
}
```

The result reports:

- metadata rows whose storage object is missing;
- storage objects with no metadata row;
- orphan objects eligible for guarded deletion;
- objects actually deleted when destructive cleanup is requested.

Safety rules:

- reconciliation requires admin/system accountability;
- it never automatically deletes a DB metadata row because an object is missing;
- `deleteOrphans` is false unless explicitly requested;
- orphan deletion requires a known `modifiedAt` and an age at least the configured/requested guard;
- default orphan age guard is one hour, protecting the upload race where storage is written before DB metadata;
- V1 refuses inventories above 100,000 objects rather than doing an unbounded maintenance pass.

Operators should still investigate `FILE_STORAGE_CLEANUP_FAILED` and reconciliation drift instead of treating cleanup as a substitute for storage monitoring/backups.

## Verification

Real filesystem permissions, Unicode names, upload limits, reconciliation race behavior and the actual production S3-compatible provider remain manual/integration checks in `todo.md`.
