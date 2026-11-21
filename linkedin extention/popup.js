'use strict';

// popup.js — UI for the three tabs. Logic lives in lib/*.js:
//   ArkStore (storage) · ArkEvidence (fact notebook) · ArkScoring (AHP + score + hooks)
//   ArkVerifier (checker) · ArkWriter (templates, voice, replies, report) · ArkAI (engines)

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const state = {
  me: null, settings: null, pairs: null, weights: null, ahpInfo: null,
  engine: 'templates', onDevice: 'unsupported',
  tabUrl: '', onProfile: false,
  them: null, facts: null, hooks: [], notebook: [], scoreInfo: null,
  contact: null, hook: null, draftKind: 'invite', variant: { invite: 0, afterAccept: 0 },
  stageFilter: 'all', pendingPdf: null
};

const ENGINE_NAMES = { ondevice: 'On-device AI (Gemini Nano)', claude: 'Claude', templates: 'Templates' };

// ════════════════════════════════════ BOOT ════════════════════════════════════
document.addEventListener('DOMContentLoaded', async () => {
  wireTabs();
  wireCurrent();
  wireTracker();
  wireProfile();
  await ArkStore.migrateLegacy();
  await loadAll();
  await refreshEngine();
  await checkPage();
  renderProfileForm();
  renderTracker();
  applyPendingImport();
});

async function loadAll() {
  state.me = await ArkStore.getProfile();
  state.settings = await ArkStore.getSettings();
  state.pairs = (await ArkStore.getPairs()) || ArkScoring.DEFAULT_PAIRS.map(p => Object.assign({}, p));
  state.ahpInfo = ArkScoring.ahp(state.pairs);
  await recomputeWeights();
}

// Score weights = the coach's AHP weights, tuned by your own reply outcomes once there are enough.
async function recomputeWeights(contacts) {
  contacts = contacts || await ArkStore.getContacts();
  state.learning = ArkLearning.learn(contacts, state.ahpInfo.weights);
  state.weights = ArkLearning.effectiveWeights(state.ahpInfo.weights, state.learning, state.settings.useLearned !== false);
  return state.learning;
}

async function refreshEngine() {
  state.onDevice = await ArkAI.onDeviceStatus();
  state.engine = await ArkAI.chooseEngine(state.settings);
  let line = 'AI: ' + ENGINE_NAMES[state.engine];
  if (state.engine === 'templates' && (state.onDevice === 'downloadable' || state.onDevice === 'downloading')) line += ' · free on-device AI available (My profile → AI engine)';
  if (state.engine === 'ondevice' && state.onDevice !== 'available') line += ' (downloading on first use)';
  if (state.engine === 'templates' && state.onDevice === 'unsupported' && !state.settings.apiKey) line += ' · add a key or use Chrome 138+ for AI';
  $('engine-line').textContent = line;
}

function wireTabs() {
  document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.goto)));
}
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === 'tab-' + name));
  if (name === 'tracker') renderTracker();
}

// ═══════════════════════════════════ CURRENT ══════════════════════════════════
function wireCurrent() {
  $('analyse-btn').addEventListener('click', analyse);
  $('manual-open-btn').addEventListener('click', showManual);
  $('manual-open-btn-2').addEventListener('click', showManual);
  $('manual-cancel').addEventListener('click', () => { $('manual-box').classList.add('hidden'); checkPage(); });
  $('manual-go').addEventListener('click', createManual);
  $('deep-toggle').addEventListener('change', async (e) => {
    state.settings.deepMode = e.target.checked;
    await ArkStore.saveSettings(state.settings);
  });
  document.querySelectorAll('.draft-tab').forEach(b => b.addEventListener('click', () => showDraft(b.dataset.draft)));
  $('draft').addEventListener('input', onDraftEdit);
  $('regen-btn').addEventListener('click', regenerate);
  $('copy-btn').addEventListener('click', copyDraft);
  $('mark-btn').addEventListener('click', markSent);
  $('connected-btn').addEventListener('click', markConnected);
  $('open-li-btn').addEventListener('click', () => {
    const url = state.contact?.profileUrl || state.them?.profileUrl;
    if (url) chrome.tabs.create({ url });
  });
}

async function checkPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tabUrl = (tab && tab.url) || '';
  state.onProfile = /^https:\/\/www\.linkedin\.com\/in\/[^/?#]+\/?(?:[?#].*)?$/i.test(state.tabUrl);
  $('setup-nudge').classList.toggle('hidden', !!(state.me.targetRole && state.me.projectName));
  $('deep-toggle').checked = !!state.settings.deepMode;
  $('deep-row').classList.toggle('disabled', !state.settings.apiKey);
  $('deep-toggle').disabled = !state.settings.apiKey;

  $('result').classList.add('hidden');
  if (!state.onProfile) {
    $('no-profile').classList.remove('hidden');
    $('analyse-box').classList.add('hidden');
    return;
  }
  $('no-profile').classList.add('hidden');
  $('analyse-box').classList.remove('hidden');

  // Reopen: if this person is already saved, show their saved drafts straight away.
  const saved = await ArkStore.findByProfileUrl(state.tabUrl);
  if (saved && saved.hooks && saved.hooks.length) {
    openContact(saved);
    $('analyse-label').textContent = 'Re-analyse this profile';
  }
}

function setBusy(on, label) {
  $('analyse-btn').disabled = on;
  $('analyse-spinner').classList.toggle('hidden', !on);
  $('analyse-label').textContent = label || 'Analyse this profile';
}

function status(msg, type) {
  const el = $('status');
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.className = 'status-bar' + (type ? ' status-' + type : '');
}

// ── The 7-step flow ───────────────────────────────────────────────────────────
async function analyse() {
  setBusy(true, 'Step 1/5 · Reading profile sections…');
  $('result').classList.add('hidden');
  status('');
  try {
    // 1 COLLECT
    const them = await bg({ action: 'scrapeProfile' });
    if (them.isSelf) { offerImport(them); return; }
    state.them = them;
    const me = state.me;

    // 2 UNDERSTAND (rules always; AI on top when available)
    setBusy(true, 'Step 2/5 · Understanding with ' + ENGINE_NAMES[state.engine] + '…');
    let facts = ArkEvidence.ruleFacts(them, me);
    let aiNote = 'read by rules';
    if (state.engine !== 'templates') {
      try {
        const ai = await ArkAI.understand(state.engine, state.settings, them, me);
        facts = ArkEvidence.mergeFacts(facts, ai);
        aiNote = 'read by ' + ENGINE_NAMES[state.engine];
      } catch (err) {
        aiNote = 'AI unavailable (' + err.message + ') — read by rules';
      }
    }

    // 2b RESEARCH (Deep Mode)
    let extra = [];
    if (state.settings.deepMode && state.settings.apiKey) {
      setBusy(true, 'Step 2/5 · Searching company news…');
      try {
        extra = await ArkAI.research(state.settings, them, me);
        if (extra.length) facts.companyNews = extra[0];
      } catch (err) {
        aiNote += ' · news search failed';
      }
    }

    // 3 SCORE
    setBusy(true, 'Step 3/5 · Scoring…');
    state.facts = facts;
    state.notebook = ArkEvidence.buildNotebook(them, me, extra);
    state.scoreInfo = ArkScoring.scoreFacts(facts, state.weights);
    state.hooks = ArkScoring.buildHooks(facts, me, them);
    state.hook = state.hooks[0];

    // Existing contact for this profile? keep its id, stage and edits.
    const existing = await ArkStore.findByProfileUrl(them.profileUrl);
    state.contact = existing || ArkStore.newContact({ source: 'page' });
    Object.assign(state.contact, {
      name: them.name, headline: them.headline || '', company: them.currentCompany || '', profileUrl: them.profileUrl || '',
      score: state.scoreInfo.score, points: state.scoreInfo.points, reasons: state.scoreInfo.reasons, insight: insightOf(state.scoreInfo),
      facts, hooks: state.hooks, notebookText: notebookText(), engineNote: aiNote,
      themSnapshot: snapshot(them)
    });
    if (them.isConnected && state.contact.stage === 'drafted') ArkStore.setStage(state.contact, 'connected');

    // 5 WRITE + 6 CHECK (both drafts)
    setBusy(true, 'Step 4/5 · Writing drafts…');
    const keepInvite = existing && existing.edited && existing.edited.invite;
    const keepAfter = existing && existing.edited && existing.edited.afterAccept;
    state.contact.hookId = state.hook.id; state.contact.hookType = state.hook.type; state.contact.hookLine = state.hook.line;
    if (!keepInvite) state.contact.drafts.invite = await produceDraft('invite');
    setBusy(true, 'Step 5/5 · Checking drafts…');
    if (!keepAfter) state.contact.drafts.afterAccept = await produceDraft('afterAccept');
    if (existing) await ArkStore.saveContact(state.contact);

    renderResult();
    showDraft(state.contact.stage === 'connected' ? 'afterAccept' : 'invite');
    status(keepInvite || keepAfter ? 'Re-analysed. Your edited drafts were kept.' : 'Analysis ready. Open “Why this score” to review the evidence.', 'success');
  } catch (err) {
    status(err.message + ' You can add this person manually instead.', 'error');
  } finally {
    setBusy(false, state.contact ? 'Re-analyse this profile' : 'Analyse this profile');
  }
}

