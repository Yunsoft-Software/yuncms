# npm release tag maintenance

The `npm-release-tags` workflow removes the temporary `release-X-Y-Z` tag after
all four YunCMS npm packages have `latest` at `X.Y.Z`. Its default is off. A
maintainer triggers it on the default branch with the verified release version.
CircleCI obtains a short-lived identity for the npm registry. [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/#managing-dist-tags-with-trusted-publishing)

## CircleCI Cloud setup

1. Connect `Yunsoft-Software/yuncms` to a CircleCI Cloud project whose pipeline
   loads `.circleci/config.yml`. Record the organization, project, and pipeline
   definition IDs. [CircleCI project setup](https://circleci.com/docs/guides/deploy/deploy-to-npm-registry/#1-gather-required-parameters)
2. Create the empty context `yuncms-npm-dist-tags`. Restrict it to the YunCMS
   project and use the expression `pipeline.git.branch == "main" and not job.ssh.enabled`.
   Record its context ID. [CircleCI context restrictions](https://circleci.com/docs/guides/deploy/deploy-to-npm-registry/#3-lock-it-down-with-protected-contexts)
3. In each package's npm settings, add a CircleCI trusted publisher with those
   IDs and VCS origin `github.com/Yunsoft-Software/yuncms`. Select
   **Allow npm dist-tag**, and grant only the permissions needed by the
   configured workflow. A maintainer completes npm's interactive 2FA when
   saving the trust. The registry grants tag management at package scope, so
   keep the project and context restrictions in place. [npm registry API](https://api-docs.npmjs.com/)

Configure these connections when the CI pipeline is ready to validate them.
npm documents a two-day expiration for a new connection awaiting its first
successful publish. Confirm the connection's activation before relying on it for
future releases. [Trusted publisher configuration expiry](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry)

The npm packages are `@yunsoft/yuncms-extensions-sdk`, `@yunsoft/yuncms-core`,
`@yunsoft/yuncms-api`, and `@yunsoft/yuncms`. The job uses Node.js 24 and npm
11.21.0 for OIDC dist-tag support.

## Clean up a release

After all four npm packages are downloadable and `latest` points to the
verified release, trigger the CircleCI pipeline with `clean-npm-release-tags`
set to `true` and `npm-release-version` set to that stable version. For `2.1.3`,
the job verifies `latest` on every package and removes `release-2-1-3` wherever
it points to `2.1.3`. The job verifies the published tags after removal.

For a read-only check from the source checkout, run:

```bash
node scripts/npm-release-tags.mjs check 2.1.3
```

The check reports how many packages still carry the release tag. If the registry
reports a different version, resolve the discrepancy before retrying. After a
partial cleanup, run the same pipeline again with the same release version to
remove the remaining matching tags.
