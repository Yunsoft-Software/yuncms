# Docker

AI automations run in the same container and persist their rules/queue in MySQL. See [AI Automations](ai-automations.md) for setup through Studio or MCP.

Need help deploying, integrating or migrating? [Contact Yunsoft](https://yunsoft.com/contact?utm_source=docker-docs&utm_medium=yuncms&utm_campaign=yuncms-services), [star YunCMS on GitHub](https://github.com/Yunsoft-Software/yuncms), or [sponsor YunCMS](https://github.com/sponsors/Yunsoft-Software).

YunCMS publishes a Linux container image at [`yunsoftofficial/yuncms`](https://hub.docker.com/r/yunsoftofficial/yuncms). The image contains the YunCMS CLI, the built React Studio and official native MySQL 8.4 client binaries (`mysql` and `mysqldump` copied from `mysql:8.4` for the target architecture, rather than Debian's `default-mysql-client` / MariaDB package). This ensures verified generated columns, check constraints, and UTF-8 characters during `backup` and `restore`.

The supported architectures are `linux/amd64` and `linux/arm64`. Use a version tag such as `0.1.31` for a controlled deployment. `latest` follows the newest published YunCMS release and is convenient for evaluation, but production deployments should not update implicitly.

## Requirements

- Docker Engine with the Compose plugin, or Docker Desktop;
- enough persistent storage for MySQL and local Files;
- a reverse proxy/TLS terminator for an internet-facing production deployment.

Node.js and npm are already included in the YunCMS image. The Compose stack supplies MySQL 8.4.

The runtime image uses the [Wolfi glibc base](https://images.chainguard.dev/directory/image/wolfi-base/overview). The official Node.js 24 binary and its bundled npm are copied from the official Node build stage; the official MySQL 8.4 clients retain their native glibc ABI. Studio and dependency builds use the official Node.js 24 Debian 13 (`trixie-slim`) image. Runtime builds apply signed APK repository upgrades and install only the required client libraries. SUID/SGID permission bits are removed from shipped files, and the unused `infocmp` command is excluded. Container extensions run with the same unprivileged UID/GID 1000 as YunCMS.

Wolfi is a rolling container distribution; the published YunCMS version tag captures a tested image. Replace the image when applying subsequent package updates. For an extension that requires additional operating-system commands, build a derived image with `apk add --no-cache <package>` as root during the build, then return to `USER node` and test its native dependencies. Debian `apt` package names and util-linux administration tools are not part of the runtime contract.

## Start with Docker Compose

Create an empty deployment directory and download the maintained Compose files:

```bash
mkdir my-yuncms
cd my-yuncms
curl -fsSLO https://raw.githubusercontent.com/Yunsoft-Software/yuncms/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Yunsoft-Software/yuncms/main/docker.env.example -o .env
```

Open `.env` and replace both example database passwords before starting anything. Keep the file out of source control and restrict who can read it.

Start MySQL first:

```bash
docker compose up -d mysql
```

Initialize YunCMS once:

```bash
docker compose run --rm yuncms init
```

Use these database answers when prompted:

| Prompt | Compose value |
| --- | --- |
| MySQL host | `mysql` |
| MySQL port | `3306` |
| MySQL database | `yuncms` |
| MySQL user | `yuncms` |
| MySQL password | the `YUNCMS_DB_PASSWORD` value from `.env` |
| Use MySQL TLS | `false` for the private Compose network |

Then enter the first Administrator email and password. Initialization writes the YunCMS project `.env`, local extensions and upload directory into the persistent `yuncms-data` volume.

Start YunCMS:

```bash
docker compose up -d yuncms
docker compose ps
```

Open `http://localhost:3008`. Studio and REST share the same listener. Verify both process and dependency readiness:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/ready
```

The image health check uses `/ready`, so Compose reports the container healthy only after MySQL and required shared state are reachable.

## Configuration

The provided stack sets the minimum container-specific values:

- `HOST=0.0.0.0` so the container accepts traffic;
- `DB_HOST=mysql` for the private Compose network;
- `FILES_LOCAL_ROOT=/data/uploads` for persistent local Files;
- `STUDIO_ORIGIN` and `AUTH_PUBLIC_URL` from `YUNCMS_PUBLIC_URL`.

Add other documented environment variables under `services.yuncms.environment` or through a Compose `env_file`. See [Configuration](configuration.md) for Redis, S3-compatible storage, SMTP, external authentication, rate limits and proxy settings.

For an HTTPS deployment, set `YUNCMS_PUBLIC_URL` to the external origin and `YUNCMS_TRUST_PROXY_HOPS` to the exact proxy-hop count. Do not expose the MySQL service port publicly.

## Persistent state

The maintained Compose file creates two named volumes:

| Volume | Contents |
| --- | --- |
| `mysql-data` | MySQL tables, including YunCMS metadata and dynamic collection tables |
| `yuncms-data` | project `.env`, local Files, extensions, AI settings key and local backups |

Deleting containers does not delete named volumes. `docker compose down -v` **does delete both volumes** and therefore destroys the database and local YunCMS state. Use it only when intentionally discarding an installation.

S3 objects are not stored in either volume. Back them up using the storage provider's versioning or snapshot facilities.

## CLI commands in the container

The image entrypoint is the normal `yuncms` CLI, so commands do not need an npm prefix:

```bash
docker compose run --rm yuncms help
docker compose run --rm yuncms bootstrap
docker compose run --rm yuncms backup
docker compose run --rm yuncms restore /data/.yuncms/backups/<backup> --yes
```

For backup, restore or schema migration maintenance, stop the normal service first:

```bash
docker compose stop yuncms
docker compose run --rm yuncms backup
```

Copy a completed local backup out of the volume before treating it as an independent backup:

```bash
docker compose cp yuncms:/data/.yuncms/backups ./backups
```

Also keep an independent MySQL/storage backup and follow [Upgrades](upgrades.md) and [Production Readiness](production-readiness.md).

## Update the container deployment

Container deployments update by replacing the image, not by running `yuncms update` inside an immutable image.

1. Stop the YunCMS service and create a verified backup with the currently pinned image.
2. Change `YUNCMS_IMAGE` in `.env` to the target version tag.
3. Pull the target image.
4. Run `bootstrap` once with the target image.
5. Start YunCMS and verify `/ready`, Administrator login, representative permissions and Files.

```bash
docker compose stop yuncms
docker compose run --rm yuncms backup
# Edit YUNCMS_IMAGE in .env, for example yunsoftofficial/yuncms:0.1.31
docker compose pull yuncms
docker compose run --rm yuncms bootstrap
docker compose up -d yuncms
curl http://localhost:3008/ready
```

Do not use a floating `latest` tag for unattended production updates. Review release notes and test the exact version in staging first.

### Generated columns and legacy MariaDB backups

Older container images or host environments that relied on Debian's `default-mysql-client` (MariaDB client tools) emitted invalid literal `INSERT` values for MySQL generated columns (such as `yuncms_roles.public_singleton`), causing MySQL `ERROR 3105` during `restore`. The YunCMS container now ships official native MySQL 8.4 client binaries. Upgrading the container image resolves client dump generation going forward, but does not repair already-faulty SQL dump files created by older MariaDB tools. After upgrading, recreate and test fresh backups using the updated container image.

## Build the image from source

From a YunCMS source checkout:

```bash
npm run docker:build
```

This builds the current architecture and tags both `yunsoftofficial/yuncms:<package-version>` and `yunsoftofficial/yuncms:latest`. To use another registry namespace:

The Studio is compiled on the builder's native platform, and its static files are shared between target images. Runtime dependencies are installed separately for each target architecture. Workspace-local `node_modules` directories are excluded from the build context, so local dependency installations cannot replace the image's clean dependency tree.

```bash
YUNCMS_DOCKER_IMAGE=your-account/yuncms npm run docker:build
```

Maintainers publish the multi-platform image with Buildx:

```bash
docker login
npm run docker:publish
```

Build commands use `--pull` to refresh upstream base images. Publishing targets `linux/amd64` and `linux/arm64`, includes OCI provenance/SBOM attestations, and pushes the versioned and `latest` tags. Set `YUNCMS_DOCKER_IMAGE` when publishing outside the official namespace.

## Scan operating-system packages

Install a current [Trivy release](https://github.com/aquasecurity/trivy/releases) and scan each architecture of the exact deployed image digest. Replace `<image-digest>` with the manifest digest reported by `docker buildx imagetools inspect yunsoftofficial/yuncms:<version>`:

```bash
trivy image --download-db-only
trivy image --image-src remote --platform linux/amd64 --scanners vuln --pkg-types os --ignorefile '' --format json --output os-amd64.json yunsoftofficial/yuncms@sha256:<image-digest>
trivy image --image-src remote --platform linux/arm64 --scanners vuln --pkg-types os --ignorefile '' --format json --output os-arm64.json yunsoftofficial/yuncms@sha256:<image-digest>
```

These commands retain all severities and unfixed findings. Record the image digest, scan time and `trivy version` database metadata with the reports. Verify the detected OS and package inventory as well as advisory status against the [Wolfi advisories](https://github.com/wolfi-dev/advisories) and [Trivy Wolfi coverage](https://trivy.dev/docs/latest/coverage/os/wolfi/). For older Debian images, use the [Debian Security Tracker](https://security-tracker.debian.org/tracker/). A source-package match may concern a binary or module that is absent from the image, while a deferred vendor fix still requires a documented risk assessment. Do not treat an empty report as proof that every component is secure.

An OS package scan covers APK-managed runtime packages. The installed APK database and package license metadata remain in the image for inventory and scanner coverage. The copied official MySQL client binaries, Node.js and its bundled libraries require their own upstream advisory review; npm dependencies require a separate npm audit. Host-kernel, container-engine and deployment configuration security also remain operator responsibilities. Apply later security releases by replacing the image using the update procedure above.

## Integration testing with Docker

YunCMS includes an opt-in end-to-end backup and restore regression fixture against disposable MySQL 8.4 containers. The fixture requires a prebuilt candidate image tag passed via `YUNCMS_TEST_DOCKER_IMAGE` and does not build or publish images itself:

```bash
# 1. Build the candidate container image from source
npm run docker:build

# 2. Run the guarded Docker backup and restore test
YUNCMS_TEST_DOCKER=1 YUNCMS_TEST_DOCKER_IMAGE=yunsoftofficial/yuncms:0.1.31 node --test test/integration/docker-backup-restore.test.js
```

The fixture provisions an isolated Docker network, a disposable MySQL 8.4 instance, and dedicated volumes. It tests `bootstrap`, generated `STORED` and `VIRTUAL` columns, system roles, and uploaded files, executes `backup`, mutates state, executes `restore --yes`, and verifies that all schema constraints, computed columns, roles, and file payloads are preserved.