function insightOf(si) {
  return { coverage: si.coverage, replyChance: si.replyChance, careerHelp: si.careerHelp, action: si.action, missing: si.missing };
}

// Your own LinkedIn profile → fill My profile in one click.
function offerImport(them) {
  status('');
  $('result').classList.add('hidden');
  let el = $('self-import');
  if (!el) { el = document.createElement('div'); el.id = 'self-import'; el.className = 'card'; $('analyse-box').after(el); }
  const school = them.topSchool || (them.educationEntries || [])[0] || '';
  const loc = String(them.location || '').split(',').map(s => s.trim()).filter(Boolean);
  const country = loc.length > 1 ? loc[loc.length - 1] : '';
  const companies = [them.topCompany || them.currentCompany].concat(them.pastCompanies || []).filter(Boolean);
  el.innerHTML = `<div class="card-title">This is your own profile</div>
    <div class="hint">Use it to fill My profile: ${esc([them.name, school.split(' — ')[0], loc[0], companies.join(', ')].filter(Boolean).join(' · '))}</div>
    <div class="action-row"><button class="btn btn-primary btn-sm" id="do-import">Import into My profile</button></div>`;
  el.querySelector('#do-import').addEventListener('click', async () => {
    const me = state.me;
    const fill = (k, v) => { if (v && !me[k]) me[k] = v; };
    fill('name', them.name); fill('university', school.split(' — ')[0]); fill('city', loc[0]);
    if (country && !/australia/i.test(country)) fill('homeCountry', country);
    fill('pastCompanies', companies.join(', '));
    await ArkStore.saveProfile(me);
    renderProfileForm();
    el.innerHTML = '<div class="card-title">✓ Imported</div><div class="hint">Now add your target role and proof project in My profile.</div>';
    $('setup-nudge').classList.toggle('hidden', !!(me.targetRole && me.projectName));
  });
}

function snapshot(them) {
  return {
    name: them.name, headline: them.headline, currentTitle: them.currentTitle, currentCompany: them.currentCompany,
    location: them.location, educationEntries: them.educationEntries, pastCompanies: them.pastCompanies,
    recentPosts: (them.recentPosts || []).slice(0, 3), profileUrl: them.profileUrl, degree: them.degree, mutuals: them.mutuals,
    topSchool: them.topSchool, topCompany: them.topCompany, sharedSchoolSignal: them.sharedSchoolSignal,
    sharedCompanySignal: them.sharedCompanySignal, isStudent: them.isStudent,
    projects: them.projects, certifications: them.certifications,
    experienceItems: them.experienceItems, educationItems: them.educationItems, skillItems: them.skillItems, readStats: them.readStats
  };
}

function notebookText() {
  return state.notebook.map(n => n.text).join(' \n ') + ' ' + [state.me.name, state.me.city, state.me.university, state.me.targetRole, state.me.projectName, state.me.projectLink].join(' ');
}

// Write → check → (AI only) fix with exact feedback, max 2 tries → fall back to template.
async function produceDraft(kind, opts) {
  opts = opts || {};
  const me = state.me, them = state.them || state.contact.themSnapshot || { name: state.contact.name };
  const voice = ArkWriter.analyseVoice(me.voiceSamples);
  const limit = kind === 'invite' ? (me.premium ? 300 : 200) : 700;
  const check = (text) => ArkVerifier.verify(text, {
    kind, premium: me.premium, notebookText: state.contact.notebookText || notebookText(),
    hook: state.hook, recipientFirst: ArkWriter.first(them.name)
  });
  const template = () => kind === 'invite'
    ? ArkWriter.inviteDraft({ them, me, hook: state.hook, variant: state.variant.invite, voice, premium: me.premium })
    : ArkWriter.afterAcceptDraft({ them, me, hook: state.hook, variant: state.variant.afterAccept, voice, facts: state.facts });

  if (state.engine === 'templates' || opts.template) return template();

  try {
    let previous = '', feedback = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      let text = await ArkAI.write(state.engine, state.settings, {
        kind, notebook: state.notebook.length ? state.notebook : [{ id: 'E1', who: 'them', field: 'name', text: them.name }],
        hook: state.hook, me, them, voiceSamples: me.voiceSamples, limit, feedback, previous, facts: state.facts
      });
      text = String(text || '').trim().replace(/^["“]|["”]$/g, '');
      const result = check(text);
      if (result.ok) return text;
      previous = text; feedback = result.feedback;
    }
    // AI kept failing a hard check — use the template so the user never gets a broken draft.
    return template();
  } catch (err) {
    status('AI writing failed (' + err.message + '). Used a template instead.', 'warning');
    return template();
  }
}

// ── Manual entry ──────────────────────────────────────────────────────────────
function showManual() {
  $('no-profile').classList.add('hidden');
  $('analyse-box').classList.add('hidden');
  $('result').classList.add('hidden');
  $('manual-box').classList.remove('hidden');
  if (state.onProfile) $('m-url').value = state.tabUrl.split('?')[0];
}

function detailToHook(detail, idx, them) {
  const d = detail.trim().replace(/\.$/, '');
  let m;
  if ((m = d.match(/(?:studied|study|graduated|alum\w*)\s+(?:at|from)\s+(.+)/i))) {
    const s = ArkScoring.shortSchool(m[1]);
    return { id: 'm' + idx, type: 'school', strength: 9 - idx, label: '🎓 ' + d, line: `Fellow ${s} grad here`, keyword: s, field: 'education', fact: m[1] };
  }
  if ((m = d.match(/posted (?:about|on)\s+(.+)/i))) {
    return { id: 'm' + idx, type: 'post', strength: 9 - idx, label: '📢 ' + d, line: `Saw your post about ${m[1]}`, keyword: m[1].split(' ')[0], field: 'post', fact: d };
  }
  if ((m = d.match(/(?:from|moved from)\s+([A-Z][\w ]+)/))) {
    return { id: 'm' + idx, type: 'country', strength: 8 - idx, label: '🌏 ' + d, line: `I also moved here from ${m[1].trim()}`, keyword: m[1].trim(), field: 'home', fact: m[1] };
  }
  if ((m = d.match(/(?:worked|work) at\s+(.+)/i))) {
    return { id: 'm' + idx, type: 'company', strength: 8 - idx, label: '🏢 ' + d, line: `We both spent time at ${m[1]}`, keyword: m[1], field: 'past_company', fact: m[1] };
  }
  return { id: 'm' + idx, type: 'manual', strength: 6 - idx, label: '✏️ ' + d, line: `I noticed you ${d.replace(/^(she|he|they)\s+/i, '')}`, keyword: d.split(' ').slice(-1)[0], field: 'detail', fact: d };
}

async function createManual() {
  const name = $('m-name').value.trim();
  const d1 = $('m-detail1').value.trim();
  if (!name || !d1) { status('Add their name and at least one detail.', 'error'); return; }
  const d2 = $('m-detail2').value.trim();
  const connected = $('m-connected').checked;
  const them = {
    name, currentCompany: $('m-company').value.trim(), currentTitle: $('m-title').value.trim(),
    headline: [$('m-title').value.trim(), $('m-company').value.trim()].filter(Boolean).join(' at '),
    profileUrl: $('m-url').value.trim(), educationEntries: [], pastCompanies: [], recentPosts: [],
    degree: connected ? '1st' : null, mutuals: null, isConnected: connected
  };
  const hooks = [d1, d2].filter(Boolean).map((d, i) => detailToHook(d, i, them));
  hooks.forEach(h => {
    if (h.field === 'education') them.educationEntries.push(h.fact);
    if (h.field === 'post') them.recentPosts.push({ text: h.fact, stamp: '' });
    if (h.field === 'past_company') them.pastCompanies.push(h.fact);
  });
  state.them = them;
  let facts = ArkEvidence.ruleFacts(them, state.me);
  hooks.forEach(h => { if (h.type === 'country') facts.sharedCountry = h.fact; if (h.type === 'post' && !facts.post) facts.post = { text: h.fact, daysAgo: null, relevant: true }; });
  state.facts = facts;
  state.notebook = ArkEvidence.buildNotebook(them, state.me, []);
  hooks.forEach(h => state.notebook.push({ id: 'E' + (state.notebook.length + 1), who: 'them', field: 'detail', text: h.fact }));
  state.scoreInfo = ArkScoring.scoreFacts(facts, state.weights);
  state.hooks = hooks;
  state.hook = hooks[0];

  const existing = them.profileUrl ? await ArkStore.findByProfileUrl(them.profileUrl) : null;
  state.contact = existing || ArkStore.newContact({ source: 'manual' });
  Object.assign(state.contact, {
    name, headline: them.headline, company: them.currentCompany, profileUrl: them.profileUrl,
    score: state.scoreInfo.score, points: state.scoreInfo.points, reasons: state.scoreInfo.reasons, insight: insightOf(state.scoreInfo),
    facts, hooks, notebookText: notebookText(), engineNote: 'entered manually', themSnapshot: snapshot(them),
    hookId: state.hook.id, hookType: state.hook.type, hookLine: state.hook.line
  });
  if (connected && state.contact.stage === 'drafted') ArkStore.setStage(state.contact, 'connected');
  $('manual-go').disabled = true;
  state.contact.drafts.invite = await produceDraft('invite');
  state.contact.drafts.afterAccept = await produceDraft('afterAccept');
  $('manual-go').disabled = false;
  await ArkStore.saveContact(state.contact);   // manual contacts are saved straight away
  $('manual-box').classList.add('hidden');
  renderResult();
  showDraft(connected ? 'afterAccept' : 'invite');
  status('Drafts ready and saved to your Tracker.', 'success');
}

