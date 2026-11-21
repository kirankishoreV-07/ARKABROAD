'use strict';

// ui.js — presentation only: welcome screen, sliding tab indicator, animated score ring,
// engine status dot and staggered reveals. It watches the DOM that popup.js updates,
// so none of the app logic needs to know about animation.

(function () {
  const $ = (id) => document.getElementById(id);
  const RING = 213.6;   // 2πr for r = 34
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Welcome / landing (first run only) ─────────────────────────────────────
  function closeWelcome(then) {
    const w = $('welcome');
    chrome.storage.local.set({ arkWelcomeSeen: true });
    w.classList.add('leaving');
    setTimeout(() => { w.classList.add('hidden'); w.classList.remove('leaving'); if (then) then(); }, reduceMotion ? 0 : 420);
  }
  chrome.storage.local.get(['arkWelcomeSeen'], (r) => {
    if (!r || !r.arkWelcomeSeen) $('welcome').classList.remove('hidden');
  });
  $('welcome-start').addEventListener('click', () => closeWelcome(() => { if (typeof switchTab === 'function') switchTab('profile'); }));
  $('welcome-skip').addEventListener('click', () => closeWelcome());

  // ── Sliding tab indicator ──────────────────────────────────────────────────
  const tabs = Array.from(document.querySelectorAll('.tab-btn'));
  function moveIndicator() {
    const i = Math.max(0, tabs.findIndex(t => t.classList.contains('active')));
    $('tab-indicator').style.transform = `translateX(${i * 100}%)`;
  }
  tabs.forEach(t => new MutationObserver(moveIndicator).observe(t, { attributes: true, attributeFilter: ['class'] }));
  moveIndicator();

  // ── Engine status dot ──────────────────────────────────────────────────────
  function engineDot() {
    const t = $('engine-line').textContent || '';
    const dot = $('engine-dot');
    dot.className = 'dot' + (/On-device|Claude/.test(t) ? ' ai' : /Templates/.test(t) ? '' : ' on');
  }
  new MutationObserver(engineDot).observe($('engine-line'), { childList: true, characterData: true, subtree: true });
  engineDot();

  // ── Score ring: animate the arc and count the number up ───────────────────
  let animating = false, lastValue = null;
  function ring() {
    if (animating) return;
    const raw = ($('score-num').textContent || '').trim();
    const v = parseInt(raw, 10);
    const arc = $('score-arc');
    if (isNaN(v)) { arc.style.strokeDashoffset = RING; lastValue = null; return; }
    if (v === lastValue) return;      // our own count-up finishing — nothing new
    lastValue = v;
    arc.style.strokeDashoffset = RING * (1 - Math.max(0, Math.min(100, v)) / 100);
    if (reduceMotion) return;
    animating = true;
    const start = performance.now(), dur = 900;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      $('score-num').textContent = String(Math.round(v * eased));
      if (p < 1) requestAnimationFrame(step);
      else { $('score-num').textContent = String(v); animating = false; }
    };
    requestAnimationFrame(step);
  }
  new MutationObserver(ring).observe($('score-num'), { childList: true, characterData: true, subtree: true });

  // ── Staggered reveal when a result appears ─────────────────────────────────
  const result = $('result');
  let wasHidden = result.classList.contains('hidden');
  new MutationObserver(() => {
    const hidden = result.classList.contains('hidden');
    if (wasHidden && !hidden && !reduceMotion) {
      Array.from(result.children).forEach((el, i) => {
        el.classList.remove('rise');
        void el.offsetWidth;            // restart the animation
        el.style.setProperty('--i', i);
        el.classList.add('rise');
      });
    }
    wasHidden = hidden;
  }).observe(result, { attributes: true, attributeFilter: ['class'] });

  // Tracker cards cascade in
  new MutationObserver(() => {
    Array.from($('contact-list').children).forEach((el, i) => { el.style.animationDelay = (i * 45) + 'ms'; });
  }).observe($('contact-list'), { childList: true });
})();
