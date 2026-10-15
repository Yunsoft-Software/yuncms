import { executeFlowScript } from '../../packages/core/src/flows/script.js';
import { createAccountability } from '../../packages/core/src/accountability.js';

await executeFlowScript({ code: "import { writeFileSync } from 'node:fs'; export default data => { writeFileSync(data.pidFile, String(process.pid)); while (true) {} };" },
  { pidFile: process.argv[2] }, { accountability: createAccountability({ user: 'orphan-fixture', role: 'normal' }), scripts: { enabled: true, timeoutMs: 10000, projectPath: process.argv[3] } });
