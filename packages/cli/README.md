# @yunsoft/yuncms

Command-line setup, runtime launcher and guarded upgrade tooling for YunCMS.

YunCMS is developed and maintained by **[Yunsoft Software](https://yunsoft.com)**.

## Quick start

You do **not** need to clone or fork the YunCMS repository. From an empty project directory, run the published package directly:

```bash
mkdir my-yuncms
cd my-yuncms
npx --yes @yunsoft/yuncms init
npx --yes @yunsoft/yuncms start
```

`init` creates the project `.env`, asks for MySQL connection details, applies the required database migrations and creates the first Administrator account.

The current directory is used as the YunCMS project directory. Initialization also creates an `uploads/` directory, a Plesk-compatible `start.js`, a 200-response health endpoint example under `extensions/health/`, and a minimal hook example under `extensions/example-hook/`. Existing project files are preserved and are not overwritten by the scaffold.

The generated health extension is available at `/extensions/health`. The core `/health` and `/ready` routes remain unchanged.

## Persistent project dependency

For a long-lived installation that should keep YunCMS in its own `package.json` and use managed updates, install the package once:

```bash
npm init -y
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

Once installed locally, `npx yuncms ...` resolves the project's pinned package version.

For Plesk, install `@yunsoft/yuncms` locally and use the generated `start.js` as the application startup file. The same entry can be checked manually with:

```bash
node start.js
```

Production maintenance commands:

```bash
npx yuncms backup
npx yuncms update --dry-run
npx yuncms update --to 0.2.0
npx yuncms restore /path/to/backup --yes
```

`backup` and `update` require the YunCMS service supervisor to be stopped so database and local Files/extensions can be snapshotted consistently. Managed updates require a verified backup, inspect target migration compatibility, run the newly installed migration code, probe `/ready`, and attempt automatic rollback on failure.

S3 objects are not copied by YunCMS backup; use provider-side versioning/snapshots and verify recovery before acknowledging an S3 update.

YunCMS requires Node.js 24 LTS and MySQL. See the [project documentation](https://github.com/Yunsoft-Software/yuncms#documentation), [`docs/setup-cli.md`](https://github.com/Yunsoft-Software/yuncms/blob/main/docs/setup-cli.md) and [`docs/upgrades.md`](https://github.com/Yunsoft-Software/yuncms/blob/main/docs/upgrades.md) for setup, deployment and upgrade documentation.

## Project status

YunCMS is under active development, so interfaces and behavior may change between releases. Test upgrades and keep verified backups before production use.

Use YunCMS at your own risk. This package is provided under the [MIT License](https://github.com/Yunsoft-Software/yuncms/blob/main/LICENSE) without warranty.
