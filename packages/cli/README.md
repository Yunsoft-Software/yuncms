# @yunsoft/yuncms

Command-line setup, runtime launcher and guarded upgrade tooling for YunCMS.

```bash
npm install @yunsoft/yuncms
npx yuncms init
npx yuncms start
```

`init` creates the project `.env`, an `uploads/` directory, a Plesk-compatible `start.js`, a 200-response health endpoint example under `extensions/health/`, and a minimal hook example under `extensions/example-hook/`. Existing project files are preserved and are not overwritten by the scaffold.

The generated health extension is available at `/extensions/health`. The core `/health` and `/ready` routes remain unchanged.

For Plesk, keep `@yunsoft/yuncms` installed locally and use the generated `start.js` as the application startup file. The same entry can be checked manually with:

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

YunCMS requires Node.js 24 LTS and MySQL for V1. See the [project repository](https://github.com/Yunsoft-Software/yuncms), `docs/setup-cli.md` and `docs/upgrades.md` for setup, deployment and upgrade documentation.

## Project status

YunCMS is developed and maintained by [Yunsoft Software](https://yunsoft.com). It is under active development, so interfaces and behavior may change between releases. Test upgrades and keep verified backups before production use.

Use YunCMS at your own risk. This package is provided under the [MIT License](https://github.com/Yunsoft-Software/yuncms/blob/22-08-2026/LICENSE) without warranty.
