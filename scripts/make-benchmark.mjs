// Regenerates the committed Benchmark Site evidence at
// `fixtures/benchmark.webr`. This is the frozen golden evidence used by the
// GOAL-003 rebuild regression (`tests/rebuild.test.ts`) — the source + CDN are
// disconnected after capture and never needed again.
//
// Run: npm run build && npm run make-benchmark
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startBenchmarkSite, capturePackage } from '../dist/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'fixtures', 'benchmark.webr');

async function main() {
  const site = await startBenchmarkSite();
  try {
    await rm(OUT, { recursive: true, force: true });
    const outcome = await capturePackage({
      url: site.urls.entry,
      out: OUT,
      maxStates: 22,
      maxTransitions: 46,
      maxDepth: 2,
      timeBudgetMs: 95_000,
    });
    console.log(
      `Wrote benchmark evidence: ${OUT} (${outcome.states} states, ${outcome.transitions} transitions, ${outcome.assets} assets)`,
    );
  } finally {
    await site.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
