/**
 * Controlled Benchmark Site (GOAL-002).
 *
 * A deliberately ordinary, modern, single-page-interaction site used to prove
 * the WebR core loop (`Capture → Audit → Reconstruct → Validate`) against real
 * web interactions, rather than a trivial fixture.
 *
 * The site is served on two local origins:
 *   - `main` origin — HTML, app JS, API endpoint, local CSS.
 *   - `cdn`  origin — a cross-origin/CDN stylesheet and image.
 *
 * It intentionally exercises every interaction the goal lists:
 *   hover menu, modal, tabs, form/input, scroll-dependent header,
 *   responsive/mobile menu, route navigation, animation, cross-origin/CDN
 *   asset, and API-loaded content. Everything is self-contained and
 *   deterministic so captures and validations are reproducible.
 */
import { createServer, type Server } from 'node:http';

export interface BenchmarkUrls {
  /** Main origin root, e.g. http://127.0.0.1:PORT/ */
  entry: string;
  /** Absolute URL of the cross-origin CDN server root. */
  cdn: string;
  /** Route URLs for navigation coverage. */
  about: string;
  contact: string;
}

export interface BenchmarkSite {
  url: string;
  port: number;
  cdnUrl: string;
  cdnPort: number;
  urls: BenchmarkUrls;
  close(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Page shells
// ---------------------------------------------------------------------------

/** Desktop nav markup; the interactive hover mega-menu only appears on the storefront. */
function navMarkup(menu: boolean): string {
  if (!menu) {
    return `<ul class="Nav-list">
        <li class="Nav-item"><a class="Nav-link" href="/about">About</a></li>
        <li class="Nav-item"><a class="Nav-link" href="/contact">Contact</a></li>
      </ul>`;
  }
  return `<ul class="Nav-list">
        <li class="Nav-item">
          <button class="Nav-trigger" aria-haspopup="true" aria-expanded="false" data-menu="products-menu">Products</button>
          <ul class="Menu" id="products-menu" role="menu">
            <li><a role="menuitem" href="/products">All</a></li>
            <li><a role="menuitem" href="/products#new">New</a></li>
          </ul>
        </li>
        <li class="Nav-item"><a class="Nav-link" href="/about">About</a></li>
        <li class="Nav-item"><a class="Nav-link" href="/contact">Contact</a></li>
      </ul>`;
}

/** Compose the shared document given per-route body HTML. */
function page(cdn: string, title: string, body: string, menu = false): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} · Verdant</title>
  <link rel="stylesheet" href="/styles.css" />
  <link rel="stylesheet" href="${cdn}/cdn/theme.css" />
  <script type="application/json" id="webr-benchmark" data-cdn="${cdn}">${JSON.stringify(cdn)}</script>
</head>
<body>
  <header class="SiteHeader" id="site-header">
    <div class="SiteHeader-inner">
      <a class="Brand" href="/">Verdant</a>
      <nav class="Nav" aria-label="Primary">
        ${navMarkup(menu)}
      </nav>
      <button class="MenuToggle" id="menu-toggle" aria-expanded="false" aria-controls="mobile-menu" type="button">
        <span class="MenuToggle-bar"></span>
      </button>
    </div>
  </header>

  <div class="MobileMenu" id="mobile-menu" hidden>
    <a class="MobileMenu-link" href="/about">About</a>
    <a class="MobileMenu-link" href="/contact">Contact</a>
  </div>

  <main class="Site">
${body}
  </main>

  <footer class="SiteFooter">
    <p>© Verdant · deterministic offline-first evidence demo</p>
  </footer>

  <script src="/app.js"></script>
</body>
</html>
`;
}

const HOME_BODY = `
  <section class="Hero">
    <img class="Hero-img" src="__CDN__/cdn/logo.svg" alt="Verdant mark" width="64" height="64" />
    <span class="Hero-badge">New season</span>
    <h1 class="Hero-title">Crafted for the everyday</h1>
    <p class="Hero-lede">A modern storefront rebuilt quietly, locally, and deterministically.</p>
  </section>

  <section class="Tabs" data-tabs>
    <div class="TabList" role="tablist" aria-label="Catalog">
      <button class="Tab is-active" role="tab" aria-selected="true" data-tab="featured">Featured</button>
      <button class="Tab" role="tab" aria-selected="false" data-tab="latest">Latest</button>
      <button class="Tab" role="tab" aria-selected="false" data-tab="archive">Archive</button>
    </div>
    <div class="TabPanel is-active" role="tabpanel" data-panel="featured"><p>Featured items — six lightly woven basics.</p></div>
    <div class="TabPanel" role="tabpanel" data-panel="latest" hidden><p>Latest items — dropped this week.</p></div>
    <div class="TabPanel" role="tabpanel" data-panel="archive" hidden><p>Archive items — prior seasons.</p></div>
  </section>

