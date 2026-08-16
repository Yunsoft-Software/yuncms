import { createRequire } from 'node:module';
import { access, readFile, readdir } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { validateExtensionManifest } from './manifest.js';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function exists(path) {
  try {
    await access(path, fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function findPackageRootFromEntry(entryPath, packageName) {
  let current = dirname(entryPath);

  while (true) {
    const packagePath = join(current, 'package.json');
    if (await exists(packagePath)) {
      try {
        const packageJson = await readJson(packagePath);
        if (packageJson.name === packageName) return current;
      } catch {
        // Keep walking; a parent package may be the requested package root.
      }
    }

    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}

async function resolveDependencyPackageRoot(rootDir, packageName) {
  const requireFromProject = createRequire(join(resolve(rootDir), 'package.json'));

  try {
    return dirname(requireFromProject.resolve(`${packageName}/package.json`));
  } catch (packageJsonError) {
    try {
      const entry = requireFromProject.resolve(packageName);
      const root = await findPackageRootFromEntry(entry, packageName);
      if (root) return root;
    } catch {
      // Fall through to the original package-json resolution error below.
    }

    const error = new Error(`Unable to resolve installed extension package: ${packageName}`);
    error.code = 'EXTENSION_PACKAGE_NOT_RESOLVED';
    error.cause = packageJsonError;
    throw error;
  }
}

async function discoverLocalExtensions(rootDir, localDirectory) {
  const directory = resolve(rootDir, localDirectory);
  if (!(await exists(directory))) return [];

  const entries = await readdir(directory, { withFileTypes: true });
  const discovered = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packageRoot = join(directory, entry.name);
    const packagePath = join(packageRoot, 'package.json');
    if (!(await exists(packagePath))) continue;

    const packageJson = await readJson(packagePath);
    const manifest = validateExtensionManifest(packageJson, packageRoot);
    if (manifest) discovered.push({ ...manifest, source: 'local' });
  }

  return discovered;
}

async function discoverDependencyExtensions(rootDir) {
  const rootPackagePath = join(resolve(rootDir), 'package.json');
  if (!(await exists(rootPackagePath))) return [];

  const rootPackage = await readJson(rootPackagePath);
  const packageNames = new Set([
    ...Object.keys(rootPackage.dependencies ?? {}),
    ...Object.keys(rootPackage.optionalDependencies ?? {}),
    ...Object.keys(rootPackage.devDependencies ?? {}),
  ]);
  const discovered = [];

  for (const packageName of packageNames) {
    let packageRoot;
    try {
      packageRoot = await resolveDependencyPackageRoot(rootDir, packageName);
    } catch (error) {
      if (rootPackage.optionalDependencies?.[packageName]) continue;
      throw error;
    }

    const packageJson = await readJson(join(packageRoot, 'package.json'));
    const manifest = validateExtensionManifest(packageJson, packageRoot);
    if (manifest) discovered.push({ ...manifest, source: 'npm' });
  }

  return discovered;
}

export async function discoverExtensions({
  rootDir = process.cwd(),
  localDirectory = 'extensions',
  includeDependencies = true,
} = {}) {
  const extensions = [
    ...(await discoverLocalExtensions(rootDir, localDirectory)),
    ...(includeDependencies ? await discoverDependencyExtensions(rootDir) : []),
  ];

  const ids = new Set();
  for (const extension of extensions) {
    if (ids.has(extension.id)) {
      const error = new Error(`Duplicate YunCMS extension id: ${extension.id}`);
      error.code = 'DUPLICATE_EXTENSION_ID';
      throw error;
    }
    ids.add(extension.id);
  }

  return extensions.sort((a, b) => a.id.localeCompare(b.id));
}
