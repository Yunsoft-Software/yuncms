# Files and Storage

YunCMS V1 coordinates file metadata in MySQL with pluggable storage drivers.

## Storage contract

A driver implements:

```text
put(key, contents)
get(key)
delete(key)
stat(key)
getSignedUrl(key)   # may return null when proxy download is used
```

Configured drivers are exposed through one storage registry and are also available to trusted extension service contexts.

## Local storage

Default configuration:

```text
FILES_LOCAL_ROOT=.yuncms/uploads
FILES_MAX_UPLOAD_BYTES=26214400
```

Physical storage keys are generated UUIDs. The user-visible filename never becomes a filesystem path.

The local driver only accepts a restricted single-segment storage key and rejects traversal/path separators before filesystem access. Path containment is checked with platform-aware path resolution/relative logic.

## S3-compatible storage

Optional configuration:

```text
S3_BUCKET=
S3_REGION=us-east-1
S3_ENDPOINT=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false
```

When `S3_BUCKET` is configured, YunCMS registers an `s3` driver in addition to `local`.

The driver uses AWS SDK v3 and supports custom S3-compatible endpoints/path-style addressing for providers that require them. If explicit access/secret keys are omitted, the SDK's normal credential provider behavior is used.

YunCMS currently proxies authenticated downloads through the API, so the S3 driver's `getSignedUrl()` can remain `null` in V1.

## FilesService

`FilesService` is administrator/system-only in V1.

It coordinates:

- metadata list/read;
- upload/storage write;
- content read;
- safe metadata update;
- delete/storage cleanup.

Upload order is storage object first, then metadata row. If the metadata insert fails, YunCMS attempts to remove the newly written object.

Delete removes metadata and then the storage object. If storage cleanup fails after metadata deletion, YunCMS raises `FILE_STORAGE_CLEANUP_FAILED` rather than pretending the orphan disappeared.

File lifecycle operations emit:

```text
files.create
files.update
files.delete
```

Those events are available to trusted hooks and are consumed by the internal audit subscriber.

## REST API

```text
GET    /files
POST   /files
GET    /files/:id
GET    /files/:id/content
PATCH  /files/:id
DELETE /files/:id
```

Upload body is raw `application/octet-stream`.

Headers:

```text
X-Filename: <URL-encoded user-visible filename>
X-Mimetype: application/pdf
X-Title: optional title
```

Driver selection:

```text
POST /files?storage=local
POST /files?storage=s3
```

The API caps request body size with `FILES_MAX_UPLOAD_BYTES` and returns HTTP 413 when exceeded.

Downloads use an authenticated request and a safe `Content-Disposition` header with an RFC 5987-style UTF-8 filename parameter.

## Reconciliation

V1 already exposes cleanup failure explicitly instead of silently swallowing metadata/storage drift. A full storage inventory reconciliation command (finding every storage object with no metadata row) is still a follow-up capability because the minimal driver contract does not require object listing.

Until that command exists, production operators should treat any `FILE_STORAGE_CLEANUP_FAILED` log/error as an explicit reconciliation item.

## Verification

Real local filesystem permissions, Unicode download names, upload limits, cleanup failure behavior and the actual intended S3-compatible provider are all listed in `todo.md` for local/integration verification.
