'use strict';

// scoring.js — who is worth contacting, and why.
//   1. AHP turns 6 pairwise "which matters more?" answers into 4 weights
//      (geometric-mean method + Saaty consistency ratio).
//   2. Each factor gets 0–10 points from fixed, explainable rules.
//   3. Score = 10 × Σ weight × points  → 0–100. Same input, same score, every time.
// AHP only sets the weights. It never ranks people directly (avoids rank reversal).

(function (root) {
  const E = root.ArkEvidence || (typeof require !== 'undefined' ? require('./evidence.js') : null);

  const CRITERIA = ['role', 'shared', 'reach', 'timing'];
  const CRITERIA_LABELS = { role: 'Role fit', shared: 'Shared ground', reach: 'Reachability', timing: 'Timing' };

  // value > 1 → first criterion matters more; value < 1 → second matters more (Saaty 1–9 scale).
  const DEFAULT_PAIRS = [
    { a: 'role',   b: 'shared', value: 2 },
    { a: 'role',   b: 'reach',  value: 3 },
    { a: 'role',   b: 'timing', value: 4 },
    { a: 'shared', b: 'reach',  value: 2 },
    { a: 'shared', b: 'timing', value: 3 },
    { a: 'reach',  b: 'timing', value: 2 }
  ];

  const RANDOM_INDEX = { 1: 0, 2: 0, 3: 0.58, 4: 0.90, 5: 1.12, 6: 1.24, 7: 1.32, 8: 1.41, 9: 1.45 };

  function matrixFromPairs(pairs) {
    const n = CRITERIA.length;
    const M = Array.from({ length: n }, () => Array(n).fill(1));
    for (const p of pairs) {
      const i = CRITERIA.indexOf(p.a), j = CRITERIA.indexOf(p.b);
      if (i < 0 || j < 0 || !(p.value > 0)) continue;
      M[i][j] = p.value;
      M[j][i] = 1 / p.value;
    }
    return M;
  }

  // Geometric-mean priorities + λmax, CI, CR.
  function ahp(pairs) {
    const M = matrixFromPairs(pairs || DEFAULT_PAIRS);
    const n = M.length;
    const gm = M.map(row => Math.pow(row.reduce((a, b) => a * b, 1), 1 / n));
    const total = gm.reduce((a, b) => a + b, 0);
    const w = gm.map(g => g / total);
    const Mw = M.map(row => row.reduce((s, v, j) => s + v * w[j], 0));
    const lambdaMax = Mw.reduce((s, v, i) => s + v / w[i], 0) / n;
    const CI = (lambdaMax - n) / (n - 1);
    const CR = RANDOM_INDEX[n] ? CI / RANDOM_INDEX[n] : 0;
    const weights = {};
    CRITERIA.forEach((c, i) => { weights[c] = w[i]; });
    return { weights, lambdaMax, CI, CR, consistent: CR < 0.10, matrix: M };
  }

  // Slider position (-8 … 8) ⇄ Saaty value (1/9 … 9)
  function sliderToValue(s) { s = Math.round(Number(s) || 0); return s >= 0 ? s + 1 : 1 / (1 - s); }
  function valueToSlider(v) { return v >= 1 ? Math.round(v - 1) : -Math.round(1 / v - 1); }

  // ── Factor rules (0–10 each) ────────────────────────────────────────────────
  // null = unknown (no target role set) → left out of the score instead of counting as 0.
  // A fellow student rarely hires, but can introduce you to their network → 3.
  function roleFitPoints(f) {
    if (f.roleMatch === 'unknown') return null;
    const base = { exact: 10, similar: 7, area: 4, none: 0 }[f.roleMatch] ?? 0;
    // A student isn't doing the job yet: same-field peer = 4, otherwise 3 (they can still introduce you).
    return f.isStudent ? (base >= 4 ? 4 : 3) : base;
  }

  function sharedPoints(f) {
    let p = 0;
    if (f.sameSchool) p += 4;
    if (f.sharedCompany) p += 3;
    if (f.sharedCountry) p += 3;
    if (f.sameField) p += 2;
    if (f.sameSchoolCourse) p += 2;   // same college AND same course = strongest shared ground
    const k = (f.commonSkills || []).length;
    if (k >= 4) p += 2; else if (k >= 2) p += 1;
    if (f.sameCity) p += 1;
    return Math.min(10, p);
  }

  // Moderately weak ties (some mutual connections) predict job mobility best (Rajkumar et al., Science 2022).
  function reachPoints(f) {
    let p;
    const d = String(f.degree || '');
    const m = f.mutuals;
    // Already connected = strongest tie = most likely to reply. (Weak ties matter for *finding* new
    // jobs — Rajkumar et al. 2022 — which is why 2nd-degree with some mutuals also scores 10.)
    if (d.startsWith('1')) p = 10;
    else if (d.startsWith('2') && m != null && m >= 1 && m <= 15) p = 10;
    else if (d.startsWith('2') && m != null && m > 15) p = 8;
    else if (d.startsWith('2')) p = 5;
    else if (d.startsWith('3')) p = 2;
    else p = m != null && m > 0 ? 7 : 4; // unknown degree
    if (f.post && f.post.daysAgo != null && f.post.daysAgo <= 30) p += 1;
    return Math.min(10, p);
  }

  function timingPoints(f) {
    const post = f.post;
    let p = 0;
    if (post && post.relevant && post.daysAgo != null && post.daysAgo <= 7) p = 10;
    else if (f.companyNews) p = 8;
    else if (post && post.relevant && post.daysAgo != null && post.daysAgo <= 30) p = 6;
    else if (post && post.relevant && post.daysAgo == null) p = 5;
    else if (post && post.daysAgo != null && post.daysAgo <= 14) p = 3;
    return p;
  }

  function scoreFacts(facts, weights) {
    weights = weights || ahp(DEFAULT_PAIRS).weights;
    const points = {
      role: roleFitPoints(facts),
      shared: facts.observed?.shared === false ? null : sharedPoints(facts),
      reach: facts.observed?.reach === false ? null : reachPoints(facts),
      timing: facts.observed?.timing === false && !facts.companyNews ? null : timingPoints(facts)
    };
    // Unknown factors are left out and the remaining weights are re-scaled, so missing info
    // never silently drags a score down.
    let total = 0, used = 0;
    for (const c of CRITERIA) {
      if (points[c] == null) continue;
      total += weights[c] * points[c];
      used += weights[c];
    }
    const count = CRITERIA.filter(c => points[c] != null).length;
    const score = used && (!facts.observed || (count >= 2 && used >= 0.4)) ? Math.round((total / used) * 10) : null;
    return { score, points, weights, coverage: { count, total: CRITERIA.length }, reasons: explain(facts, points), replyChance: replyChance(facts, points),
      careerHelp: careerHelp(facts, points), action: nextAction(facts, points), missing: CRITERIA.filter(c => points[c] == null) };
  }

  // Two plain-language readings of the same facts.
  function replyChance(f, p) {
    if (p.reach == null || p.shared == null) return 'Unknown';
    const v = p.reach * 0.6 + p.shared * 0.4;
    return v >= 8 ? 'Very high' : v >= 6 ? 'High' : v >= 4 ? 'Medium' : 'Low';
  }
  function careerHelp(f, p) {
    if (p.role == null) return 'Unknown — add your target role';
    if (f.isStudent) return 'Low';   // peers rarely hire — their value is the intro (see Best move)
    // Someone more senior in a related field can advise or refer — worth a little extra.
    const seniorBonus = f.seniority != null && f.seniority >= 2 && p.role >= 4 ? 1.5 : 0;
    const v = p.role * 0.75 + p.timing * 0.25 + seniorBonus;
    return v >= 7 ? 'High' : v >= 4 ? 'Medium' : 'Low';
  }
  function nextAction(f, p) {
    const rel = f.relationship;
    if (rel === 'classmate') return p.role != null && p.role >= 7
      ? 'Ask how they got into the role — then for a referral later'
      : 'Ask for an intro to someone in their network who does your target role';
    if (rel === 'ex_colleague') return 'Reconnect, share what you are working on, ask for advice';
    if (p.role != null && p.role >= 7) return 'Ask for a 10-minute chat about their role';
    if (rel === 'alumni') return 'Lead with the shared university, ask for advice';
    if (p.reach != null && p.reach <= 3) return 'Engage with a post first, then connect';
    return 'Ask for advice or an intro';
  }

  function explain(f, pts) {
    const r = [];
    const roleText = { exact: 'does your exact target role', similar: 'does a similar role', area: 'works in the same area', none: 'works in a different area' };
    if (f.roleMatch === 'unknown') r.push({ c: 'role', text: 'Need a target role and a readable title or headline' });
    else r.push({ c: 'role', text: `${f.theirTitle || 'Their role'} — ${f.isStudent && pts.role === 3 ? 'student, can introduce you to their network' : (roleText[f.roleMatch] || roleText.none)}` });
    const s = (f.evidence || []).filter(e => e.c === 'shared').map(e => e.text);
    if (!f.evidence) {
      if (f.sameSchool) s.push(`same uni (${f.sameSchool})`);
      if (f.sharedCountry) s.push(`also from ${f.sharedCountry}`);
      if (f.sharedCompany) s.push(`both worked at ${f.sharedCompany}`);
      if (f.sameCity) s.push(`same city`);
    }
    r.push({ c: 'shared', text: s.length ? s.join(' · ') : pts.shared == null ? 'Need comparable profile details' : 'No overlap in the available details' });
    const d = f.degree ? (String(f.degree).startsWith('1') ? 'Already connected' : `${f.degree}-degree`) : 'Connection degree unknown';
    r.push({ c: 'reach', text: d + (f.mutuals != null ? ` · ${f.mutuals} mutual` : '') });
    let t = pts.timing == null ? 'Activity was not available' : 'No recent activity found';
    if (f.post && f.post.relevant) t = `Relevant post${f.post.daysAgo != null ? ' ' + f.post.daysAgo + 'd ago' : ''}`;
    else if (f.companyNews) t = 'Company news found';
    else if (f.post) t = `Posted${f.post.daysAgo != null ? ' ' + f.post.daysAgo + 'd ago' : ' recently'}`;
    r.push({ c: 'timing', text: t });
    return r;
  }

  // ── Hooks: reasons to reach out, ranked by how much they add to the score ──
  function buildHooks(facts, me, them) {
    me = me || {}; them = them || {};
    const company = them.currentCompany || '';
    const target = me.targetRole || 'your role';
    const hooks = [];
    const add = (h) => hooks.push(h);

    if (facts.post && facts.post.relevant) {
      const topic = facts.post.topic || shortTopic(facts.post.text);
      add({ id: 'post', type: 'post', strength: facts.post.hiring ? 9.5 : 8.5,
        label: `📢 They posted about ${topic}${facts.post.daysAgo != null ? ' (' + facts.post.daysAgo + 'd ago)' : ''}`,
        line: `Saw your post about ${topic}`, keyword: topic.split(' ').find(w => w.length > 3) || topic.split(' ')[0] });
    }
    if (facts.relationship === 'classmate' && facts.sameSchool !== 'the same school') {
      const s = shortSchool(facts.sameSchool);
      add({ id: 'classmate', type: 'classmate', strength: 9.8,
        label: `🎓 Classmates at ${s}${String(facts.degree || '').startsWith('1') ? ' — already connected' : ''}`,
        line: facts.isStudent ? `Hope the semester at ${s} is going well` : `Great to see where you've got to since ${s}`, keyword: s });
    } else if (facts.sameSchool && facts.sameSchool !== 'the same school') {
      add({ id: 'school', type: 'school', strength: 9,
        label: `🎓 You both studied at ${shortSchool(facts.sameSchool)}`,
        line: `I also studied at ${shortSchool(facts.sameSchool)}`, keyword: shortSchool(facts.sameSchool) });
    }
    if (facts.sharedCountry) {
      add({ id: 'country', type: 'country', strength: 8,
        label: `🌏 They also moved from ${facts.sharedCountry} and built a career as ${facts.theirTitle || 'a professional'}`,
        line: `I also moved here from ${facts.sharedCountry}`, keyword: facts.sharedCountry });
    }
    if (facts.sharedCompany) {
      add({ id: 'company', type: 'company', strength: 8,
        label: `🏢 You both worked at ${facts.sharedCompany}`,
        line: `We both spent time at ${facts.sharedCompany}`, keyword: facts.sharedCompany });
    }
    if ((facts.commonSkills || []).length >= 2) {
      const sk = facts.commonSkills.slice(0, 2).join(' and ');
      add({ id: 'skills', type: 'skills', strength: 7,
        label: `🛠️ You both work with ${sk}`,
        line: `I noticed we both work with ${sk}`, keyword: facts.commonSkills[0] });
    }
    if (facts.sameField && !facts.sameSchool) {
      add({ id: 'field', type: 'field', strength: 6,
        label: `📚 Same field of study (${facts.commonField.join(' ')})`,
        line: `I'm also studying ${facts.commonField.join(' ')}`, keyword: facts.commonField[0] });
    }
    if (facts.mutuals != null && facts.mutuals >= 10) {
      add({ id: 'mutuals', type: 'mutuals', strength: 6.5,
        label: `🤝 ${facts.mutuals} mutual connections`,
        line: `We have ${facts.mutuals} mutual connections`, keyword: String(facts.mutuals) });
    }
    if (facts.companyNews) {
      add({ id: 'news', type: 'news', strength: 7.5,
        label: `📰 ${company || 'Their company'}: ${facts.companyNews.text}`,
        line: `Saw the news about ${company || 'your team'}`, keyword: company, url: facts.companyNews.url });
    }
    if (facts.roleMatch === 'exact' || facts.roleMatch === 'similar') {
      add({ id: 'role', type: 'role', strength: facts.roleMatch === 'exact' ? 7 : 6,
        label: `🎯 They're a ${facts.theirTitle || 'professional'} — the path you're on`,
        line: `I'm working towards a ${target} role${company ? ' and you’re doing exactly that at ' + company : ''}`, keyword: target.split(' ')[0] });
    }
    if (!hooks.length) {
      add({ id: 'generic_role', type: 'role', strength: 3,
        label: `💼 Their work${company ? ' at ' + company : ''}`,
        line: `Your path${company ? ' to ' + company : ''} stood out to me`, keyword: company });
    }
    hooks.sort((a, b) => b.strength - a.strength);
    return hooks.slice(0, 3);
  }

  function shortSchool(s) {
    return String(s).replace(/\s+—.*$/, '').replace(/\buniversity of technology\b/i, '').replace(/\buniversity\b/i, '').replace(/\s+/g, ' ').trim() || s;
  }
  function shortTopic(text) {
    const t = String(text || '').toLowerCase();
    const w = (E ? E.HIRING_WORDS : []).find(x => t.includes(x));
    if (w) return 'the team growing';
    // First clause of the post, up to 6 words: "Completed my AI Developer Internship — …" → "completing your AI Developer Internship"
    const clause = String(text || '').split(/[.!?—–:|]/)[0].replace(/^(excited|happy|thrilled|proud|glad)\s+to\s+(share|announce)\s+(that\s+)?/i, '').trim();
    let words = clause.split(/\s+/).slice(0, 6).join(' ');
    words = words.replace(/^(i\s+have\s+|i\s+|i've\s+)?(completed|finished|joined|started|received|won|got)\b/i, (m, a, v) => ({ completed: 'completing', finished: 'finishing', joined: 'joining', started: 'starting', received: 'receiving', won: 'winning', got: 'getting' }[v.toLowerCase()]))
      .replace(/\bmy\b/gi, 'your').replace(/\bI\b/g, 'you');
    words = words.replace(/(\s+(as|an|a|the|to|at|for|of|and|with|in|on))+$/i, '');   // don't end mid-phrase
    return words || 'your recent work';
  }

  const api = { CRITERIA, CRITERIA_LABELS, DEFAULT_PAIRS, ahp, matrixFromPairs, sliderToValue, valueToSlider,
    roleFitPoints, sharedPoints, reachPoints, timingPoints, scoreFacts, buildHooks, shortSchool };
  root.ArkScoring = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
