# Installation Options

YunCMS can be installed with Docker Compose, run directly from npm with `npx`, recorded as a persistent npm dependency or executed from a source checkout. Every method provides the same YunCMS CLI, REST API and React Studio.

YunCMS is developed and maintained by [Yunsoft Software](https://yunsoft.com).

## Choose a method

| Method | Use it when | Runtime requirements | Update model |
| --- | --- | --- | --- |
| Docker Compose | You want the fastest complete self-hosted stack with MySQL and persistent volumes | Docker Engine with Compose, or Docker Desktop | Pull a new pinned image, run `bootstrap`, restart |
| Remote `npx` | You want to evaluate YunCMS without recording a dependency | Node.js 24 LTS, npm 11+, existing MySQL | Invoke an explicit package version |
| Persistent npm | You operate YunCMS as a normal Node.js project | Node.js 24 LTS, npm 11+, existing MySQL | `npx yuncms update --to <version>` |
| Source checkout | You contribute to YunCMS or test unreleased source | Git, Node.js 24 LTS, npm 11+, existing MySQL | Git branch/revision workflow |

For a production installation, pin the Docker image or npm package version. Do not treat a floating tag or an unreviewed source branch as an unattended update policy.

## Docker Compose

The maintained stack runs [`yunsoftofficial/yuncms`](https://hub.docker.com/r/yunsoftofficial/yuncms) with MySQL 8.4 and persistent named volumes.

```bash
mkdir my-yuncms
cd my-yuncms
curl -fsSLO https://raw.githubusercontent.com/Yunsoft-Software/yuncms/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/Yunsoft-Software/yuncms/main/docker.env.example -o .env
```

Replace both example passwords in `.env`, then initialize and start:

```bash
docker compose up -d mysql
docker compose run --rm yuncms init
docker compose up -d yuncms
```

Use `mysql` as the database host during initialization. Continue with [Docker](docker.md) for the prompt values, volume layout, configuration, backups and pinned-image update workflow.

## Remote `npx`

This option downloads and runs the published CLI without adding it to a project `package.json`:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

The current directory remains the project directory. YunCMS creates `.env`, local Files, extension examples and `start.js` there rather than inside the npm cache.

For repeatable automation, invoke an explicit version instead of relying on the npm latest tag:

```bash
npx --yes @yunsoft/yuncms@0.1.22 start
```

## Persistent npm installation

Use a normal npm project when the deployment should record its YunCMS dependency and use the managed backup/update workflow:

```bash
mkdir my-yuncms
cd my-yuncms
npm init -y
npm install --save-exact @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

`package.json` and `package-lock.json` become part of the deployment contract. See [Setup and CLI](setup-cli.md) for commands and [Upgrades](upgrades.md) for backup, probe and rollback behavior.

## Source checkout

Use the source workspace for YunCMS core, Studio or extension-development work:

```bash
git clone https://github.com/Yunsoft-Software/yuncms.git
cd yuncms
npm ci
npm run init
npm start
```

The source workspace requires Node.js 24.x. `npm start` builds Studio and starts the API. Normal contributors should run the relevant regression suite before committing:

```bash
npm run test:fast
npm test
```

Do not use a mutable source checkout as an undocumented production update mechanism. Pin a reviewed commit or release and follow the same backup, bootstrap and readiness checks as a packaged deployment.

## Common result

After any installation method, the default local address is:

```text
http://localhost:3008
```

Studio and REST share that listener. Verify the runtime before continuing:

```bash
curl http://localhost:3008/health
curl http://localhost:3008/ready
```

Then follow [Getting Started](getting-started.md) to create the first collection, role and API request. Before internet-facing use, complete [Deployment](deployment.md) and [Production Readiness](production-readiness.md).
