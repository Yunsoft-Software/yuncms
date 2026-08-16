#!/usr/bin/env node

import { loadEnvFileIfPresent } from '@yuncms/core';
import { runCli } from '../src/cli.js';

loadEnvFileIfPresent();

runCli().catch((error) => {
  console.error(`YunCMS CLI failed${error?.code ? ` [${error.code}]` : ''}: ${error?.message ?? error}`);
  process.exitCode = 1;
});
