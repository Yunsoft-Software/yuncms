# Docker

YunCMS publishes a Linux container image at [`yunsoftofficial/yuncms`](https://hub.docker.com/r/yunsoftofficial/yuncms). The image contains the YunCMS CLI, the built React Studio and the MySQL client tools required by `backup` and `restore`.

The supported architectures are `linux/amd64` and `linux/arm64`. Use a version tag such as `0.1.22` for a controlled deployment. `latest` follows the newest published YunCMS release and is convenient for evaluation, but production deployments should not update implicitly.

## Requirements

- Docker Engine with the Compose plugin, or Docker Desktop;
- enough persistent storage for MySQL and local Files;
- a reverse proxy/TLS terminator for an internet-facing production deployment.

Node.js and npm are already included in the YunCMS image. The Compose stack supplies MySQL 8.4.

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
# Edit YUNCMS_IMAGE in .env, for example yunsoftofficial/yuncms:0.1.22
docker compose pull yuncms
docker compose run --rm yuncms bootstrap
docker compose up -d yuncms
curl http://localhost:3008/ready
```

Do not use a floating `latest` tag for unattended production updates. Review release notes and test the exact version in staging first.

## Build the image from source

From a YunCMS source checkout:

```bash
npm run docker:build
```

This builds the current architecture and tags both `yunsoftofficial/yuncms:<package-version>` and `yunsoftofficial/yuncms:latest`. To use another registry namespace:

```bash
YUNCMS_DOCKER_IMAGE=your-account/yuncms npm run docker:build
```

Maintainers publish the multi-platform image with Buildx:

```bash
docker login
npm run docker:publish
```

Publishing targets `linux/amd64` and `linux/arm64`, includes OCI provenance/SBOM attestations, and pushes the versioned and `latest` tags. Set `YUNCMS_DOCKER_IMAGE` when publishing outside the official namespace.
