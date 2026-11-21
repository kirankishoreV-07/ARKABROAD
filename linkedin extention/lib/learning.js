'use strict';

// learning.js — the score weights learn from YOUR real replies.
//
// Every contact saves the four factor points it had when you analysed it (role, shared,
// reach, timing). Once a message has had time to get an answer we know the outcome:
//   replied → 1,   no reply after 14 days (or closed without a reply) → 0.
//
// Model: logistic regression  P(reply) = σ(b + Σ β·points/10), fitted by MAP with a
// Gaussian prior centred on the coach's AHP weights. With little data the prior dominates,
// so a handful of outcomes can't swing the score; as outcomes accumulate, your own pattern
// takes over — but never more than half (the coach's judgement always keeps ≥ 50%).
//
// Everything runs on this device. Same contacts in → same weights out.

(function (root) {
  const CRITERIA = ['role', 'shared', 'reach', 'timing'];
  const DAY = 24 * 60 * 60 * 1000;
  const RESOLVE_DAYS = 14;       // no reply after this long = "no reply"
  const MIN_OUTCOMES = 8;        // need at least this many finished conversations…
  const MIN_EACH = 2;            // …including at least 2 replies and 2 non-replies
  const PRIOR_SCALE = 4;         // AHP weight 0.47 → prior β ≈ 1.9 on a 0–1 feature
  const PRIOR_SD = 1.0;          // how strongly the prior holds
  const BLEND_K = 20;            // α = n / (n + 20) …
  const MAX_ALPHA = 0.5;         // … capped at 50%

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));

  // ── 1. Turn contacts into training examples ────────────────────────────────
  function outcomeOf(c, now) {
    const replied = !!c.repliedAt || ['replied', 'call', 'referral'].includes(c.stage);
    if (replied) return 1;
    const lastOut = Math.max(c.messageSentAt || 0, c.inviteSentAt || 0);
    if (!lastOut) return null;                                   // never contacted
    if (c.stage === 'closed') return 0;
    return (now - lastOut) / DAY >= RESOLVE_DAYS ? 0 : null;     // still waiting
  }

  function examples(contacts, now) {
    now = now || Date.now();
    const out = [];
    for (const c of contacts || []) {
      if (!c.points) continue;                                   // saved before scoring existed
      const y = outcomeOf(c, now);
      if (y === null) continue;
      // Unknown factors (e.g. no target role yet) count as neutral 0.5, not 0.
      const x = CRITERIA.map(k => (c.points[k] == null ? 5 : c.points[k]) / 10);
      out.push({ x, y, name: c.name, hookType: c.hookType || null });
    }
    return out;
  }

  // ── 2. Fit: MAP logistic regression, prior centred on the AHP weights ──────
  function fit(samples, priorWeights, opts) {
    opts = opts || {};
    const iters = opts.iters || 600, lr = opts.lr || 0.3;
    const mu = CRITERIA.map(k => PRIOR_SCALE * (priorWeights[k] || 0));
    let beta = mu.slice();
    const baseRate = (samples.reduce((s, e) => s + e.y, 0) + 1) / (samples.length + 2);
    let b = Math.log(baseRate / (1 - baseRate)) - mu.reduce((s, m) => s + m * 0.5, 0);
    const n = samples.length;
    for (let it = 0; it < iters; it++) {
      const gB = new Array(CRITERIA.length).fill(0);
      let gb = 0;
      for (const e of samples) {
        const p = sigmoid(b + e.x.reduce((s, v, i) => s + v * beta[i], 0));
        const err = e.y - p;
        gb += err;
        e.x.forEach((v, i) => { gB[i] += err * v; });
      }
      // gradient of log-likelihood + log-prior, averaged per sample for a stable step size
      beta = beta.map((v, i) => v + lr * ((gB[i] - (v - mu[i]) / (PRIOR_SD * PRIOR_SD)) / n));
      b += lr * (gb / n);
    }
    return { beta, b };
  }

  function toWeights(beta, fallback) {
    const pos = beta.map(v => Math.max(0, v));
    const sum = pos.reduce((a, v) => a + v, 0);
    if (!(sum > 0)) return Object.assign({}, fallback);
    const w = {};
    CRITERIA.forEach((k, i) => { w[k] = pos[i] / sum; });
    return w;
  }

  // ── 3. Plain-language evidence: reply rate when a factor is strong vs weak ──
  function lifts(samples) {
    const res = {};
    CRITERIA.forEach((k, i) => {
      const hi = samples.filter(e => e.x[i] >= 0.6), lo = samples.filter(e => e.x[i] < 0.6);
      const rate = (arr) => arr.length ? arr.reduce((s, e) => s + e.y, 0) / arr.length : null;
      res[k] = { strong: rate(hi), weak: rate(lo), nStrong: hi.length, nWeak: lo.length };
    });
    return res;
  }

  // ── 4. Main entry: what the popup uses ─────────────────────────────────────
  function learn(contacts, ahpWeights, now) {
    const samples = examples(contacts, now);
    const n = samples.length;
    const replies = samples.filter(e => e.y === 1).length;
    const misses = n - replies;
    const base = { n, replies, misses, ahp: Object.assign({}, ahpWeights), lifts: lifts(samples) };

    if (n < MIN_OUTCOMES || replies < MIN_EACH || misses < MIN_EACH) {
      const need = [];
      if (n < MIN_OUTCOMES) need.push(`${MIN_OUTCOMES - n} more finished conversation${MIN_OUTCOMES - n === 1 ? '' : 's'}`);
      if (replies < MIN_EACH) need.push(`${MIN_EACH - replies} more repl${MIN_EACH - replies === 1 ? 'y' : 'ies'}`);
      if (misses < MIN_EACH) need.push(`${MIN_EACH - misses} more no-repl${MIN_EACH - misses === 1 ? 'y' : 'ies'}`);
      return Object.assign(base, { status: 'collecting', alpha: 0, learned: null, weights: Object.assign({}, ahpWeights),
        message: `Learning from your replies — needs ${need.join(', ')}. A message counts once they reply or after ${RESOLVE_DAYS} days.` });
    }

    const model = fit(samples, ahpWeights);
    const learned = toWeights(model.beta, ahpWeights);
    const alpha = Math.min(MAX_ALPHA, n / (n + BLEND_K));
    const weights = {};
    CRITERIA.forEach(k => { weights[k] = (1 - alpha) * ahpWeights[k] + alpha * learned[k]; });
    const top = CRITERIA.slice().sort((a, b) => (learned[b] - ahpWeights[b]) - (learned[a] - ahpWeights[a]))[0];
    return Object.assign(base, { status: 'ready', alpha, learned, weights, model, topGain: top,
      message: `Tuned by ${n} of your outcomes (${replies} replies). Your replies lean most on ${top === 'role' ? 'role fit' : top === 'shared' ? 'shared ground' : top === 'reach' ? 'reachability' : 'timing'}.` });
  }

  // Which weights scoring should use right now.
  function effectiveWeights(ahpWeights, learning, useLearned) {
    if (useLearned === false || !learning || learning.status !== 'ready') return Object.assign({}, ahpWeights);
    return Object.assign({}, learning.weights);
  }

  const api = { CRITERIA, RESOLVE_DAYS, MIN_OUTCOMES, MIN_EACH, MAX_ALPHA, outcomeOf, examples, fit, toWeights, lifts, learn, effectiveWeights };
  root.ArkLearning = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
