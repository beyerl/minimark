#!/usr/bin/env node
'use strict';

// CLI launcher: `minimark [file]` opens the app, optionally on a file —
// like `code <path>`. Detaches so the terminal returns immediately. If the
// app is already running, the single-instance handler in main.js makes the
// existing window load the file instead of opening a second copy.

const { spawn } = require('child_process');
const path = require('path');

let electron;
try {
  electron = require('electron'); // when required from Node this is the binary path
} catch {
  console.error(
    "minimark: Electron is not installed. Run 'npm install' in the minimark folder."
  );
  process.exit(1);
}

const appRoot = path.join(__dirname, '..');
const args = [appRoot];

const fileArg = process.argv[2];
if (fileArg) args.push(path.resolve(process.cwd(), fileArg));

const child = spawn(electron, args, { detached: true, stdio: 'ignore' });
child.on('error', (err) => {
  console.error('minimark: failed to launch —', err.message);
  process.exit(1);
});
child.unref();
