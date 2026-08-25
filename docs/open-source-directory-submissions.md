# Open-source directory submission tracker

Research snapshot: **2026-08-26**

This document tracks third-party lists and directories where YunCMS may be submitted. It is intentionally kept on the development branch: the public `main` documentation should explain the product, not carry maintainer outreach notes.

The decision rule is conservative: submit only when YunCMS fits the list, satisfies every published requirement, and the target still shows meaningful maintenance activity. Recheck the linked rules immediately before every future submission because maintainers can change them without notice.

Snapshot totals: **41 targets reviewed**, **8 upstream submissions opened**, **2 correct-fit targets blocked by their submission path**, **15 future eligibility targets**, and **16 dormant or out-of-scope targets rejected**.

## YunCMS evidence at the snapshot date

| Check | Evidence | Result |
| --- | --- | --- |
| Public source | [`Yunsoft-Software/yuncms`](https://github.com/Yunsoft-Software/yuncms) is public | Pass |
| Open-source license | Repository and npm metadata declare `MIT` | Pass |
| Product fit | Self-hosted MySQL CMS/backend, REST API, React Studio, RBAC, Files, extensions and optional MCP | Pass for CMS, headless CMS, Node.js application and general OSS directories |
| Documentation | User README, installation, deployment, REST, security, MCP and production-readiness guides are present | Pass |
| Published package | [`@yunsoft/yuncms`](https://www.npmjs.com/package/@yunsoft/yuncms) `0.1.14` is the current npm release | Pass |
| Maintenance | GitHub repository was updated on 2026-08-25 | Pass |
| Repository age | Created 2026-08-16; first npm release published 2026-08-17 | Too young for maturity-gated lists |
| Popularity | 0 GitHub stars and 0 forks | Fails lists with star thresholds |
| Stable/tagged release | No GitHub tag or GitHub Release; README calls `0.1.x` pre-stable | Fails stable/production-ready and first-release-age gates |

## Submission workflow

GitHub requires contributors without upstream write access to push the change to a fork, then open a cross-repository pull request. A repository under `raichubuilds` is therefore only the source copy; it is not the submission target. Every submitted PR below was verified with `isCrossRepository: true`, uses the external list as its base repository, and uses the uniform source branch `add-yuncms`. The temporary yellow pre-stable icon was removed from the `dalisoft/awesome-cms` row; maturity remains disclosed in the PR text instead of changing the project name.

## Eligible and submitted now

| Upstream repository | Published requirements and fit | Positive notes | Negative / caution notes | Action |
| --- | --- | --- | --- | --- |
| [`OSSDrop/OSSDrop`](https://github.com/OSSDrop/OSSDrop) | The [guide](https://github.com/OSSDrop/OSSDrop/blob/main/CONTRIBUTING.md) requires a public repository, OSI license, honest description no longer than 140 characters, one category and one project per PR. YunCMS passes. | Active directory; explicitly accepts owner submissions; no age/star threshold. | No CMS category; `web-apis` is the closest valid category and the PR explains the choice. | Open upstream [PR #20](https://github.com/OSSDrop/OSSDrop/pull/20). |
| [`dalisoft/awesome-cms`](https://github.com/dalisoft/awesome-cms) | The [guide](https://github.com/dalisoft/awesome-cms/blob/master/CONTRIBUTING.md) requires relevant, verified, license-respecting changes. YunCMS fits the Headless CMS table and its React/Node.js, MIT and MCP fields are verifiable. | Exact CMS audience; table exposes MCP and framework information; accepted a CMS in 2026. | Small audience. Pre-stable status is disclosed in the PR body, without adding a warning icon to the name. | Open upstream [PR #28](https://github.com/dalisoft/awesome-cms/pull/28). |
| [`ishanvyas22/awesome-open-source-systems`](https://github.com/ishanvyas22/awesome-open-source-systems) | README invites open-source systems and has an exact `Content Management Systems (CMS)` section. No age/star gate is published. | Active in 2026; a CMS addition was merged in March 2026. | The repository has pre-existing awesome-lint findings, but the YunCMS line adds no cited finding. | Open upstream [PR #31](https://github.com/ishanvyas22/awesome-open-source-systems/pull/31). |
| [`songtianlun/selfhost-hub`](https://github.com/songtianlun/selfhost-hub) | README welcomes new self-hosted services; the catalog has an exact English CMS category and accepts project-owner submissions. YunCMS front matter matches current entries. | Actively merged external catalog additions in August 2026; dedicated self-hosted audience. | Full build performs repository-wide GitHub metadata calls and hit HTTP 429 locally. The new front matter itself parsed and passed required-field checks. | Open upstream [PR #28](https://github.com/songtianlun/selfhost-hub/pull/28). |
| [`sfermigier/awesome-foss-alternatives`](https://github.com/sfermigier/awesome-foss-alternatives) | README says contributions are welcome and contains `Web CMS and Blog Engines`; no minimum age/star rule is published. YunCMS is MIT and fits that section. | Active and merged a submission in May 2026; exact FOSS/CMS audience. | The list prints star counts, so the entry truthfully records `0`; pre-stable maturity is also disclosed. | Open upstream [PR #55](https://github.com/sfermigier/awesome-foss-alternatives/pull/55). |
| [`automata/awesome-jamstack`](https://github.com/automata/awesome-jamstack) | The [guide](https://github.com/automata/awesome-jamstack/blob/master/contributing.md) requires one item, exact format, short punctuation-correct copy and placement at the bottom of the relevant section. YunCMS fits `CMS` as a REST content source for Jamstack frontends. | Active; three external additions merged in August 2026; no maturity threshold. | Upstream `npm test` already reports 22 errors and 5 warnings. The YunCMS line is clean; the custom-named fork adds only a repository-identity lint finding locally. | Open upstream [PR #149](https://github.com/automata/awesome-jamstack/pull/149). |
| [`BolajiAyodeji/awesome-jamstack`](https://github.com/BolajiAyodeji/awesome-jamstack) | The [guide](https://github.com/BolajiAyodeji/awesome-jamstack/blob/master/CONTRIBUTING.md) requires one suggestion, title case, short `Name - Description` format, a period and bottom placement. YunCMS fits `Useful Tools`. | Active external additions merged in July 2026; no age/star threshold; security checks passed. | Broad tools section rather than a dedicated product table; target has unrelated pre-existing awesome-lint findings. | Open upstream [PR #48](https://github.com/BolajiAyodeji/awesome-jamstack/pull/48). |
| [`AwesomeHomelab/awesome-homelab`](https://github.com/AwesomeHomelab/awesome-homelab) | README directs projects to `Submit App`; its data has an exact CMS category and publishes no age/star minimum. YunCMS is self-hosted and MIT. | Highly active in August 2026; 2.3k+ stars; includes Directus, Strapi and similar CMS products. | Submission path is an issue rather than a direct PR. YunCMS has no Docker image, so the issue explicitly states Node.js 24/MySQL requirements and pre-stable maturity. | Open upstream [issue #130](https://github.com/AwesomeHomelab/awesome-homelab/issues/130). |

## Correct fit, but submission blocked

| Repository | Requirements and positive fit | Current blocker | Recheck condition |
| --- | --- | --- | --- |
| [`n370/awesome-headless-cms`](https://github.com/n370/awesome-headless-cms) | The [guide](https://github.com/n370/awesome-headless-cms/blob/main/CONTRIBUTING.md) has no age/star threshold. YunCMS belongs in `Tools`, is not duplicated, and the proposed line itself is lint-clean. | The required `npx awesome-lint` fails on unchanged upstream `main` with 11 existing `no-repeat-item-in-description` errors. The entry is prepared on the [fork branch](https://github.com/raichubuilds/awesome-headless-cms/tree/add-yuncms), but opening a knowingly red PR would violate the target gate. | Submit after upstream fixes the baseline or a maintainer explicitly accepts the existing failures. |
| [`piotrkulpinski/open-source-alternatives`](https://github.com/piotrkulpinski/open-source-alternatives) | Exact open-source alternatives directory with CMS/BaaS coverage and no visible numeric gate; smaller projects are present. | Contributions must use the [OpenAlternative submission form](https://openalternative.co/submit), which redirects to GitHub/Google/email sign-in. No unauthenticated GitHub PR route is documented. | Submit manually after authenticating to the directory; record the resulting listing URL. |

## Not eligible yet

| Repository | Published gate | YunCMS passes | Missing now | Reapply condition |
| --- | --- | --- | --- | --- |
| [`postlight/awesome-cms`](https://github.com/postlight/awesome-cms) | [More than 50 stars](https://github.com/postlight/awesome-cms/blob/main/CONTRIBUTING.md) and a commit within one year. | CMS, OSS, recent activity. | 0 stars. | Reach 51 stars and remain active. |
| [`sindresorhus/awesome-nodejs`](https://github.com/sindresorhus/awesome-nodejs) | [Older than 30 days, at least 100 stars](https://github.com/sindresorhus/awesome-nodejs/blob/main/contributing.md), tests, docs and broad usefulness. | Node.js, tests, docs, reusable backend use case. | Ten days old at snapshot; 0 stars; submissions are also temporarily paused. | Age >30 days, stars >=100 and submissions reopened. |
| [`awesome-selfhosted/awesome-selfhosted`](https://github.com/awesome-selfhosted/awesome-selfhosted) | The [data guide](https://github.com/awesome-selfhosted/awesome-selfhosted-data/blob/master/CONTRIBUTING.md) requires a first tagged release older than four months, active maintenance and working installation. | Self-hosted, MIT, active, installation docs. | No GitHub tag/release, so the age clock has not started. | Publish a real tagged release, then wait more than four months. |
| [`brandonhimpfen/awesome-headless-cms`](https://github.com/brandonhimpfen/awesome-headless-cms) | [Selective editorial rules](https://github.com/brandonhimpfen/awesome-headless-cms/blob/main/CONTRIBUTING.md) warn against early-stage/promotional entries. | Exact headless CMS scope and docs. | Pre-stable, ten-day-old project with no independent adoption signal. | Stable release, longer history and independent users/stars. |
| [`brandonhimpfen/awesome-cms`](https://github.com/brandonhimpfen/awesome-cms) | Same [early-stage and quality gate](https://github.com/brandonhimpfen/awesome-cms/blob/main/CONTRIBUTING.md). | Exact CMS scope and docs. | Same maturity/adoption gap. | Stable release, history and independent adoption. |
| [`open-saas-directory/awesome-saas-directory`](https://github.com/open-saas-directory/awesome-saas-directory) | README requires active, appropriately licensed, documented and **production-ready** software. | MIT, active, documented. | README explicitly calls 0.1.x pre-stable. | Stable release plus recorded production verification. |
| [`RunaCapital/awesome-oss-alternatives`](https://github.com/RunaCapital/awesome-oss-alternatives) | Contribution guide requires a private-company alternative founded within ten years and at least 100 stars. | Open-source alternative concept. | 0 stars and company qualification is not established. | Verify company gate and reach 100 stars. |
| [`btw-so/open-source-alternatives`](https://github.com/btw-so/open-source-alternatives) | Requires an active product, a credible proprietary alternative and at least 100 stars. | Active OSS CMS; Contentful/Directus are plausible alternatives. | 0 stars. | Reach 100 stars and document the closed-source alternative clearly. |
| [`hadez8877/awesome-opensource`](https://github.com/hadez8877/awesome-opensource) | Requires at least 50 stars, accepted license and activity within 12 months. | MIT and active. | 0 stars. | Reach 50 stars while remaining active. |
| [`altstackHQ/altstack-data`](https://github.com/altstackHQ/altstack-data) | Requires recent activity, maintainer engagement, self-hosting/install docs, releases and real-world traction; single-commit/no-release hobby projects are excluded. | Active, self-hosted and documented. | No release tags and no adoption signal. | Tagged releases plus independent users/traction. |
| [`Atarity/deploy-your-own-saas`](https://github.com/Atarity/deploy-your-own-saas) | Submission template explicitly rejects early-stage/alpha/newly started projects. | Self-hosted SaaS alternative shape. | Pre-stable and ten days old. | Stable, production-used release with history. |
| [`jcabot/oss-lowcode-tools`](https://github.com/jcabot/oss-lowcode-tools) | Requires an explicit low-code project, at least 50 stars, recent activity and generation of a software component. | Active visual data-model/admin capabilities. | 0 stars and YunCMS does not claim to be a low-code generator. | Only reconsider if product positioning genuinely changes and stars reach 50. |
| [`tortuvshin/open-apps`](https://github.com/tortuvshin/open-apps) | Requests real production-grade apps with adequate documentation/history. | Open source, docs and application UI. | Pre-stable maturity and taxonomy focused on mobile/cross-platform app stacks. | Stable production evidence plus a matching category. |
| [`valentin-vogel/awesome-nocode-lowcode`](https://github.com/valentin-vogel/awesome-nocode-lowcode) | Contributions must be useful to the no-code community and use the requested commit prefix. | Visual schema/content administration overlaps partially. | YunCMS is not positioned as no-code/low-code; submission would stretch scope. | Reconsider only after a genuine documented no-code workflow exists. |
| [`zenitysec/awesome-low-code`](https://github.com/zenitysec/awesome-low-code) | Low-code platform scope, exact list format and community endorsement are expected. | Visual admin/data modeling is adjacent. | No explicit low-code claim or endorsement. | Obtain real low-code use cases and independent endorsement first. |

## Reviewed, but no submission recommended

| Repository | Positive signal | Why no submission |
| --- | --- | --- |
| [`sqreen/awesome-nodejs-projects`](https://github.com/sqreen/awesome-nodejs-projects) | Formal format rules and a CMS section. | No PR merged since April 2021; current submissions accumulate unattended. |
| [`franz-josef-kaiser/awesome-decoupled-cms`](https://github.com/franz-josef-kaiser/awesome-decoupled-cms) | Exact headless CMS scope. | No contribution policy or recent merge signal; last push December 2024; stale links/content. |
| [`ToastShaman/awesome-backend`](https://github.com/ToastShaman/awesome-backend) | Backend-adjacent. | Framework/library reference list with no CMS/application category; last push March 2023. |
| [`notrab/awesome-headless-commerce`](https://github.com/notrab/awesome-headless-commerce) | Adjacent headless ecosystem. | YunCMS is not a commerce engine or commerce-specific resource. |
| [`diegoleme/awesome-open-source-alternatives`](https://github.com/diegoleme/awesome-open-source-alternatives) | Active in April 2026 and accepts alternatives. | No Contentful/Directus/CMS anchor category; adding YunCMS alone would require inventing a proprietary comparison section. |
| [`flick9000/awesome-alternatives`](https://github.com/flick9000/awesome-alternatives) | Active in May 2026; general alternative-software theme. | Consumer desktop/service replacements with screenshots; no CMS/developer-backend category or documented contribution contract. |
| [`freedomappsprivacy/Freedom-apps-privacy`](https://github.com/freedomappsprivacy/Freedom-apps-privacy) | Active privacy/FOSS list and accepts PRs. | No CMS/developer backend section; privacy-rating claims would require independent assessment not available here. |
| [`awesome-foss/awesome-sysadmin`](https://github.com/awesome-foss/awesome-sysadmin) | Large, active self-hosting-adjacent audience. | Curates system administration software, not general CMS applications; no matching category. |
| [`Postmake/open-source-directory`](https://github.com/Postmake/open-source-directory) | General open-source directory concept. | Last push December 2023 and describes popular projects; YunCMS has no popularity signal. |
| [`Smilefounder/awesome-dotnet-core-cms`](https://github.com/Smilefounder/awesome-dotnet-core-cms) | Exact CMS topic. | Technology scope is .NET Core; YunCMS is Node.js/React. |
| [`tools-collection/apis-collection`](https://github.com/tools-collection/apis-collection) | Active API catalog. | Collects publicly consumable APIs, not installable CMS products; YunCMS has no hosted public API endpoint. |
| [`sindresorhus/awesome`](https://github.com/sindresorhus/awesome) | Largest Awesome index. | Indexes complete awesome lists, not individual products, and PR submissions are temporarily disabled. |
| [`firasuke/awesome`](https://github.com/firasuke/awesome) | Active curated projects list. | Its taxonomy is systems/software-project focused and contains no CMS/content-management category. |
| [`netlify/headlesscms.org`](https://github.com/netlify/headlesscms.org) | Historically exact headless CMS directory. | Archived in 2020; no submissions possible. |
| [`gentics/headless-cms-comparison`](https://github.com/gentics/headless-cms-comparison) | Exact comparison topic. | Vendor-maintained comparison with no open intake path and no recent maintenance signal. |
| [`CodinCat/noPress`](https://github.com/CodinCat/noPress) | Headless CMS/static-site adjacency. | Product repository rather than a directory; last push January 2024. |

## Submission log

| Upstream target | Source fork branch | Entry | Current status |
| --- | --- | --- | --- |
| [`OSSDrop/OSSDrop#20`](https://github.com/OSSDrop/OSSDrop/pull/20) | `raichubuilds/OSSDrop:add-yuncms` | `web-apis` JSON object | Open, cross-repository, mergeable; local JSON/validator passed. |
| [`dalisoft/awesome-cms#28`](https://github.com/dalisoft/awesome-cms/pull/28) | `raichubuilds/awesome-cms:add-yuncms` | Headless CMS table row, no warning icon | Open, cross-repository, mergeable; Prettier passed. |
| [`ishanvyas22/awesome-open-source-systems#31`](https://github.com/ishanvyas22/awesome-open-source-systems/pull/31) | `raichubuilds/awesome-open-source-systems:add-yuncms` | CMS README item | Open, cross-repository, clean merge state. |
| [`songtianlun/selfhost-hub#28`](https://github.com/songtianlun/selfhost-hub/pull/28) | `raichubuilds/selfhost-hub:add-yuncms` | English CMS catalog front matter | Open, cross-repository, clean merge state; schema parse passed. |
| [`sfermigier/awesome-foss-alternatives#55`](https://github.com/sfermigier/awesome-foss-alternatives/pull/55) | `raichubuilds/awesome-foss-alternatives:add-yuncms` | Web CMS README item | Open, cross-repository, clean merge state. |
| [`automata/awesome-jamstack#149`](https://github.com/automata/awesome-jamstack/pull/149) | `raichubuilds/awesome-jamstack-automata:add-yuncms` | CMS README item | Open, cross-repository, clean merge state; target baseline lint debt disclosed. |
| [`BolajiAyodeji/awesome-jamstack#48`](https://github.com/BolajiAyodeji/awesome-jamstack/pull/48) | `raichubuilds/awesome-jamstack-bolaji:add-yuncms` | Useful Tools README item | Open, cross-repository, mergeable; both security checks passed. |
| [`AwesomeHomelab/awesome-homelab#130`](https://github.com/AwesomeHomelab/awesome-homelab/issues/130) | Not applicable; target requires issue submission | CMS app request | Open upstream issue with runtime, no-Docker and pre-stable disclosures. |
| [`n370/awesome-headless-cms`](https://github.com/n370/awesome-headless-cms) | [`raichubuilds/awesome-headless-cms:add-yuncms`](https://github.com/raichubuilds/awesome-headless-cms/tree/add-yuncms) | Tools README item | Prepared only; no PR until the required upstream lint gate can pass. |

## Future review checklist

Before a later application:

1. Open the linked contribution guide again and record the new review date.
2. Confirm YunCMS is not already listed and has no open/closed duplicate submission.
3. Re-measure repository age, stars, releases and last commit instead of copying this snapshot.
4. Keep each PR to one project and the target repository's exact format.
5. Use factual copy; disclose pre-stable status wherever the target list represents maturity.
6. Run the target repository's linter/validation locally and record the actual command/result.
7. Update the submission log with the PR URL and outcome; do not repeatedly resubmit a declined entry without satisfying the maintainer's reason.
