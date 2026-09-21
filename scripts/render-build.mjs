import { existsSync, rmSync, cpSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const serviceHint = [
  process.env.RENDER_SERVICE_NAME,
  process.env.RENDER_EXTERNAL_URL,
  process.env.RENDER_SERVICE_SLUG,
]
  .filter(Boolean)
  .join(' ')
  .toLowerCase();

const isClientPanel = serviceHint.includes('shipsy-client');

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (isClientPanel) {
  const clientRoot = join(root, 'client-panel');
  run('npm', ['install'], clientRoot);
  run('npm', ['run', 'build'], clientRoot);

  const outputDir = join(root, 'dist');
  const clientDist = join(clientRoot, 'dist');
  if (!existsSync(clientDist)) {
    throw new Error('client-panel build did not create dist');
  }

  rmSync(outputDir, { recursive: true, force: true });
  cpSync(clientDist, outputDir, { recursive: true });
} else {
  run('vinext', ['build']);
  run('node', ['scripts/export-static.mjs']);
}