  <section class="Widgets">
    <h2 class="Heading">Live catalog</h2>
    <div class="Widgets-list" id="widgets" aria-live="polite">Loading…</div>
  </section>

  <section class="FormBox">
    <h2 class="Heading">Get in touch</h2>
    <form id="contact-form" class="Form" novalidate>
      <input id="email-input" name="email" type="email" placeholder="you@example.com" class="Field" />
      <button class="Button Button--primary" type="submit">Send</button>
    </form>
    <p class="Form-note" id="form-note" aria-live="polite"></p>
  </section>

  <section class="ModalBox">
    <h2 class="Heading">Members</h2>
    <button class="Button Button--ghost" id="modal-open" type="button">Open offer</button>
  </section>

  <div class="Modal" id="offer-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" hidden>
    <div class="Modal-card">
      <h2 id="modal-title">Members offer</h2>
      <p>Use code <strong>VERDANT10</strong> at checkout.</p>
      <button class="Button Button--neutral" id="modal-close" type="button">Close</button>
    </div>
  </div>

  <div class="Tall" aria-hidden="true"></div>`;

const ABOUT_BODY = `
  <section class="Page">
    <h1 class="Page-title">About Verdant</h1>
    <p class="Page-text">We make simple, durable goods for everyday life.</p>
  </section>`;

const CONTACT_BODY = `
  <section class="Page">
    <h1 class="Page-title">Contact</h1>
    <p class="Page-text">Reach the team at hello@verdant.example.</p>
  </section>`;

const PRODUCTS_BODY = `
  <section class="Page">
    <h1 class="Page-title">Products</h1>
    <p class="Page-text">Every piece, in every season — quiet staples, made to last.</p>
  </section>`;

// ---------------------------------------------------------------------------
// CSS (local)
// ---------------------------------------------------------------------------

const STYLES_CSS = `
:root { --ink:#1a1a1a; --accent:#0a6c4a; --line:#e4e2dd; --paper:#fffdf8; --muted:#6b6b66; }
* { box-sizing: border-box; }
body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; color:var(--ink); background:var(--paper); line-height:1.5; }

/* Scroll-dependent header: compact + elevated after the first scroll step. */
.SiteHeader { position:sticky; top:0; z-index:40; background:var(--paper); border-bottom:1px solid var(--line); transition:box-shadow .18s ease, padding .18s ease; }
.SiteHeader-inner { display:flex; align-items:center; gap:24px; padding:14px 20px; max-width:1020px; margin:0 auto; }
.SiteHeader.is-scrolled { box-shadow:0 4px 14px rgba(0,0,0,.08); }
.SiteHeader.is-scrolled .SiteHeader-inner { padding-top:9px; padding-bottom:9px; }

.Brand { font-weight:700; text-decoration:none; color:var(--ink); font-size:1.1rem; }
.Nav { }
.Nav-list { display:flex; gap:6px; list-style:none; margin:0; padding:0; }
.Nav-item { position:relative; }
.Nav-link, .Nav-trigger { display:inline-block; background:none; border:none; color:var(--ink); font-size:.95rem; padding:8px 10px; cursor:pointer; text-decoration:none; font-family:inherit; }
.Nav-link:hover, .Nav-trigger:hover { color:var(--accent); }
.Nav-trigger[aria-expanded="true"] { color:var(--accent); }

/* Hover menu: revealed purely via CSS :hover (no JS required). */
.Menu { display:none; position:absolute; top:100%; left:0; min-width:150px; margin:0; padding:6px 0; list-style:none; background:var(--paper); border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 20px rgba(0,0,0,.1); }
.Nav-item:hover .Menu { display:block; }
.Nav-item:hover .Nav-trigger { color:var(--accent); }
.Menu a { display:block; padding:8px 14px; color:var(--ink); text-decoration:none; font-size:.9rem; }
.Menu a:hover { background:#f2efe9; }

.MenuToggle { display:none; margin-left:auto; background:none; border:none; width:40px; height:36px; cursor:pointer; }
.MenuToggle-bar { display:block; width:22px; height:2px; background:var(--ink); margin:6px auto; }
.MobileMenu { display:none; }

.Site { max-width:1020px; margin:0 auto; padding:8px 20px 40px; }
.Hero { padding:56px 0 32px; text-align:center; }
.Hero-img { display:block; margin:0 auto 12px; }
.Hero-badge { display:inline-block; padding:4px 12px; border-radius:999px; background:#e7f3ec; color:var(--accent); font-size:.8rem; font-weight:700; letter-spacing:.04em; }
.Hero-title { font-size:clamp(1.9rem,4vw,2.7rem); margin:.4em 0 .2em; text-transform:lowercase; }

/* One-shot, settle-to-end animation (reduced-motion safe). */
@keyframes rise { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
.Hero { animation: rise .32s ease forwards; }

.Heading { font-size:1.15rem; }
.Tabs, .Widgets, .FormBox, .ModalBox, .Page { margin-top:28px; }
.TabList { display:flex; gap:4px; border-bottom:1px solid var(--line); }
.Tab { border:none; background:none; padding:8px 14px; cursor:pointer; color:var(--muted); font-size:.95rem; border-bottom:2px solid transparent; font-family:inherit; }
.Tab.is-active, .Tab[aria-selected="true"] { color:var(--accent); border-bottom-color:var(--accent); font-weight:600; }
.TabPanel { padding:14px 2px; }

.Widgets-list { display:grid; gap:10px; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
.Widget-card { border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.Widget-card h3 { margin:0 0 4px; font-size:1rem; }
.Widget-card p { margin:0; color:var(--muted); font-size:.85rem; }

.Form { display:flex; gap:8px; max-width:420px; }
.Field { flex:1; padding:9px 12px; border:1px solid var(--line); border-radius:8px; font-size:.95rem; }
.Field:focus { outline:2px solid var(--accent); outline-offset:0; }
.Button { padding:9px 14px; border:none; border-radius:8px; cursor:pointer; font-size:.95rem; font-family:inherit; }
.Button--primary { background:var(--accent); color:#fff; }
.Button--ghost { background:#eef2ee; color:var(--accent); }
.Button--neutral { background:var(--ink); color:#fff; }
.Form-note { min-height:1.2em; color:var(--accent); font-size:.85rem; }

.Modal { position:fixed; inset:0; display:grid; place-items:center; background:rgba(20,20,20,.45); z-index:60; }
.Modal-card { background:var(--paper); border-radius:12px; padding:24px 28px; max-width:360px; box-shadow:0 18px 50px rgba(0,0,0,.25); }
.Modal[hidden] { display:none; }

.Tall { height:1400px; }

.SiteFooter { border-top:1px solid var(--line); padding:20px; color:var(--muted); font-size:.85rem; text-align:center; }

/* Responsive / mobile menu below 640px. */
@media (max-width:640px) {
  .Nav { display:none; }            /* collapse desktop nav */
  .MenuToggle { display:block; }    /* show hamburger */
  .SiteHeader.is-scrolled .MenuToggle-bar { background:var(--accent); }
}
.MobileMenu.is-open { display:flex; flex-direction:column; gap:2px; padding:12px 20px; border-bottom:1px solid var(--line); }
.MobileMenu-link { padding:10px 8px; color:var(--ink); text-decoration:none; }
`;

// ---------------------------------------------------------------------------
// CSS (cross-origin CDN)
// ---------------------------------------------------------------------------

const CDN_CSS = `
/* Cross-origin/CDN stylesheet. In production this ships from a CDN; here it is
   the second local origin used to verify cross-origin asset localization. */
.Verdant-mark { color:#0a6c4a; }
`;

const CDN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0a6c4a"/><path d="M20 44V20l24 24V20" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;

// ---------------------------------------------------------------------------
// App JS (local)
// ---------------------------------------------------------------------------

const APP_JS = `
(function () {
  'use strict';

  // API-loaded content.
  var list = document.getElementById('widgets');
  function renderWidgets(items) {
    if (!list) return;
    list.innerHTML = items.map(function (w) {
      return '<div class="Widget-card"><h3>' + w.name + '</h3><p>' + w.tagline + '</p></div>';
    }).join('');
  }
  fetch('/api/widgets')
    .then(function (r) { if (!r.ok) throw new Error('bad status'); return r.json(); })
    .then(renderWidgets)
    .catch(function () { if (list) list.textContent = 'Offline.'; });

  // Tabs.
  var tabs = document.querySelector('[data-tabs]');
  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.Tab');
      if (!tab) return;
      var name = tab.getAttribute('data-tab');
      tabs.querySelectorAll('.Tab').forEach(function (t) {
        var active = t === tab;
        t.classList.toggle('is-active', active);
        t.setAttribute('aria-selected', String(active));
      });
      tabs.querySelectorAll('.TabPanel').forEach(function (p) {
        p.classList.toggle('is-active', p.getAttribute('data-panel') === name);
        p.hidden = p.getAttribute('data-panel') !== name;
      });
    });
  }

  // Modal.
  var modal = document.getElementById('offer-modal');
  function setModal(open) {
    if (!modal) return;
    modal.hidden = !open;
    document.body.classList.toggle('has-modal', open);
  }
  var openBtn = document.getElementById('modal-open');
  var closeBtn = document.getElementById('modal-close');
  if (openBtn) openBtn.addEventListener('click', function () { setModal(true); });
  if (closeBtn) closeBtn.addEventListener('click', function () { setModal(false); });

  // Form / input.
  var form = document.getElementById('contact-form');
  var note = document.getElementById('form-note');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (note) note.textContent = 'Thanks — we reply within a day.';
    });
  }

  // Scroll-dependent header.
  var header = document.getElementById('site-header');
  var ticking = false;
  function onScroll() {
    if (header) header.classList.toggle('is-scrolled', (window.scrollY || 0) > 8);
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  // Responsive / mobile menu toggle.
  var toggle = document.getElementById('menu-toggle');
  var mobile = document.getElementById('mobile-menu');
  if (toggle && mobile) {
    toggle.addEventListener('click', function () {
      var open = !mobile.classList.contains('is-open');
      mobile.classList.toggle('is-open', open);
      mobile.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
  }
})();
`;

const WIDGETS_JSON = JSON.stringify([
  { name: 'Ribbed tee', tagline: 'Heavy-weight organic cotton.' },
  { name: 'Crew sweatshirt', tagline: 'Garment-dyed, fleece-backed.' },
  { name: 'Weekend trousers', tagline: 'Relaxed twill, hidden zip.' },
]);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

interface RouteEntry {
  type: string;
  data: Buffer | string;
}

function buildRoutes(cdnRoot: string): Record<string, RouteEntry> {
  return {
    '/': {
      type: 'text/html; charset=utf-8',
      data: page(cdnRoot, 'Home', HOME_BODY.replaceAll('__CDN__', cdnRoot), true),
    },
    '/about': { type: 'text/html; charset=utf-8', data: page(cdnRoot, 'About', ABOUT_BODY) },
    '/contact': { type: 'text/html; charset=utf-8', data: page(cdnRoot, 'Contact', CONTACT_BODY) },
    '/products': {
      type: 'text/html; charset=utf-8',
      data: page(cdnRoot, 'Products', PRODUCTS_BODY),
    },
    '/styles.css': { type: 'text/css; charset=utf-8', data: STYLES_CSS },
    '/app.js': { type: 'application/javascript; charset=utf-8', data: APP_JS },
    '/api/widgets': { type: 'application/json; charset=utf-8', data: WIDGETS_JSON },
  };
}

function buildCdnRoutes(): Record<string, RouteEntry> {
  return {
    '/cdn/theme.css': { type: 'text/css; charset=utf-8', data: CDN_CSS },
    '/cdn/logo.svg': { type: 'image/svg+xml', data: CDN_SVG },
  };
}

function serve(server: Server, routes: Record<string, RouteEntry>): void {
  server.on('request', (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    const route = routes[path];
    if (!route) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not Found');
      return;
    }
    res.writeHead(200, { 'content-type': route.type, 'cache-control': 'no-store' });
    res.end(route.data);
  });
}

/**
 * Start the Benchmark Site on two ephemeral local origins (main + CDN).
 */
export async function startBenchmarkSite(): Promise<BenchmarkSite> {
  const cdnServer = createServer();
  serve(cdnServer, buildCdnRoutes());
  await new Promise<void>((r) => cdnServer.listen(0, '127.0.0.1', r));
  const cdnPort = (cdnServer.address() as { port: number }).port;
  const cdnRoot = `http://127.0.0.1:${cdnPort}`;

  const mainServer = createServer();
  serve(mainServer, buildRoutes(cdnRoot));
  await new Promise<void>((r) => mainServer.listen(0, '127.0.0.1', r));
  const port = (mainServer.address() as { port: number }).port;

  const url = `http://127.0.0.1:${port}`;
  return {
    url,
    port,
    cdnUrl: cdnRoot,
    cdnPort,
    urls: {
      entry: url,
      cdn: cdnRoot,
      about: `${url}/about`,
      contact: `${url}/contact`,
    },
    close: async () => {
      await new Promise<void>((r) => mainServer.close(() => r()));
      await new Promise<void>((r) => cdnServer.close(() => r()));
    },
  };
}