// ── Render result ─────────────────────────────────────────────────────────────
function openContact(c) {
  state.contact = c;
  state.them = c.themSnapshot || { name: c.name, headline: c.headline, currentCompany: c.company, profileUrl: c.profileUrl };
  state.facts = c.facts || null;
  state.hooks = c.hooks || [];
  state.hook = state.hooks.find(h => h.id === c.hookId) || state.hooks[0] || null;
  state.scoreInfo = c.points ? Object.assign({ score: c.score, points: c.points, reasons: c.reasons || [] }, c.insight || {}) : null;
  state.notebook = ArkEvidence.buildNotebook(state.them, state.me, c.facts && c.facts.companyNews ? [c.facts.companyNews] : []);
  $('no-profile').classList.add('hidden');
  $('manual-box').classList.add('hidden');
  renderResult();
  showDraft(['connected', 'replied', 'call', 'referral'].includes(c.stage) ? 'afterAccept' : 'invite');
  switchTab('current');
}

function renderResult() {
  const c = state.contact;
  $('result').classList.remove('hidden');
  $('p-name').textContent = c.name || 'Unknown';
  $('p-headline').textContent = c.headline || c.company || '';
  $('p-stage').textContent = ArkStore.STAGE_LABELS[c.stage] || 'Drafted';
  $('p-stage').className = 'stage-pill stage-' + c.stage;
  $('p-engine').textContent = c.engineNote ? '· ' + c.engineNote : '';

  const score = c.score ?? (state.scoreInfo && state.scoreInfo.score);
  $('score-num').textContent = score == null ? '–' : score;
  $('score-label').textContent = score == null ? 'limited data' : state.scoreInfo?.coverage?.count < 4 ? 'partial score' : 'priority';
  const ring = $('score-ring');
  ring.style.setProperty('--pct', (score || 0) + '%');
  ring.className = 'score-ring ' + (score >= 70 ? 'hi' : score >= 40 ? 'mid' : 'lo');

  // Plain-language reading
  const ins = $('insights');
  const si = state.scoreInfo;
  if (si && si.replyChance) {
    const relLabel = { classmate: 'Classmate', ex_colleague: 'Ex-colleague', alumni: 'Same university', connection: 'Connection', friend_of_friend: 'Friend of a friend', stranger: 'New contact' }[state.facts && state.facts.relationship] || '—';
    ins.innerHTML = `
      <div class="ins"><span>Who</span><b>${esc(relLabel)}</b></div>
      <div class="ins"><span>Reachability</span><b class="lvl-${esc(si.replyChance.split(' ')[0].toLowerCase())}">${esc(si.replyChance)}</b></div>
      <div class="ins"><span>Career help</span><b class="lvl-${esc(si.careerHelp.split(' ')[0].toLowerCase())}">${esc(si.careerHelp)}</b></div>
      <div class="ins wide"><span>Best move</span><b>${esc(si.action)}</b></div>`;
    ins.classList.remove('hidden');
  } else ins.classList.add('hidden');

  // Factor breakdown
  $('learn-note').classList.toggle('hidden', !(state.learning && state.learning.status === 'ready' && state.settings.useLearned !== false));
  const f = $('factors');
  f.innerHTML = '';
  if (state.scoreInfo) {
    for (const crit of ArkScoring.CRITERIA) {
      const pts = state.scoreInfo.points[crit];
      if (pts == null) {
        const row = document.createElement('div');
        row.className = 'factor unknown';
        row.innerHTML = `<div class="factor-top"><span>${ArkScoring.CRITERIA_LABELS[crit]}</span><b>—</b></div><div class="bar"></div><div class="factor-reason">${esc(((state.scoreInfo.reasons || []).find(r => r.c === crit) || {}).text || 'Not scored yet')}</div>`;
        f.appendChild(row);
        continue;
      }
      const w = state.weights[crit];
      const reason = (state.scoreInfo.reasons || []).find(r => r.c === crit);
      const row = document.createElement('div');
      row.className = 'factor';
      row.innerHTML = `
        <div class="factor-top"><span>${ArkScoring.CRITERIA_LABELS[crit]} <span class="muted">${Math.round(w * 100)}%</span></span><b>${pts}/10</b></div>
        <div class="bar"><div class="bar-fill" style="width:${pts * 10}%"></div></div>
        <div class="factor-reason">${esc(reason ? reason.text : '')}</div>`;
      f.appendChild(row);
    }
  }

  // Evidence: every point with where it came from, plus what we read about them
  const ev = (state.facts && state.facts.evidence) || [];
  $('evidence-list').innerHTML = ev.length
    ? ev.map(x => `<li>✓ ${esc(x.text)} <span class="muted">— ${esc(x.source)}</span></li>`).join('')
    : '<li class="muted">Nothing verified in common yet. Fill My profile (education, experience, skills) to find more.</li>';
  const tp = state.them ? ArkEvidence.theirProfile(state.them) : null;
  const rs = state.them && state.them.readStats;
  const coverage = si?.coverage;
  const stale = state.them && (state.contact?.source || 'page') === 'page' && !state.them.readStats?.details;   // manual contacts have no page read
  const schools = rows => rows.map(x => [x.school, x.degree, x.years].filter(Boolean).join(' · '));
  const list = (label, items) => `<details><summary>${esc(label)} (${items.length})</summary>
    ${items.length ? `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : '<p class="muted">No entries available</p>'}</details>`;
  const matched = (state.facts?.educationMatches || []).map(pair => {
    const relation = [pair.school ? 'Same institution' : '', pair.program ? 'Matching program' : pair.fields.length ? 'Related field' : '',
      pair.overlap === true && pair.school ? 'Overlapping study years' : pair.overlap === false && pair.school ? 'Different study years' : ''].filter(Boolean);
    return `${relation.join(' · ')} — You: ${schools([pair.mine])[0]} / Them: ${schools([pair.theirs])[0]}`;
  });
  if (state.facts?.sameSchool && !(state.facts.educationMatches || []).some(pair => pair.school)) {
    const schoolEvidence = ev.find(item => /^same school:|^shared education/i.test(item.text));
    if (schoolEvidence) matched.unshift(`${schoolEvidence.text} — ${schoolEvidence.source}`);
  }
  const sectionNames = { experience: 'Experience', education: 'Education', skills: 'Skills' };
  const availability = Object.entries(sectionNames).map(([key, label]) => {
    const detail = rs?.details?.[key];
    const visibility = detail === 'details' ? 'section page and summary' : detail === 'unavailable' ? 'section page unavailable; summary used' :
      rs?.sectionsFound?.includes(label) ? 'profile summary' : 'not available';
    return `${label}: ${visibility}`;
  });
  $('their-bg').innerHTML = (stale ? '<div class="notice">Older saved analysis. Re-analyse to update the evidence.</div>' : '') + (tp ? `
    ${coverage ? `<p class="muted">${coverage.count}/${coverage.total} factors scored${coverage.count < coverage.total ? ' · partial evidence' : ''}</p>` : ''}
    ${rs ? `<p class="muted">${esc(availability.join(' · '))}</p>` : ''}
    ${rs?.identitySource ? `<p class="muted">Name source: ${esc(rs.identitySource)}</p>` : ''}
    ${list('Education comparison', matched)}
    ${list('Their education', schools(tp.education))}
    ${list('Your education', schools(eduList(state.me)))}
    ${list('Their experience', tp.experience.map(x => [[x.title, x.company].filter(Boolean).join(' at '), x.years].filter(Boolean).join(' · ')))}
    ${list('Their skills', tp.skills)}
    ${state.them.projects?.length ? list('Their projects', state.them.projects) : ''}
    ${state.them.certifications?.length ? list('Their certifications', state.them.certifications) : ''}
    <div class="compare"><b>Your target:</b> ${esc(state.me.targetRole || 'not set')} · <b>Your skills:</b> ${esc((state.me.skills || []).join(', ') || 'none saved')}</div>` : '');

  // Hooks
  const h = $('hooks');
  h.innerHTML = '';
  state.hooks.forEach(hook => {
    const lab = document.createElement('label');
    lab.className = 'hook' + (state.hook && hook.id === state.hook.id ? ' selected' : '');
    lab.innerHTML = `<input type="radio" name="hook" ${state.hook && hook.id === state.hook.id ? 'checked' : ''}/> <span>${esc(hook.label)}</span>`;
    lab.querySelector('input').addEventListener('change', () => chooseHook(hook));
    h.appendChild(lab);
  });
  $('hook-notice').classList.add('hidden');

  renderSimilar();
}

function renderSimilar() {
  const me = state.me, them = state.them || {};
  const box = $('similar-links');
  box.innerHTML = '';
  const links = [];
  const role = me.targetRole || (state.facts && state.facts.theirTitle) || '';
  if (role && them.currentCompany) links.push([`${role} at ${them.currentCompany}`, `${role} ${them.currentCompany}`]);
  if (role && me.university) links.push([`${role} · ${ArkScoring.shortSchool(me.university)} alumni`, `${role} ${me.university}`]);
  if (role && me.city) links.push([`${role} in ${me.city}`, `${role} ${me.city}`]);
  if (!links.length) { box.innerHTML = '<span class="muted">Add your target role in My profile.</span>'; return; }
  links.forEach(([label, q]) => {
    const b = document.createElement('button');
    b.className = 'btn btn-secondary btn-sm';
    b.textContent = label + ' ↗';
    b.addEventListener('click', () => chrome.tabs.create({ url: 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(q) }));
    box.appendChild(b);
  });
}

// ── Hook switching keeps the user's edits ─────────────────────────────────────
async function chooseHook(hook) {
  const old = state.hook;
  state.hook = hook;
  const c = state.contact;
  c.hookId = hook.id; c.hookType = hook.type; c.hookLine = hook.line;
  let keptEdits = false;
  for (const kind of ['invite', 'afterAccept']) {
    const edited = c.edited && c.edited[kind];
    const swap = ArkWriter.swapOpening(c.drafts[kind], old, hook);
    if (swap.replaced) c.drafts[kind] = swap.text;
    else if (!edited) c.drafts[kind] = await produceDraft(kind);
    else keptEdits = true;
  }
  renderResult();
  showDraft(state.draftKind);
  const n = $('hook-notice');
  if (keptEdits) { n.textContent = 'You edited the opening yourself, so it was kept. Change it by hand or press Regenerate.'; n.classList.remove('hidden'); }
  if (c.stage !== 'drafted' || c.edited?.invite || c.edited?.afterAccept) await persist();
}

// ── Draft view ────────────────────────────────────────────────────────────────
function showDraft(kind) {
  state.draftKind = kind;
  document.querySelectorAll('.draft-tab').forEach(b => b.classList.toggle('active', b.dataset.draft === kind));
  const c = state.contact;
  $('draft').value = (c && c.drafts && c.drafts[kind]) || '';
  const already = state.facts && String(state.facts.degree || '').startsWith('1');
  document.querySelector('[data-draft="invite"]').textContent = already ? '1 · Invite (not needed)' : '1 · Invite note';
  document.querySelector('[data-draft="afterAccept"]').textContent = already ? '2 · Message' : '2 · After they accept';
  $('draft-label').textContent = kind === 'invite' ? 'Connection note' : already ? 'Direct message' : 'Message after they accept';
  if (already && kind === 'afterAccept') { $('draft-hint').textContent = 'You are already connected — send this as a direct message.'; updateMarkButton(); updateChecks(); return; }
  $('draft-hint').textContent = kind === 'invite' && already ? 'You are already connected, so no invite is needed. Use draft 2.' : kind === 'invite'
    ? 'Free LinkedIn accounts can add a personal note to only ~3 invites a month. Out of notes? Send the invite without one — draft 2 does the real work.'
    : 'Send this once they accept. It shares your project and asks one easy question.';
  updateMarkButton();
  updateChecks();
}

function updateMarkButton() {
  const c = state.contact, kind = state.draftKind, btn = $('mark-btn');
  if (!c) return;
  if (kind === 'invite') {
    btn.textContent = c.inviteSentAt ? '✓ Invite sent' : 'Mark invite sent';
    btn.disabled = !!c.inviteSentAt;
  } else {
    btn.textContent = c.messageSentAt ? '✓ Message sent' : 'Mark message sent';
    btn.disabled = !!c.messageSentAt;
  }
  $('connected-btn').classList.toggle('hidden', !!c.connectedAt || c.stage === 'connected');
  $('open-li-btn').classList.toggle('hidden', !(c.profileUrl));
}

function updateChecks() {
  const text = $('draft').value;
  const kind = state.draftKind;
  const limit = kind === 'invite' ? (state.me.premium ? 300 : 200) : 700;
  const cc = $('char-count');
  cc.textContent = `${text.length}/${limit}`;
  cc.classList.toggle('over', text.length > limit);
  const res = ArkVerifier.verify(text, {
    kind, premium: state.me.premium,
    notebookText: (state.contact && state.contact.notebookText) || notebookText(),
    hook: state.hook, recipientFirst: ArkWriter.first(state.contact && state.contact.name)
  });
  $('checks').innerHTML = res.checks.map(ch =>
    `<li class="${ch.pass ? 'pass' : ch.severity === 'warn' ? 'warn' : 'fail'}">${ch.pass ? '✓' : ch.severity === 'warn' ? '!' : '✗'} ${esc(ch.label)}</li>`).join('');
}

let editTimer = null;
function onDraftEdit() {
  const c = state.contact;
  if (!c) return;
  c.drafts[state.draftKind] = $('draft').value;
  c.edited = Object.assign({}, c.edited, { [state.draftKind]: true });
  updateChecks();
  clearTimeout(editTimer);
  editTimer = setTimeout(persist, 600);   // edits survive closing the popup
}

async function regenerate() {
  const c = state.contact;
  if (!c) return;
  const kind = state.draftKind;
  if (c.edited && c.edited[kind] && !confirm('Regenerate will replace your edits to this draft. Continue?')) return;
  state.variant[kind]++;
  $('regen-btn').disabled = true;
  c.drafts[kind] = await produceDraft(kind);
  c.edited = Object.assign({}, c.edited, { [kind]: false });
  $('regen-btn').disabled = false;
  showDraft(kind);
}

// Copy reports success only when the clipboard confirms it.
async function copyDraft() {
  const text = $('draft').value;
  const btn = $('copy-btn');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '✓ Copied';
    await persist();
  } catch (_) {
    $('draft').select();
    btn.textContent = 'Copy failed — press Ctrl/⌘+C';
  }
  setTimeout(() => { btn.textContent = 'Copy'; }, 2200);
}

async function markSent() {
  const c = state.contact;
  if (!c) return;
  if (state.draftKind === 'invite') {
    if (c.stage === 'drafted') ArkStore.setStage(c, 'invite_sent');
    else c.inviteSentAt = c.inviteSentAt || Date.now();
  } else {
    if (!['connected', 'replied', 'call', 'referral'].includes(c.stage)) ArkStore.setStage(c, 'connected');
    c.messageSentAt = Date.now();
  }
  await persist();
  renderResult();
  showDraft(state.draftKind);
  status(state.draftKind === 'invite' ? 'Saved. When they accept, reopen them here and mark Connected.' : 'Saved. You will get a follow-up reminder on day 4 if they do not reply.', 'success');
}

async function markConnected() {
  const c = state.contact;
  if (!c) return;
  if (!c.inviteSentAt) c.inviteSentAt = Date.now();
  ArkStore.setStage(c, 'connected');
  await persist();
  renderResult();
  showDraft('afterAccept');
  status('Connected! Your "after they accept" message is ready below.', 'success');
}

async function persist() {
  if (!state.contact) return;
  await ArkStore.saveContact(state.contact);
  chrome.runtime.sendMessage({ action: 'refreshBadge' }, () => void chrome.runtime.lastError);
  updateDueBadge();
}

// ═══════════════════════════════════ TRACKER ══════════════════════════════════
function wireTracker() {
  $('report-btn').addEventListener('click', async () => {
    const contacts = await ArkStore.getContacts();
    const r = ArkWriter.coachReport(contacts);
    const L = await recomputeWeights(contacts);
    const learnLine = L.status === 'ready'
      ? `• Learning: ${L.message}`
      : `• Learning: ${L.n}/${ArkLearning.MIN_OUTCOMES} finished conversations so far`;
    $('report-text').value = r.text + '\n' + learnLine;
    $('report-box').classList.toggle('hidden');
  });
  $('report-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('report-text').value); $('report-copy').textContent = '✓ Copied'; }
    catch (_) { $('report-text').select(); $('report-copy').textContent = 'Press Ctrl/⌘+C'; }
    setTimeout(() => { $('report-copy').textContent = 'Copy report'; }, 2200);
  });
  $('csv-btn').addEventListener('click', async () => {
    const csv = ArkWriter.toCSV(await ArkStore.getContacts());
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'ark-outreach-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

async function updateDueBadge() {
  const contacts = await ArkStore.getContacts();
  const due = contacts.filter(c => ArkStore.dueReminder(c)).length;
  const b = $('due-badge');
  b.textContent = due;
  b.classList.toggle('hidden', !due);
}

function renderStats(contacts) {
  const report = ArkWriter.coachReport(contacts).stats;
  const goal = 20;
  $('stats').innerHTML = `
    <div class="stat"><div class="stat-num">${report.sentThisWeek}<small>/${goal}</small></div><div class="stat-label">Invites this week</div>
      <div class="bar"><div class="bar-fill" style="width:${Math.min(100, report.sentThisWeek / goal * 100)}%"></div></div></div>
    <div class="stat"><div class="stat-num">${report.rate}<small>%</small></div><div class="stat-label">Reply rate</div></div>
    <div class="stat"><div class="stat-num">${report.calls}</div><div class="stat-label">Calls</div></div>`;
}

async function renderTracker() {
  const contacts = await ArkStore.getContacts();
  updateDueBadge();
  const L = await recomputeWeights(contacts);
  $('learn-strip').innerHTML = L.status === 'ready'
    ? `<b>Scores tuned by your replies</b><span>${esc(L.message)}</span>`
    : `<b>Learning from your replies</b><span>${L.n} of ${ArkLearning.MIN_OUTCOMES} finished conversations · ${L.replies} replies</span><i style="--p:${Math.min(100, L.n / ArkLearning.MIN_OUTCOMES * 100)}%"></i>`;
  $('learn-strip').className = 'learn-strip ' + (L.status === 'ready' ? 'ready' : '');
  renderStats(contacts);

  const counts = { all: contacts.length, due: contacts.filter(c => ArkStore.dueReminder(c)).length };
  ArkStore.STAGES.forEach(s => { counts[s] = contacts.filter(c => c.stage === s).length; });
  const chips = [['all', 'All'], ['due', 'Follow-up due']].concat(ArkStore.STAGES.map(s => [s, ArkStore.STAGE_LABELS[s]]))
    .filter(([k]) => k === 'all' || counts[k]);
  $('stage-chips').innerHTML = chips.map(([k, l]) => `<button class="chip ${state.stageFilter === k ? 'active' : ''}" data-k="${k}">${l} ${counts[k]}</button>`).join('');
  $('stage-chips').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => { state.stageFilter = b.dataset.k; renderTracker(); }));

  const list = $('contact-list');
  list.innerHTML = '';
  let shown = contacts.slice();
  if (state.stageFilter === 'due') shown = shown.filter(c => ArkStore.dueReminder(c));
  else if (state.stageFilter !== 'all') shown = shown.filter(c => c.stage === state.stageFilter);
  shown.sort((a, b) => (ArkStore.dueReminder(b) ? 1 : 0) - (ArkStore.dueReminder(a) ? 1 : 0) || b.updatedAt - a.updatedAt);
  $('no-contacts').classList.toggle('hidden', contacts.length > 0);
  shown.forEach(c => list.appendChild(contactCard(c)));
}

function contactCard(c) {
  const due = ArkStore.dueReminder(c);
  const card = document.createElement('div');
  card.className = 'contact-card' + (due ? ' due' : '');
  const date = new Date(c.updatedAt || c.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  card.innerHTML = `
    <div class="contact-header">
      <div class="contact-info">
        <div class="contact-name">${esc(c.name || 'Unknown')} ${c.score != null ? `<span class="score-chip">${c.score}</span>` : ''}</div>
        <div class="contact-meta">${esc(c.headline || c.company || '')}</div>
      </div>
      <div class="contact-right"><span class="stage-pill stage-${c.stage}">${ArkStore.STAGE_LABELS[c.stage]}</span><div class="contact-date">${esc(date)}</div></div>
    </div>
    ${due ? `<div class="due-line">🔔 ${esc(due.text)}</div>` : ''}
    <div class="contact-actions">
      <button class="btn-link" data-act="open">Open drafts</button>
      <button class="btn-link" data-act="more">More ▾</button>
    </div>
    <div class="contact-more hidden"></div>`;
  card.querySelector('[data-act="open"]').addEventListener('click', () => openContact(c));
  card.querySelector('[data-act="more"]').addEventListener('click', () => {
    const more = card.querySelector('.contact-more');
    if (more.classList.toggle('hidden')) return;
    renderMore(more, c, due);
  });
  return card;
}

function renderMore(box, c, due) {
  const nextStages = ['invite_sent', 'connected', 'replied', 'call', 'referral', 'closed'];
  const themFor = c.themSnapshot || { name: c.name, currentCompany: c.company };
  let html = `<div class="section-label">Move to stage</div><div class="chips">${nextStages.map(s =>
    `<button class="chip ${c.stage === s ? 'active' : ''}" data-stage="${s}">${ArkStore.STAGE_LABELS[s]}</button>`).join('')}</div>`;
  if (c.stage === 'connected' && !c.messageSentAt) html += `<button class="btn btn-secondary btn-sm" data-act="msgsent">Mark "after accept" message sent</button>`;

  if (due && (due.kind === 'followup1' || due.kind === 'followup2')) {
    const n = due.kind === 'followup1' ? 1 : 2;
    html += `<div class="section-label">Follow-up ${n}</div><textarea class="message-textarea" rows="3" data-fu>${esc(ArkWriter.followUpDraft({ them: themFor, n }))}</textarea>
      <div class="action-row"><button class="btn btn-secondary btn-sm" data-act="fucopy">Copy</button><button class="btn btn-primary btn-sm" data-act="fusent">Mark follow-up sent</button></div>`;
  }

  html += `<div class="section-label">They replied? Paste it</div>
    <textarea class="message-textarea" rows="3" data-reply placeholder="Paste their reply here">${esc(c.lastReply || '')}</textarea>
    <button class="btn btn-secondary btn-sm" data-act="reply">Suggest my next message</button>
    <div data-reply-out></div>`;

  if (['call', 'replied', 'referral'].includes(c.stage)) {
    const card = ArkWriter.prepCard({ them: themFor, me: state.me, facts: c.facts });
    html += `<div class="section-label">Coffee-chat prep</div><div class="prep"><p><b>Your 30-second intro:</b> ${esc(card.intro)}</p><ol>${card.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol><p class="muted">${esc(card.tip)}</p></div>`;
  }
  html += `<div class="section-label">Notes</div><textarea class="message-textarea" rows="2" data-notes placeholder="Anything to remember">${esc(c.notes || '')}</textarea>
    <div class="action-row"><button class="btn-link danger" data-act="delete">Delete contact</button></div>`;
  box.innerHTML = html;

  box.querySelectorAll('[data-stage]').forEach(b => b.addEventListener('click', async () => {
    ArkStore.setStage(c, b.dataset.stage);
    if (b.dataset.stage === 'invite_sent' && !c.inviteSentAt) c.inviteSentAt = Date.now();
    await ArkStore.saveContact(c); chrome.runtime.sendMessage({ action: 'refreshBadge' }, () => void chrome.runtime.lastError);
    renderTracker();
  }));
  const on = (sel, fn) => { const el = box.querySelector(sel); if (el) el.addEventListener('click', fn); };
  on('[data-act="msgsent"]', async () => { c.messageSentAt = Date.now(); await ArkStore.saveContact(c); renderTracker(); });
  on('[data-act="fucopy"]', async (e) => {
    try { await navigator.clipboard.writeText(box.querySelector('[data-fu]').value); e.target.textContent = '✓ Copied'; }
    catch (_) { box.querySelector('[data-fu]').select(); e.target.textContent = 'Press Ctrl/⌘+C'; }
  });
  on('[data-act="fusent"]', async () => {
    c.followUpsSent = (c.followUpsSent || 0) + 1; c.messageSentAt = Date.now();
    await ArkStore.saveContact(c); chrome.runtime.sendMessage({ action: 'refreshBadge' }, () => void chrome.runtime.lastError); renderTracker();
  });
  on('[data-act="reply"]', async (e) => {
    const reply = box.querySelector('[data-reply]').value.trim();
    if (!reply) return;
    e.target.disabled = true; e.target.textContent = 'Thinking…';
    let type, draft;
    try {
      const ai = await ArkAI.replyAssist(state.engine, state.settings, { reply, them: themFor, me: state.me, history: c.drafts?.afterAccept });
      if (ai) { type = ai.type; draft = ai.draft; }
    } catch (_) { /* fall back to rules */ }
    if (!type) { type = ArkWriter.classifyReplyRules(reply); draft = ArkWriter.replyDraft({ type, them: themFor, me: state.me }); }
    c.lastReply = reply; c.replyType = type;
    if (!c.repliedAt) ArkStore.setStage(c, type === 'referral_offer' ? 'referral' : 'replied');
    await ArkStore.saveContact(c);
    chrome.runtime.sendMessage({ action: 'refreshBadge' }, () => void chrome.runtime.lastError);
    renderStats(await ArkStore.getContacts());
    const labels = { interested: '👍 Interested', busy: '⏳ Busy', not_interested: '🙅 Not interested', referral_offer: '⭐ Referral offer', question: '❓ Question' };
    box.querySelector('[data-reply-out]').innerHTML = `<div class="reply-type">${labels[type] || type} — stage updated</div>
      <textarea class="message-textarea" rows="4">${esc(draft)}</textarea>`;
    e.target.disabled = false; e.target.textContent = 'Suggest my next message';
  });
  const notes = box.querySelector('[data-notes]');
  notes.addEventListener('change', async () => { c.notes = notes.value; await ArkStore.saveContact(c); });
  on('[data-act="delete"]', async () => {
    if (!confirm(`Delete ${c.name} from your tracker? This cannot be undone.`)) return;
    await ArkStore.deleteContact(c.id);
    renderTracker();
  });
}

// ═════════════════════════════════ MY PROFILE ═════════════════════════════════
const PROFILE_FIELDS = {
  'f-name': 'name', 'f-target': 'targetRole', 'f-city': 'city', 'f-country': 'homeCountry',
  'f-story': 'story', 'f-project': 'projectName', 'f-project-link': 'projectLink',
  'f-project-result': 'projectResult', 'f-resume': 'resumeText', 'f-voice': 'voiceSamples'
};

function wireProfile() {
  $('save-profile-btn').addEventListener('click', saveProfile);
  // Reset all data: two clicks (no popup dialog), then a clean first-run start.
  let resetArmed = null;
  $('reset-all-btn').addEventListener('click', () => {
    const btn = $('reset-all-btn'), hint = $('reset-hint');
    if (!resetArmed) {
      btn.textContent = 'Click again to erase everything';
      hint.textContent = 'This cannot be undone.';
      resetArmed = setTimeout(() => { resetArmed = null; btn.textContent = 'Reset all data'; hint.textContent = 'Erases your profile, tracker and settings on this device.'; }, 4000);
      return;
    }
    clearTimeout(resetArmed); resetArmed = null;
    chrome.storage.local.clear(() => {
      try { chrome.runtime.sendMessage({ action: 'refreshBadge' }, () => void chrome.runtime.lastError); } catch (_) {}
      location.reload();
    });
  });
  $('translate-btn').addEventListener('click', () => translateResume({ auto: false }));
  $('f-resume').addEventListener('paste', () => setTimeout(maybeAutoParse, 50));
  $('f-resume').addEventListener('change', maybeAutoParse);
  $('f-resume-file').addEventListener('change', onResumeFile);
  $('import-li-btn').addEventListener('click', importLinkedIn);
  document.querySelectorAll('#tab-profile input, #tab-profile textarea').forEach(el => el.addEventListener('input', () => renderStrength(readForm())));
  $('test-key-btn').addEventListener('click', testKey);
  $('ahp-reset').addEventListener('click', () => {
    state.pairs = ArkScoring.DEFAULT_PAIRS.map(p => Object.assign({}, p));
    renderAhp();
  });
  $('f-voice').addEventListener('input', renderVoiceHint);
  $('download-model-btn').addEventListener('click', downloadModel);
  document.querySelectorAll('input[name="engine"]').forEach(r => r.addEventListener('change', async () => {
    state.settings.engine = r.value;
    await ArkStore.saveSettings(state.settings);
    await refreshEngine();
    renderEngineStatus();
  }));
}

function renderProfileForm() {
  for (const [id, key] of Object.entries(PROFILE_FIELDS)) $(id).value = state.me[key] || '';
  $('f-translated').value = (state.me.translatedFacts || []).join('\n');
  $('f-education').value = linesOf(eduList(state.me), e => [e.school, e.degree, e.years]);
  $('f-experience').value = linesOf(expList(state.me), e => [e.title, e.company, e.years]);
  $('f-skills').value = (state.me.skills || []).join(', ');
  $('f-premium').checked = !!state.me.premium;
  renderStrength(state.me);
  renderSources();
  $('f-apikey').value = state.settings.apiKey || '';
  document.querySelectorAll('input[name="engine"]').forEach(r => { r.checked = r.value === (state.settings.engine || 'auto'); });
  renderAhp();
  renderVoiceHint();
  renderEngineStatus();
}

function renderVoiceHint() {
  const v = ArkWriter.analyseVoice($('f-voice').value);
  $('voice-hint').textContent = v
    ? `Detected: "${v.greeting}" greeting · ${v.length} sentences · ${v.contractions ? 'uses' : 'avoids'} contractions · ${v.exclaim ? 'uses' : 'rarely uses'} "!"`
    : '';
}

function renderEngineStatus() {
  const s = state.onDevice;
  const text = {
    available: '✓ On-device AI is ready on this computer.',
    downloadable: 'On-device AI is supported — download the model once (Chrome manages it).',
    downloading: 'On-device model is downloading…',
    unavailable: 'This device cannot run the on-device model. Use Claude or templates.',
    unsupported: 'On-device AI needs Chrome 138+ on a supported computer.'
  }[s] || '';
  $('ondevice-status').textContent = text;
  $('download-model-btn').classList.toggle('hidden', s !== 'downloadable');
}

async function downloadModel() {
  const btn = $('download-model-btn');
  btn.disabled = true;
  try {
    const session = await LanguageModel.create({
      expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(m) { m.addEventListener('downloadprogress', e => { btn.textContent = `Downloading… ${Math.round(e.loaded * 100)}%`; }); }
    });
    session.destroy();
    btn.textContent = '✓ Downloaded';
    await refreshEngine();
    renderEngineStatus();
  } catch (err) {
    btn.textContent = 'Download failed: ' + err.message;
    btn.disabled = false;
  }
}

// AHP: six sliders, live weights + consistency ratio.
function renderAhp() {
  const box = $('ahp-sliders');
  box.innerHTML = '';
  const L = ArkScoring.CRITERIA_LABELS;
  state.pairs.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'ahp-row';
    row.innerHTML = `
      <div class="ahp-labels"><span>${L[p.a]}</span><span class="ahp-val" id="ahp-v${i}"></span><span>${L[p.b]}</span></div>
      <input type="range" min="-8" max="8" step="1" value="${-ArkScoring.valueToSlider(p.value)}" id="ahp-s${i}" />`;
    box.appendChild(row);
    const slider = row.querySelector('input');
    // Slider left = first criterion more important.
    slider.addEventListener('input', () => { p.value = ArkScoring.sliderToValue(-Number(slider.value)); renderAhpResult(); });
  });
  renderAhpResult();
}

function describe(v, a, b) {
  const L = ArkScoring.CRITERIA_LABELS;
  if (Math.abs(v - 1) < 0.01) return 'equal';
  const strong = v > 1 ? v : 1 / v;
  const who = v > 1 ? L[a] : L[b];
  const word = strong >= 7 ? 'much more' : strong >= 4 ? 'clearly more' : strong >= 2 ? 'a bit more' : 'slightly more';
  return `${who} ${word} (${Math.round(strong)}×)`;
}

function renderAhpResult() {
  state.pairs.forEach((p, i) => { $('ahp-v' + i).textContent = describe(p.value, p.a, p.b); });
  const info = ArkScoring.ahp(state.pairs);
  const bars = ArkScoring.CRITERIA.map(c => `
    <div class="factor-top"><span>${ArkScoring.CRITERIA_LABELS[c]}</span><b>${(info.weights[c] * 100).toFixed(1)}%</b></div>
    <div class="bar"><div class="bar-fill" style="width:${info.weights[c] * 100}%"></div></div>`).join('');
  $('ahp-result').innerHTML = `${bars}
    <div class="cr ${info.consistent ? 'ok' : 'bad'}">Consistency ratio ${info.CR.toFixed(3)} — ${info.consistent ? '✓ consistent (below 0.10)' : '✗ answers contradict each other; please review'}</div>`;
  renderLearning(info.weights);
}

// "Learning from your replies" — coach weights vs what your outcomes say vs what scoring uses.
function renderLearning(ahpWeights) {
  const box = $('learning-box');
  if (!box || !state.learning) return;
  const L = state.learning;
  const pct = (v) => (v * 100).toFixed(1) + '%';
  const label = ArkScoring.CRITERIA_LABELS;
  let html = `<div class="learn-head"><b>Learning from your replies</b><span class="${L.status === 'ready' ? 'ok' : ''}">${L.status === 'ready' ? 'Active' : 'Collecting'}</span></div>
    <p class="hint">${esc(L.message)}</p>`;
  if (L.status === 'ready') {
    const used = ArkLearning.effectiveWeights(ahpWeights, L, state.settings.useLearned !== false);
    html += `<table class="learn-table"><thead><tr><th></th><th>Coach</th><th>Your replies</th><th>Used</th></tr></thead><tbody>
      ${ArkScoring.CRITERIA.map(c => {
        const d = L.learned[c] - ahpWeights[c];
        return `<tr><td>${label[c]}</td><td>${pct(ahpWeights[c])}</td><td class="${d > 0.03 ? 'up' : d < -0.03 ? 'down' : ''}">${pct(L.learned[c])}</td><td><b>${pct(used[c])}</b></td></tr>`;
      }).join('')}</tbody></table>
      <div class="hint">Your pattern counts for ${Math.round(L.alpha * 100)}% (grows with more outcomes, never above 50%).</div>`;
  }
  const lifts = ArkScoring.CRITERIA.map(c => ({ c, l: L.lifts[c] }))
    .filter(x => x.l.strong != null && x.l.weak != null && x.l.nStrong >= 2 && x.l.nWeak >= 2);
  if (lifts.length) {
    html += `<ul class="learn-lifts">${lifts.map(x => `<li>Strong <b>${label[x.c].toLowerCase()}</b>: ${Math.round(x.l.strong * 100)}% replied <span class="muted">vs ${Math.round(x.l.weak * 100)}% when weak</span></li>`).join('')}</ul>`;
  }
  html += `<label class="switch"><input type="checkbox" id="use-learned" ${state.settings.useLearned !== false ? 'checked' : ''} ${L.status === 'ready' ? '' : 'disabled'} /><i></i><span>Use what my replies teach me in scores</span></label>`;
  box.innerHTML = html;
  const t = $('use-learned');
  t.addEventListener('change', async () => {
    state.settings.useLearned = t.checked;
    await ArkStore.saveSettings(state.settings);
    await recomputeWeights();
    renderLearning(ahpWeights);
  });
}

// ── Structured lists (education / experience) ───────────────────────────────
function eduList(me) {
  if (me.education && me.education.length) return me.education;
  return me.university ? [{ school: me.university, degree: '', years: '' }] : [];
}
function expList(me) {
  if (me.experience && me.experience.length) return me.experience;
  return String(me.pastCompanies || '').split(',').map(c => c.trim()).filter(Boolean).map(c => ({ title: '', company: c, years: '' }));
}
function linesOf(list, cols) { return list.map(e => cols(e).map(x => (x || '').trim()).join(' — ').replace(/(?: — )+$/, '')).join('\n'); }
function parseLines(text, keys) {
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    // Our own format uses " — "; only fall back to " - " / " | " when no em dash is present.
    const parts = (l.includes('—') ? l.split(/\s*—\s*/) : l.split(/\s+[|–]\s+|\s+-\s+/)).map(x => x.trim());
    const o = {}; keys.forEach((k, i) => { o[k] = k === 'years' ? parts.slice(i).join(' — ') : parts[i] || ''; });
    const y = l.match(/(?:19|20)\d{2}(?:\s*[-–—to]+\s*(?:[A-Za-z]{3,9}\.?\s+)?(?:(?:19|20)\d{2}|present|now))?/i);
    if (y && keys.includes('years') && !o.years && parts.length === 2 && y[0] === parts[1]) { o[keys[1]] = ''; o.years = y[0]; }
    return o;
  });
}
function mergeList(a, b, key) {
  const out = (a || []).slice();
  for (const x of b || []) {
    const k = key(x).toLowerCase();
    if (k && !out.some(y => key(y).toLowerCase() === k)) out.push(x);
  }
  return out;
}
// Current form → profile object (without saving)
function readForm() {
  const me = Object.assign({}, state.me);
  for (const [id, key] of Object.entries(PROFILE_FIELDS)) me[key] = $(id).value.trim();
  me.education = parseLines($('f-education').value, ['school', 'degree', 'years']).filter(e => e.school);
  me.experience = parseLines($('f-experience').value, ['title', 'company', 'years']).map(e => (!e.company && e.title ? { title: '', company: e.title, years: e.years } : e));
  me.skills = $('f-skills').value.split(',').map(x => x.trim()).filter(Boolean);
  me.translatedFacts = $('f-translated').value.split('\n').map(x => x.trim()).filter(Boolean);
  me.university = me.education[0] ? me.education[0].school : '';
  me.pastCompanies = [...new Set(me.experience.map(e => e.company).filter(Boolean))].join(', ');
  return me;
}

// ── Profile strength: what each piece unlocks in the score ──────────────────
const STRENGTH = [
  { k: 'targetRole', w: 25, label: 'Target role', unlocks: 'Role fit scoring', ok: me => !!me.targetRole },
  { k: 'education', w: 15, label: 'Education', unlocks: 'classmates & alumni', ok: me => eduList(me).length > 0 },
  { k: 'experience', w: 15, label: 'Experience', unlocks: 'ex-colleagues', ok: me => expList(me).length > 0 },
  { k: 'project', w: 15, label: 'Proof project', unlocks: 'message 2', ok: me => !!me.projectName },
  { k: 'place', w: 10, label: 'City & home country', unlocks: 'shared path', ok: me => !!(me.city && me.homeCountry) },
  { k: 'skills', w: 10, label: 'Skills', unlocks: 'better hooks', ok: me => (me.skills || []).length > 0 },
  { k: 'voice', w: 10, label: 'Voice sample', unlocks: 'sounds like you', ok: me => !!me.voiceSamples }
];
function renderStrength(me) {
  const pct = STRENGTH.reduce((s, x) => s + (x.ok(me) ? x.w : 0), 0);
  $('strength-pct').textContent = pct + '%';
  $('strength-bar').style.width = pct + '%';
  $('strength-list').innerHTML = STRENGTH.map(x => `<li class="${x.ok(me) ? 'done' : 'todo'}">${x.ok(me) ? '✓' : '○'} ${x.label} <span class="muted">· ${x.unlocks}</span></li>`).join('');
}
function renderSources() {
  const s = state.me.sources || {};
  const bits = [];
  if (s.linkedin) bits.push(`LinkedIn imported ${new Date(s.linkedin).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}`);
  if (s.resume) bits.push(`Resume read (${s.resume.name || 'text'})`);
  $('sources-line').textContent = bits.length ? '✓ ' + bits.join(' · ') : '';
}

// Bring new information into the form: fills empty fields, adds new list entries, never deletes.
function applyIncoming(r, opts) {
  const overwrite = !!(opts && opts.overwrite);
  const filled = [];
  const put = (id, v, label) => {
    v = Array.isArray(v) ? v.filter(Boolean).join(', ') : String(v || '').trim();
    if (!v || (!overwrite && $(id).value.trim()) || $(id).value.trim() === v) return;
    $(id).value = v; filled.push(label);
  };
  put('f-name', r.name, 'name'); put('f-target', r.targetRole, 'target role');
  put('f-country', r.homeCountry, 'home country'); put('f-city', r.city, 'city');
  put('f-story', r.story, 'story'); put('f-project', r.projectName, 'project'); put('f-project-link', r.projectLink, 'project link');
  put('f-project-result', r.projectResult, 'project result');
  const cur = readForm();
  const incomingEducation = (r.education || []).concat(r.university && !(r.education || []).length ? [{ school: r.university }] : []);
  const edu = cur.education.map(row => ({ ...row }));
  for (const item of incomingEducation) {
    if (!item.school) continue;
    const schoolRows = edu.filter(row => ArkEvidence.schoolsMatch(row.school, item.school));
    const normalizedDegree = ArkEvidence.norm(item.degree);
    const same = schoolRows.find(row => ArkEvidence.norm(row.degree) === normalizedDegree) ||
      schoolRows.find(row => !row.degree) || (!normalizedDegree ? schoolRows[0] : null);
    if (same) {
      same.degree ||= item.degree || '';
      same.years ||= item.years || '';
    } else edu.push(item);
  }
  const educationText = linesOf(edu, e => [e.school, e.degree, e.years]);
  if (educationText !== linesOf(cur.education, e => [e.school, e.degree, e.years])) {
    $('f-education').value = educationText;
    filled.push('education');
  }
  const extraExp = (r.experience || []).concat((r.pastCompanies || []).filter(c => !(r.experience || []).some(e => e.company === c)).map(c => ({ title: '', company: c, years: '' })));
  const exp = mergeList(cur.experience, extraExp, e => (e.title || '') + '|' + (e.company || ''));
  if (exp.length > cur.experience.length) { $('f-experience').value = linesOf(exp, e => [e.title, e.company, e.years]); filled.push('experience'); }
  const skills = [...new Set(cur.skills.concat(r.skills || []))];
  if (skills.length > cur.skills.length) { $('f-skills').value = skills.join(', '); filled.push('skills'); }
  if ((r.translatedFacts || []).length && (overwrite || !$('f-translated').value.trim())) { $('f-translated').value = r.translatedFacts.join('\n'); filled.push('Australian-ready facts'); }
  return filled;
}

// ── Upload resume: read on this computer first; Claude only if the PDF has no text layer ──
async function onResumeFile(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  if (file.size > 6 * 1024 * 1024) { $('resume-status').textContent = 'Please choose a file under 6 MB.'; return; }
  $('resume-status').textContent = `Reading ${file.name}…`;
  try {
    const r = await ArkFileText.extract(file);
    if (r.readable) {
      $('f-resume').value = r.text;
      state.resumeFileName = file.name;
      await translateResume({ auto: true, sourceName: file.name });
      return;
    }
    // Scanned / image-only PDF: no text layer → Claude can read it, if a key is set
    const key = state.settings.apiKey || $('f-apikey').value.trim();
    if (r.kind === 'pdf' && key) {
      state.pendingPdf = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.readAsDataURL(file); });
      await translateResume({ auto: true, sourceName: file.name });
      return;
    }
    $('resume-status').textContent = `${file.name} looks like a scanned image (no selectable text). Add a Claude key to read it, or upload a Word/PDF export instead.`;
  } catch (err) {
    $('resume-status').textContent = 'Could not read that file: ' + err.message;
  }
}

// ── Import from my LinkedIn (one click) ─────────────────────────────────────
// The background worker does the work and writes progress + result to storage; we watch it.
function runImport() {
  return new Promise(async (resolve, reject) => {
    let jobId = null;
    const done = (fn, v) => { chrome.storage.onChanged.removeListener(onChange); clearTimeout(timer); fn(v); };
    const onChange = (changes, area) => {
      const st = area === 'local' && changes.arkImport && changes.arkImport.newValue;
      if (!st || (jobId && st.jobId !== jobId)) return;
      if (st.status === 'running') $('resume-status').textContent = st.step || 'Reading…';
      if (st.status === 'done') done(resolve, st.data);
      if (st.status === 'error') done(reject, new Error(st.error));
    };
    const timer = setTimeout(() => done(reject, new Error('Timed out. Make sure you are signed in to LinkedIn in this browser.')), 90000);
    chrome.storage.onChanged.addListener(onChange);
    try { jobId = (await bg({ action: 'importMyLinkedIn' })).jobId; }
    catch (err) { done(reject, err); }
  });
}

async function importLinkedIn() {
  const btn = $('import-li-btn');
  btn.disabled = true; btn.textContent = 'Reading your LinkedIn…';
  $('resume-status').textContent = 'Opening your profile in a background tab (about 15 seconds)…';
  try {
    const { main, details } = await runImport();
    const filled = await applyLinkedInData(main, details);
    $('resume-status').textContent = filled.length
      ? `✓ Imported from LinkedIn and saved: ${filled.join(', ')}. Add your target role if it is still empty.`
      : '✓ LinkedIn read — nothing new to add.';
  } catch (err) {
    $('resume-status').textContent = 'LinkedIn import failed: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Import from my LinkedIn';
  }
}

// If the popup was closed while importing, the result is still waiting in storage — apply it now.
async function applyPendingImport() {
  const r = await new Promise(res => chrome.storage.local.get(['arkImport'], x => res(x.arkImport)));
  const last = (state.me.sources && state.me.sources.linkedin) || 0;
  if (r && r.status === 'done' && r.at > last && r.data) {
    const filled = await applyLinkedInData(r.data.main, r.data.details);
    $('resume-status').textContent = `✓ Finished importing from LinkedIn: ${filled.join(', ') || 'nothing new'}.`;
  }
}

async function applyLinkedInData(main, details) {
  {
    const m = main || {};
    const d = ArkEvidence.theirProfile({ ...m,
      experienceItems: [...(details?.experience || []), ...(m.experienceItems || [])],
      educationItems: [...(details?.education || []), ...(m.educationItems || [])],
      skillItems: [...(details?.skills || []), ...(m.skillItems || [])]
    });
    const loc = String(m.location || '').split(',').map(x => x.trim()).filter(Boolean);
    const country = loc.length > 1 ? loc[loc.length - 1] : '';
    const education = d.education.length ? d.education : (m.educationEntries || []).map(x => ({ school: String(x).split(' — ')[0], degree: String(x).split(' — ')[1] || '', years: '' }));
    const experience = d.experience.length ? d.experience : (m.experienceEntries || []).map(x => ({ title: x.title || '', company: x.company || '', years: x.duration || '' }));
    const filled = applyIncoming({
      name: m.name, city: loc[0] || '', homeCountry: country && !/australia/i.test(country) ? country : '',
      education, experience, skills: d.skills.length ? d.skills : (m.skills || []),
      story: m.about ? String(m.about).split(/(?<=[.!?])\s/)[0].slice(0, 200) : ''
    });
    state.me.sources = Object.assign({}, state.me.sources, { linkedin: Date.now() });
    state.me.linkedinHeadline = m.headline || '';
    await saveProfile({ quiet: true });
    renderSources();
    return filled;
  }
}

// Paste or finish typing a resume → it is read automatically.
let lastParsedResume = '';
function maybeAutoParse() {
  const text = $('f-resume').value.trim();
  if (text.length < 150 || text === lastParsedResume) return;
  translateResume({ auto: true });
}

// auto=true (paste / upload): fill only empty fields, so nothing you typed is overwritten.
// auto=false (button): replace fields with what the resume says.
async function translateResume(opts) {
  const auto = !!(opts && opts.auto);
  const text = $('f-resume').value.trim();
  const btn = $('translate-btn');
  if (!text && !state.pendingPdf) { $('resume-status').textContent = 'Paste your resume text or upload a PDF first.'; return; }
  const key = state.settings.apiKey || $('f-apikey').value.trim();
  const settings = Object.assign({}, state.settings, { apiKey: key });
  let engine = state.pendingPdf && key ? 'claude' : (key && state.engine === 'templates' ? 'claude' : state.engine);
  if (!text && engine !== 'claude') { $('resume-status').textContent = 'Reading a PDF needs a Claude key — or paste the text instead.'; return; }
  btn.disabled = true; btn.textContent = 'Reading…';
  $('resume-status').textContent = 'Reading your resume' + (engine === 'templates' ? ' (basic rules — add AI for a full read)…' : ' with ' + ENGINE_NAMES[engine] + '…');
  try {
    let r = null;
    if (engine !== 'templates') {
      try { r = await ArkAI.readResume(engine, settings, { text, pdfBase64: engine === 'claude' ? state.pendingPdf : null }); }
      catch (err) { if (!text) throw err; r = null; $('resume-status').textContent = 'AI read failed (' + err.message + ') — using basic rules.'; }
    }
    if (!r) { r = ArkEvidence.parseResumeRules(text); engine = 'templates'; }

    // AI gives the best reading; rules always run too so lists are never missed.
    const rules = ArkEvidence.parseResumeRules(text);
    for (const k of ['education', 'experience', 'skills']) if (!(r[k] || []).length) r[k] = rules[k];
    const filled = applyIncoming(r, { overwrite: !auto });
    state.me.sources = Object.assign({}, state.me.sources, { resume: { at: Date.now(), name: (opts && opts.sourceName) || 'pasted text' } });
    const miss = r.missingNumbers || [];
    $('missing-numbers').innerHTML = miss.length ? '<b>Add a real number if you have one:</b><br>' + miss.map(esc).join('<br>') : '';
    $('missing-numbers').classList.toggle('hidden', !miss.length);

    lastParsedResume = text;
    state.pendingPdf = null;
    await saveProfile({ quiet: true });
    renderSources();
    const by = engine === 'templates' ? 'basic rules (add AI for a fuller read)' : ENGINE_NAMES[engine];
    $('resume-status').textContent = filled.length
      ? `✓ Read with ${by} and saved. Filled: ${filled.join(', ')}. Check them below.`
      : `✓ Read with ${by}. Nothing new to fill — your fields were kept.`;
  } catch (err) {
    $('resume-status').textContent = 'Could not read the resume: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Read pasted text';
  }
}

async function testKey() {
  const key = $('f-apikey').value.trim();
  if (!key) return;
  $('key-status').textContent = 'Testing…';
  try {
    await ArkAI.testKey(key);
    $('key-status').textContent = '✓ Key works. Save to use Claude.';
  } catch (err) {
    $('key-status').textContent = '✗ ' + err.message;
  }
}

async function saveProfile(opts) {
  const quiet = !!(opts && opts.quiet);
  Object.assign(state.me, readForm());
  state.me.premium = $('f-premium').checked;
  state.settings.apiKey = $('f-apikey').value.trim();
  await ArkStore.saveProfile(state.me);
  await ArkStore.saveSettings(state.settings);
  await ArkStore.savePairs(state.pairs);
  state.ahpInfo = ArkScoring.ahp(state.pairs);
  await recomputeWeights();
  await refreshEngine();
  renderStrength(state.me);
  if (quiet) { $('setup-nudge').classList.toggle('hidden', !!(state.me.targetRole && state.me.projectName)); return; }
  const el = $('profile-status');
  el.textContent = state.ahpInfo.consistent ? 'Saved.' : 'Saved — but your AHP answers are inconsistent; scores will still use them.';
  el.className = 'status-bar status-' + (state.ahpInfo.consistent ? 'success' : 'warning');
  setTimeout(() => el.classList.add('hidden'), 2500);
  checkPage();
}

// ═══════════════════════════════════ HELPERS ══════════════════════════════════
function bg(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!res) return reject(new Error('No response from the extension.'));
      if (!res.success) return reject(new Error(res.error || 'Something went wrong.'));
      resolve(res.data);
    });
  });
}
