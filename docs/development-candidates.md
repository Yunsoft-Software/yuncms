# Consume an exact unreleased source revision

`scripts/pack-dev-candidate.mjs` prepares private npm tarballs for the CLI, API
and core from a full Git commit SHA. It does not execute tests, build Studio,
install dependencies, migrate a database or publish packages. It requires
Node.js 24, an npm CLI JavaScript entry point and `git`/`tar` on PATH.

```sh
node scripts/pack-dev-candidate.mjs --repo . --revision FULL_COMMIT_SHA \
  --output /dedicated/candidate-directory --npm-cli /path/to/npm-cli.js
```

Only source recorded at that commit is archived; working-copy edits are excluded.
Each package receives a `BASE_VERSION-dev.COMMIT_PREFIX` version, the full source
revision and `private: true`. The CLI and API reference that same candidate core.
SDK dependencies keep their official version; changed SDK source is refused.

When Studio source is unchanged from `vBASE_VERSION`, the API includes the exact
published baseline Studio assets. The baseline tarball integrity and source tag
are recorded. Changed Studio source requires its own release preparation; this
command does not silently build or omit Studio.

`candidate.json` records source, toolchain, package SHA-512 integrity and SHA-256
values. Keep it with the consuming project's dependency changes. The tarballs may
be local ignored artifacts; the recorded source commit and integrity values must
remain available. Pass `--expected /path/to/candidate.json` to reconstruct only
that exact candidate using the same npm version; any mismatch is an error.

Use ordinary npm file-tarball dependencies and a lockfile in the consuming project.
Recreate missing artifacts before `npm ci`. No global npm link, module-loader
patch or installed-package editing is involved. A clean machine needs the pinned
source checkout, not an absolute path from another developer's PC. These are
development packages, not an accepted production release. After an official
release, replace them with exact registry versions and regenerate the lockfile.
