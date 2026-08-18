#!/usr/bin/env node

import { runCli, EXIT_CODES } from './cli.js';

runCli(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    process.stderr.write(`webr: error: ${(err as Error).stack ?? err}\n`);
    process.exitCode = EXIT_CODES.commandFailure;
  },
);
