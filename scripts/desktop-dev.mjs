/**
 * Runs the desktop shell against the Vite dev server, so the Electron window
 * gets hot reload instead of a rebuilt bundle.
 *
 *   npm run desktop:dev
 */

import { spawn } from 'node:child_process';
import process from 'node:process';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5173);
const URL_ = `http://${HOST}:${PORT}/`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const children = [];
let shuttingDown = false;

function stopAll(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

const vite = spawn(npx, ['vite', '--host', HOST, '--port', String(PORT), '--strictPort'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
children.push(vite);
vite.on('exit', (code) => stopAll(code ?? 0));

async function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL_);
      if (response.ok) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

if (!(await waitForServer())) {
  console.error(`Vite did not come up on ${URL_} in time.`);
  stopAll(1);
}

const electron = spawn(npx, ['electron', '.'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_DEV_SERVER_URL: URL_ },
});
children.push(electron);
electron.on('exit', (code) => stopAll(code ?? 0));
