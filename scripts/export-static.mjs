import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const port = 8791;
const origin = `http://127.0.0.1:${port}`;
const routes = [
  '/',
  '/services',
  '/solutions',
  '/platform',
  '/pricing',
  '/resources',
  '/demo',
  '/track-shipment',
  '/rate-calculator',
  '/contact',
];
const wrangler = path.resolve('node_modules', 'wrangler', 'bin', 'wrangler.js');
const server = spawn(
  process.execPath,
  [wrangler, 'dev', '--config', 'dist/server/wrangler.json', '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);

let startupOutput = '';
server.stdout.on('data', (chunk) => (startupOutput += chunk));
server.stderr.on('data', (chunk) => (startupOutput += chunk));

async function waitUntilReady() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Static export server exited early.\n${startupOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Static export server did not become ready.\n${startupOutput}`);
}

try {
  await waitUntilReady();
  for (const route of routes) {
    const response = await fetch(`${origin}${route}`);
    if (!response.ok) {
      throw new Error(`Failed to export ${route}: HTTP ${response.status}`);
    }
    const html = await response.text();
    const outputDirectory =
      route === '/' ? path.resolve('dist/client') : path.resolve('dist/client', route.slice(1));
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(path.join(outputDirectory, 'index.html'), html);
  }
  console.log(`Exported ${routes.length} static routes to dist/client.`);
} finally {
  server.kill('SIGTERM');
}
