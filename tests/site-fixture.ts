/**
 * Controlled local test site used by Capture / Explore / Validate integration
 * tests. Serves deterministic static content plus a small interactive demo
 * (buttons, hover targets, an input, a link) so the State Explorer has real
 * transitions to discover. No external network access is required.
 */
import { createServer, type Server } from 'node:http';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SITE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebR Test Site</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <header class="wr-Header">
    <h1 class="wr-Heading">WebR Test Site</h1>
  </header>
  <main class="wr-Main">
    <img src="/logo.svg" alt="Logo" width="64" height="64" class="wr-Logo" />
    <p class="wr-Paragraph">A deterministic page for capture tests.</p>

    <button class="wr-Button wr-Button--primary" id="toggle-box" type="button">Toggle box</button>
    <div id="hidden-box" class="wr-Box is-hidden" hidden>Hidden content revealed by click</div>

    <a href="#section2" class="wr-Link" id="anchor-link">Jump to section 2</a>
    <section id="section2" class="wr-Section">
      <h2 class="wr-Subheading">Section 2</h2>
      <input id="text-input" type="text" placeholder="Type here" class="wr-Input" />
    </section>

    <button class="wr-Button" id="hover-target" type="button">Hover me</button>
    <div id="hover-note" class="wr-Note" hidden>Hovered</div>
  </main>
  <script src="/app.js"></script>
</body>
</html>
`;

/** A tall page so the State Explorer can discover a scroll action. */
const LONG_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>WebR Long Page</title>
  <style>.wr-Spacer { height: 4000px; }</style>
</head>
<body>
  <h1 class="wr-Heading">Tall page</h1>
  <div class="wr-Spacer"></div>
  <p class="wr-Paragraph">Bottom content</p>
</body>
</html>
`;

const SITE_CSS = `
.wr-Button { padding: 6px 12px; background: #3574f0; color: #fff; border: none; }
.wr-Button:hover { background: #2560d0; }
.wr-Box { margin-top: 8px; padding: 8px; border: 1px solid #ccc; }
.wr-Note { color: #555; }
.is-hidden { display: none; }
`;

const SITE_JS = `
window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-box');
  const box = document.getElementById('hidden-box');
  if (btn && box) {
    btn.addEventListener('click', () => {
      const open = box.hasAttribute('hidden');
      box.toggleAttribute('hidden', !open);
      btn.setAttribute('aria-expanded', String(open));
    });
  }
  const hover = document.getElementById('hover-target');
  const note = document.getElementById('hover-note');
  if (hover && note) {
    hover.addEventListener('mouseenter', () => { note.hidden = false; });
    hover.addEventListener('mouseleave', () => { note.hidden = true; });
  }
});
`;

const SITE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#3574f0"/><circle cx="32" cy="32" r="16" fill="#fff"/></svg>\n`;

const ROUTES: Record<string, { type: string; data: string }> = {
  '/': { type: 'text/html', data: SITE_HTML },
  '/long': { type: 'text/html', data: LONG_HTML },
  '/styles.css': { type: 'text/css', data: SITE_CSS },
  '/app.js': { type: 'application/javascript', data: SITE_JS },
  '/logo.svg': { type: 'image/svg+xml', data: SITE_SVG },
};

export interface TestSite {
  url: string;
  port: number;
  close(): Promise<void>;
}

/** Start the controlled test site on an ephemeral port. */
export async function startTestSite(): Promise<TestSite> {
  const server: Server = createServer((req, res) => {
    const route = ROUTES[req.url ?? '/'];
    if (!route) {
      res.writeHead(404).end('Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': route.type });
    res.end(route.data);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    port,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

/**
 * Write the same site content to disk as a static replica fixture (used by the
 * validator's controlled-correct-replica test).
 */
export async function writeTestSiteReplica(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'webr-site-replica-'));
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), SITE_HTML, 'utf8');
  await writeFile(join(dir, 'styles.css'), SITE_CSS, 'utf8');
  await writeFile(join(dir, 'app.js'), SITE_JS, 'utf8');
  await writeFile(join(dir, 'logo.svg'), SITE_SVG, 'utf8');
  return dir;
}

export { SITE_HTML, SITE_CSS, SITE_JS, SITE_SVG };
