
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
