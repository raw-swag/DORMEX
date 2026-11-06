#!/usr/bin/env node
/**
 * Cross-platform local development server runner for DORMEX.
 * Explicitly sets NODE_ENV=development and HOST=127.0.0.1.
 */
const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

const env = {
  ...process.env,
  NODE_ENV: 'development',
  HOST: process.env.HOST || '127.0.0.1',
  PORT: process.env.PORT || '3000',
};

const tsxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const child = spawn(tsxCmd, ['tsx', 'src/server.ts'], {
  cwd: rootDir,
  env,
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
