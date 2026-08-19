/**
 * WebR-authored runtime for the Vite homepage rebuild (GOAL-004).
 * Reimplemented from frozen evidence; no original-site JS bundle is used.
 * Follows docs/architecture/05-SOURCE-CONVENTION.md (is-* state classes).
 */
(function () {
  'use strict';

  var root = document.documentElement;
  var body = document.body;

  /* ---------- Flyout menus ---------- */
  function initFlyouts() {
    document.querySelectorAll('.wr-Flyout').forEach(function (flyout) {
      var trigger = flyout.querySelector('.wr-Flyout-trigger');
      if (!trigger) return;
      trigger.addEventListener('click', function (event) {
        event.stopPropagation();
        var isOpen = flyout.classList.contains('is-open');
        // Close sibling flyouts.
        document.querySelectorAll('.wr-Flyout.is-open').forEach(function (other) {
          if (other !== flyout) other.classList.remove('is-open');
        });
        flyout.classList.toggle('is-open', !isOpen);
        trigger.setAttribute('aria-expanded', String(!isOpen));
      });
    });

    document.addEventListener('click', function () {
      document.querySelectorAll('.wr-Flyout.is-open').forEach(function (f) {
        f.classList.remove('is-open');
        var t = f.querySelector('.wr-Flyout-trigger');
        if (t) t.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- Install tabs ---------- */
  function initTabs() {
    var tabsWrap = document.getElementById('install-tabs');
    if (!tabsWrap) return;
    tabsWrap.querySelectorAll('.wr-Tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var key = tab.getAttribute('data-tab');
        tabsWrap
          .querySelectorAll('.wr-Tab')
          .forEach(function (t) {
            t.classList.toggle('is-active', t === tab);
          });
        tabsWrap
          .querySelectorAll('.wr-Tabs-panel')
          .forEach(function (p) {
            p.classList.toggle('is-active', p.getAttribute('data-panel') === key);
          });
      });
    });
  }

  /* ---------- Top banner ---------- */
  function initBanner() {
    var banner = document.getElementById('site-top-banner');
    var close = document.getElementById('top-banner-close');
    if (!banner || !close) return;
    close.addEventListener('click', function () {
      banner.classList.add('is-hidden');
    });
  }

  /* ---------- Search modal ---------- */
  function initSearch() {
    var modal = document.getElementById('search-modal');
    var trigger = document.getElementById('search-trigger');
    var input = document.getElementById('search-input');
    if (!modal || !trigger) return;

    function open() {
      modal.classList.add('is-open');
      if (input) input.focus();
    }
    function close() {
      modal.classList.remove('is-open');
    }

    trigger.addEventListener('click', open);
    modal.addEventListener('click', function (event) {
      if (event.target === modal) close();
    });
    document.addEventListener('keydown', function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        open();
      }
      if (event.key === 'Escape') close();
    });
  }

  /* ---------- Logo return home ---------- */
  function initNavFallback() {
    // The Vite logo brand link navigates to the root; keep it a normal link.
    var brand = document.querySelector('.wr-Header-logo-link');
    if (brand && brand.getAttribute('href') === './index.html') {
      brand.addEventListener('click', function () {
        // allow default navigation
      });
    }
  }

  /* ---------- Init ---------- */
  document.addEventListener('DOMContentLoaded', function () {
    initFlyouts();
    initTabs();
    initBanner();
    initSearch();
    initNavFallback();
  });

  void root;
  void body;
})();