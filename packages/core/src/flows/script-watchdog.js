import { workerData } from 'node:worker_threads';

function stop() {
  try { process.kill(process.platform === 'win32' ? process.pid : -process.pid, 'SIGKILL'); }
  catch { process.exit(1); }
}
setTimeout(stop, workerData.timeoutMs + 250);
setInterval(() => {
  try { process.kill(workerData.parentPid, 0); }
  catch (error) { if (error.code === 'ESRCH') stop(); }
}, 100);
