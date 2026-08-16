import { writeFile } from 'node:fs/promises';

function encodeEnvValue(value) {
  const text = String(value ?? '');
  if (text.includes('\n') || text.includes('\r') || text.includes('\0')) {
    const error = new Error('Environment values cannot contain newlines or null bytes');
    error.code = 'INVALID_ENV_VALUE';
    throw error;
  }
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function serializeEnv(values) {
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${encodeEnvValue(value)}`)
    .join('\n')}\n`;
}

export async function writeEnvFile(path, values) {
  await writeFile(path, serializeEnv(values), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
}
