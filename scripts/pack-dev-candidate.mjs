#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const PACKAGES = ['core', 'api', 'cli'];
const SHA = /^[a-f0-9]{40}$/;
const digest = (bytes, algorithm) => createHash(algorithm).update(bytes).digest('base64');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120000,
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
}
export function candidateVersion(base, revision) {
  if (!/^\d+\.\d+\.\d+$/.test(base) || !SHA.test(revision)) throw Error('INVALID_CANDIDATE_ID');
  return `${base}-dev.${revision.slice(0, 12)}`;
}
export function candidatePackage(source, revision, names, baseVersion) {
  const version = candidateVersion(baseVersion, revision), result = structuredClone(source);
  result.version = version;
  result.private = true; // npm pack is allowed; accidental npm publish is rejected.
  result.yuncmsSourceRevision = revision;
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of Object.keys(result[section] || {})) if (names.includes(name)) result[section][name] = version;
  }
  return result;
}
function extract(archive, target, cwd) {
  const paths = run('tar', ['-tf', archive], cwd).split(/\r?\n/).filter(Boolean);
  if (!paths.length || paths.some(path => isAbsolute(path) || path.includes('\\') || path.split('/').includes('..'))) throw Error('UNSAFE_PACKAGE_ARCHIVE');
  const entries = run('tar', ['-tvf', archive], cwd).split(/\r?\n/).filter(Boolean);
  if (entries.some(line => !['-', 'd'].includes(line[0]))) throw Error('PACKAGE_ARCHIVE_LINK_NOT_ALLOWED');
  run('tar', ['-xf', archive, '-C', target], cwd);
}
async function checkArtifacts(directory, expected) {
  for (const item of expected.packages) {
    if (!/^[a-z0-9.-]+\.tgz$/.test(item.filename)) throw Error('INVALID_PACKAGE_FILENAME');
    const bytes = await readFile(join(directory, item.filename));
    if ('sha512-' + digest(bytes, 'sha512') !== item.integrity || digest(bytes, 'sha256') !== item.sha256) throw Error('CANDIDATE_INTEGRITY_MISMATCH');
  }
}
/** Transfer already accepted bytes; never repack on a different filesystem. */
export async function importCandidateArtifacts({ artifacts, output, expected, revision }) {
  if (!expected || expected.source_revision !== revision || !SHA.test(revision)) throw Error('CANDIDATE_MANIFEST_MISMATCH');
  const names = ['@yunsoft/yuncms-core', '@yunsoft/yuncms-api', '@yunsoft/yuncms'];
  if (expected.schema_version !== 1 || expected.source_repository !== 'https://github.com/Yunsoft-Software/yuncms.git'
    || expected.packages?.length !== names.length || new Set(expected.packages.map(item => item.filename)).size !== names.length
    || names.some(name => expected.packages.filter(item => item.name === name).length !== 1)
    || expected.packages.some(item => !item.version?.endsWith('-dev.' + revision.slice(0, 12)))) throw Error('CANDIDATE_MANIFEST_MISMATCH');
  artifacts = resolve(artifacts); output = resolve(output);
  const manifest = await json(join(artifacts, 'candidate.json'));
  if (JSON.stringify(manifest) !== JSON.stringify(expected)) throw Error('CANDIDATE_MANIFEST_MISMATCH');
  await checkArtifacts(artifacts, expected);
  // Validate the complete source before creating or replacing any output artifact.
  await mkdir(output, { recursive: true });
  if (await realpath(artifacts) !== await realpath(output)) {
    for (const item of expected.packages) await cp(join(artifacts, item.filename), join(output, item.filename), { errorOnExist: true, force: false });
    await writeFile(join(output, 'candidate.json'), JSON.stringify(expected, null, 2) + '\n', { flag: 'wx' });
  }
  await checkArtifacts(output, expected);
  return expected;
}
/** Archives committed source only. Does not build, test, install, migrate or publish. */
export async function packDevCandidate({ repo, revision, output, npmCli, expectedFile, artifacts }) {
  repo = resolve(repo); output = resolve(output);
  if (!SHA.test(revision)) throw Error('EXACT_SOURCE_REVISION_REQUIRED');
  if (artifacts) {
    if (!expectedFile) throw Error('EXPECTED_CANDIDATE_MANIFEST_REQUIRED');
    return importCandidateArtifacts({ artifacts, output, expected: await json(resolve(expectedFile)), revision });
  }
  if (!npmCli || !isAbsolute(npmCli)) throw Error('NPM_CLI_PATH_REQUIRED');
  const git = args => run('git', args, repo).trim();
  if (git(['rev-parse', '--verify', revision + '^{commit}']) !== revision) throw Error('SOURCE_REVISION_MISMATCH');
  const source = JSON.parse(git(['show', revision + ':packages/core/package.json']));
  const studioRevision = git(['rev-parse', '--verify', 'v' + source.version + '^{commit}']);
  if (git(['diff', '--name-only', studioRevision, revision, '--', 'apps/studio', 'packages/extensions-sdk'])) throw Error('STUDIO_OR_SDK_REQUIRES_SEPARATE_RELEASE');
  const expected = expectedFile ? await json(resolve(expectedFile)) : null;
  const npmVersion = run(process.execPath, [npmCli, '--version'], repo).trim();
  if (expected && (expected.source_revision !== revision || expected.npm_version !== npmVersion)) throw Error('CANDIDATE_TOOLCHAIN_MISMATCH');
  await mkdir(output, { recursive: true });
  if (expected) {
    try {
      const existing = await json(join(output, 'candidate.json'));
      if (JSON.stringify(existing) !== JSON.stringify(expected)) throw Error('CANDIDATE_MANIFEST_MISMATCH');
      await checkArtifacts(output, expected);
      return existing;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const stage = await mkdtemp(join(output, '.pack-'));
  try {
    const archive = join(stage, 'source.tar');
    git(['archive', '--format=tar', '--output=' + archive, revision, ...PACKAGES.map(name => 'packages/' + name), 'LICENSE']);
    const tree = join(stage, 'tree'); await mkdir(tree); extract(archive, tree, repo);
    const official = join(stage, 'official'); await mkdir(official);
    const npm = (args, cwd) => JSON.parse(run(process.execPath, [npmCli, ...args, '--ignore-scripts', '--json', '--workspaces=false'], cwd));
    const [baseline] = npm(['pack', '@yunsoft/yuncms-api@' + source.version, '--registry=https://registry.npmjs.org', '--pack-destination', official], stage);
    if (baseline.name !== '@yunsoft/yuncms-api' || baseline.version !== source.version || !/^[a-z0-9.-]+\.tgz$/.test(baseline.filename)) throw Error('INVALID_STUDIO_BASELINE');
    const officialArchive = join(official, baseline.filename), officialBytes = await readFile(officialArchive);
    const baselineIntegrity = 'sha512-' + digest(officialBytes, 'sha512');
    if (baselineIntegrity !== baseline.integrity || expected && expected.studio.integrity !== baselineIntegrity) throw Error('STUDIO_BASELINE_INTEGRITY_MISMATCH');
    extract(officialArchive, official, repo);
    // Studio source is unchanged: preserve the existing published assets, without a build.
    await cp(join(official, 'package', 'studio-dist'), join(tree, 'packages', 'api', 'studio-dist'), { recursive: true });
    const manifests = await Promise.all(PACKAGES.map(name => json(join(tree, 'packages', name, 'package.json'))));
    const names = manifests.map(item => item.name), packages = [];
    for (let index = 0; index < PACKAGES.length; index++) {
      const directory = join(tree, 'packages', PACKAGES[index]);
      const manifest = candidatePackage(manifests[index], revision, names, source.version);
      await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
      await cp(join(tree, 'LICENSE'), join(directory, 'LICENSE'));
      const [packed] = npm(['pack', '.', '--pack-destination', stage], directory);
      if (packed.name !== manifest.name || packed.version !== manifest.version || !/^[a-z0-9.-]+\.tgz$/.test(packed.filename)) throw Error('INVALID_CANDIDATE_PACKAGE');
      const bytes = await readFile(join(stage, packed.filename));
      packages.push({ name: manifest.name, version: manifest.version, filename: packed.filename,
        integrity: 'sha512-' + digest(bytes, 'sha512'), sha256: digest(bytes, 'sha256') });
    }
    const result = { schema_version: 1, source_repository: 'https://github.com/Yunsoft-Software/yuncms.git', source_revision: revision,
      npm_version: npmVersion, studio: { version: source.version, source_revision: studioRevision, integrity: baselineIntegrity }, packages };
    if (expected && JSON.stringify(expected) !== JSON.stringify(result)) throw Error('CANDIDATE_REPRODUCTION_MISMATCH');
    for (const item of packages) await rename(join(stage, item.filename), join(output, item.filename));
    await writeFile(join(output, 'candidate.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    const realOutput = await realpath(output), realStage = await realpath(stage);
    if (!realStage.startsWith(realOutput + sep) || !relative(realOutput, realStage).startsWith('.pack-')) throw Error('UNSAFE_CANDIDATE_CLEANUP');
    await rm(realStage, { recursive: true });
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), values = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--repo', '--revision', '--output', '--npm-cli', '--expected', '--artifacts'].includes(args[index]) || !args[index + 1]) throw Error('INVALID_CANDIDATE_ARGUMENTS');
    values[args[index].slice(2)] = args[index + 1];
  }
  if (!values.repo || !values.revision || !values.output) throw Error('Usage: pack-dev-candidate --repo PATH --revision COMMIT --output PATH --npm-cli ABSOLUTE_PATH [--expected PATH]');
  const result = await packDevCandidate({ repo: values.repo, revision: values.revision, output: values.output,
    npmCli: values['npm-cli'] || process.env.npm_execpath, expectedFile: values.expected, artifacts: values.artifacts });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
