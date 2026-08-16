#!/usr/bin/env node

import { runCli } from '../src/cli.js';

runCli().catch((error) => {
  console.error(`YunCMS CLI failed${error?.code ? ` [${error.code}]` : ''}: ${error?.message ?? error}`);
  process.exitCode = 1;
});
