# Installation Guide (YunCMS 2.1.4)

> **Published Version:** `YunCMS 2.1.4` · **Git Tag:** `v2.1.4` · **Commit:** `6bb66f3fdfefe2f27bde7c2d96f9c494d1c2c45e`

This guide covers installing the published **YunCMS 2.1.4** release from npm or Docker Compose and verifying a healthy Studio and REST API runtime.

## Requirements

| Component | Requirement for YunCMS 2.1.4 |
| --- | --- |
| Node.js (npm installs) | Node.js `24` LTS (`>=24 <25`) |
| npm (npm installs) | npm `11+` |
| Database | MySQL `8`-compatible server (verified on MySQL `8.4.11`) |
| Docker (container installs) | Docker Engine with Compose plugin, or Docker Desktop |

The YunCMS `2.1.4` CLI enforces Node.js `24.x` before executing commands. Confirm your local runtime:

```bash
node --version
npm --version
mysql --version
```

## Prepare a MySQL database (npm installations)

Create an empty UTF-8 database and a MySQL account with schema-management privileges on that database:

```sql
CREATE DATABASE yuncms CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'yuncms'@'127.0.0.1' IDENTIFIED BY 'replace-with-a-strong-password';
GRANT ALL PRIVILEGES ON yuncms.* TO 'yuncms'@'127.0.0.1';
FLUSH PRIVILEGES;
```

Use host restrictions and secret management appropriate for your deployment.

## Option 1: Persistent npm installation (recommended for Node.js deployments)

Record the exact published `@yunsoft/yuncms@2.1.4` package in a project directory so upgrades and backups operate against an explicit version:

```bash
mkdir my-yuncms
cd my-yuncms
npm init -y
npm install --save-exact @yunsoft/yuncms@2.1.4
npx yuncms init
npx yuncms start
```

### What `yuncms init` performs

1. Validates Node.js `24` LTS.
2. Scaffolds `uploads/`, `extensions/`, example extensions, and `start.js` without overwriting existing files.
3. Prompts for MySQL host, port, database, username, password, and TLS preference when `.env` does not exist, then writes `.env` with restrictive permissions.
4. Verifies MySQL connectivity and applies all missing core database migrations (`0001` through `0029`, schema version `5`).
5. Creates the initial Administrator account once if no Administrator exists.
6. Prints the local API and Studio addresses.

Keep `.env` out of source control and treat it as a secret-bearing deployment file.

## Option 2: Quick evaluation with `npx`

Run the published `2.1.4` package directly without writing a `package.json`:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms@2.1.4 init
npx --yes @yunsoft/yuncms@2.1.4 start
```

The current working directory remains the project directory for `.env`, local `uploads/`, and `extensions/`.

## Option 3: Docker Compose (`yunsoftofficial/yuncms:2.1.4`)

Docker Compose starts both MySQL `8.4` and the pinned `yunsoftofficial/yuncms:2.1.4` image with persistent named volumes:

```bash
mkdir my-yuncms
cd my-yuncms
curl -fsSLO https://raw.githubusercontent.com/Yunsoft-Software/yuncms/v2.1.4/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Yunsoft-Software/yuncms/v2.1.4/docker.env.example -o .env
```

Replace `YUNCMS_DB_PASSWORD` and `YUNCMS_DB_ROOT_PASSWORD` in `.env`, then initialize and start:

```bash
docker compose up -d mysql
docker compose run --rm yuncms init
docker compose up -d yuncms
```

Use `mysql` as the MySQL host during containerized `init`.

## Verify health, readiness and Studio sign-in

By default, YunCMS `2.1.4` serves both Studio and the REST API on `http://localhost:3008`:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/ready
```

- `/health` returns `200` with `{"status":"ok",...}` when the HTTP process is alive.
- `/ready` returns `200` with `{"status":"ready",...}` when MySQL and shared-state backends are ready to serve traffic.

Open `http://localhost:3008` in a browser and sign in with the Administrator account created during `init`:

![YunCMS 2.1.4 Studio sign-in screen](screenshot:studio-login-en)

## Next steps

- Review all commands and environment variables in [CLI, Configuration and Upgrades (YunCMS 2.1.4)](doc:setup-cli).
- Follow [Using YunCMS Studio (YunCMS 2.1.4)](doc:studio-guide) to manage content, files, and settings.
- Model collections and configure roles in [Data Model, Permissions and REST API (YunCMS 2.1.4)](doc:data-and-access).
