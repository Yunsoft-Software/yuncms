import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const registry = 'https://registry.npmjs.org';
const stableVersion = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const packages = [
  '@yunsoft/yuncms-extensions-sdk',
  '@yunsoft/yuncms-core',
  '@yunsoft/yuncms-api',
  '@yunsoft/yuncms',
];

function releaseTag(version) {
  if (!stableVersion.test(version)) throw new Error('Expected a stable release version such as 2.1.3.');
  return `release-${version.replaceAll('.', '-')}`;
}

function needsCleanup(name, tags, version, tag) {
  if (tags?.latest !== version) throw new Error(`${name} must have latest at ${version}.`);
  if (!Object.hasOwn(tags, tag)) return false;
  if (tags[tag] !== version) throw new Error(`${name} must have ${tag} at ${version} before removal.`);
  return true;
}

export function planReleaseTagCleanup(version, tagsByPackage) {
  const tag = releaseTag(version);
  const pending = packages.filter(name => needsCleanup(name, tagsByPackage[name], version, tag));
  return { tag, pending };
}

export function requireCircleCiOidc(env) {
  if (env.CIRCLECI !== 'true' || env.CIRCLE_BRANCH !== 'main' || !env.NPM_ID_TOKEN) {
    throw new Error('Removal requires the CircleCI main-branch job with an npm OIDC identity.');
  }
}

async function readTags(name) {
  const response = await fetch(`${registry}/-/package/${encodeURIComponent(name)}/dist-tags`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Reading npm tags for ${name} returned HTTP ${response.status}.`);
  return response.json();
}

async function readPlan(version) {
  const entries = await Promise.all(packages.map(async name => [name, await readTags(name)]));
  return planReleaseTagCleanup(version, Object.fromEntries(entries));
}

async function run(argv, env) {
  const [command, version, ...rest] = argv;
  if (!['check', 'remove'].includes(command) || rest.length > 0) {
    throw new Error('Usage: node scripts/npm-release-tags.mjs check|remove VERSION');
  }
  releaseTag(version);
  if (command === 'remove') requireCircleCiOidc(env);

  const { tag, pending } = await readPlan(version);
  console.log(`All four npm packages have latest at ${version}. ${tag} is present on ${pending.length} package(s).`);
  if (command === 'check' || pending.length === 0) return;

  for (const name of pending) {
    if (!needsCleanup(name, await readTags(name), version, tag)) continue;
    execFileSync('npm', ['dist-tag', 'rm', name, tag, `--registry=${registry}`], { stdio: 'inherit' });
  }

  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await readPlan(version)).pending.length === 0) {
      console.log(`${tag} is absent from all four packages. latest is ${version}.`);
      return;
    }
    if (attempt < 5) await delay(2_000);
  }
  throw new Error(`npm still reports ${tag} on at least one package.`);
}

if (import.meta.main) {
  try {
    await run(process.argv.slice(2), process.env);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
