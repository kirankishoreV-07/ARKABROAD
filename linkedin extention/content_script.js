'use strict';

if (!globalThis.arkProfileListener) {
  globalThis.arkProfileListener = true;
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'scrapeDetails') {
      scrapeDetails().then(items => sendResponse({ success: true, data: items }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }
    if (msg.action === 'scrapeProfile') {
      scrapeWithScroll().then(profile => {
        sendResponse({ success: true, data: profile });
      }).catch(err => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }
  });
}

// LinkedIn only builds the lower sections (Experience, Education, Skills…) when you scroll near
// them. So we scroll down the WHOLE page step by step until it stops growing, wait for the
// sections to appear, read everything, then put you back exactly where you were.
async function scrollWholePage(onStep) {
  const go = (y) => window.scrollTo({ top: y, behavior: 'instant' });
  const stepPx = Math.max(500, Math.round(window.innerHeight * 0.85));
  let y = 0, stableRounds = 0, lastH = 0;
  for (let i = 0; i < 40; i++) {
    y += stepPx;
    go(y);
    await wait(320);
    if (onStep) onStep();
    const h = document.documentElement.scrollHeight;
    if (y + window.innerHeight >= h - 5) {
      stableRounds = h === lastH ? stableRounds + 1 : 0;
      lastH = h;
      if (stableRounds >= 2) break;
      await wait(300);
    }
  }
}

// LinkedIn renders Experience / Education / Skills into empty <section> shells only after the
// shell has stayed on screen for a moment. Park on each empty shell until it fills (≤1.6 s each).
async function loadLazySections() {
  const gaveUp = new Set();
  for (let round = 0; round < 3; round++) {
    const empty = Array.from(document.querySelectorAll('main section'))
      .filter(sec => !gaveUp.has(sec) && sec.isConnected && !(sec.innerText || '').trim());
    if (!empty.length) return;
    for (const sec of empty) {
      sec.scrollIntoView({ block: 'center', behavior: 'instant' });
      let t = 0;
      while (t < 8 && !(sec.innerText || '').trim()) { await wait(200); t++; }
      if (!(sec.innerText || '').trim()) gaveUp.add(sec);   // ad slots etc. never fill — don't wait on them again
    }
  }
}

async function scrapeWithScroll() {
  const startY = window.scrollY;
  const initialUrl = location.href;
  try {
    const beforeScroll = scrapeProfile();
    await scrollWholePage();
    await loadLazySections();
    let profile = scrapeProfile();
    const core = ['experience', 'education', 'skills'];
    // Activity never substitutes for one of the comparison sections.
    for (let i = 0; i < 6 && (!profile.name || core.some(section => !profile.readStats[section])); i++) {
      await wait(350);
      profile = mergeProfileSnapshots(scrapeProfile(), profile);
    }
    profile = mergeProfileSnapshots(profile, beforeScroll);
    if (location.href !== initialUrl) throw new Error('The profile changed while it was being read. Please analyse it again.');
    return profile;
  } finally {
    if (location.href === initialUrl) window.scrollTo({ top: startY, behavior: 'instant' });
  }
}

function mergeProfileSnapshots(current, earlier) {
  for (const field of ['experienceItems', 'educationItems', 'skillItems', 'recentPosts', 'projects', 'certifications']) {
    const items = current[field].concat(earlier[field]);
    current[field] = [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  }
  for (const field of ['name', 'headline', 'location', 'about', 'topSchool', 'topCompany', 'sharedSchoolSignal', 'sharedCompanySignal']) {
    current[field] ||= earlier[field];
  }
  current.readStats.identitySource ||= earlier.readStats.identitySource;
  current.degree ||= earlier.degree;
  current.mutuals ??= earlier.mutuals;
  current.isStudent ||= earlier.isStudent;
  current.isConnected ||= earlier.isConnected;
  current.isSelf ||= earlier.isSelf;
  current.detailLinks = { ...earlier.detailLinks, ...current.detailLinks };
  current.readStats.sectionsFound = [...new Set(current.readStats.sectionsFound.concat(earlier.readStats.sectionsFound))];
  for (const [section, field] of [['experience', 'experienceItems'], ['education', 'educationItems'], ['skills', 'skillItems']]) {
    current.readStats[section] = current[field].length;
  }
  return current;
}

// Use the same entry reader on summary and dedicated section pages.
async function scrapeDetails() {
  const match = location.pathname.match(/\/details\/(experience|education|skills)\/?$/);
  if (!match) throw new Error('The requested detail page was not available.');
  const kind = match[1];
  const found = new Map();
  const collect = () => {
    for (const item of scrapeProfile(kind)) found.set(item.join('\n'), item);
  };
  collect();
  await scrollWholePage(collect);
  await loadLazySections();
  for (let attempt = 0; attempt < 3; attempt++) {
    await wait(350);
    collect();
  }
  return [...found.values()];
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function profileIdentity(roots, clean) {
  const cardSelector = '[data-view-name*="profile-top-card"], .pv-top-card, #top';
  const nameSelector = 'h1, [role="heading"][aria-level="1"], .profile-name, [data-testid="profile-name"]';
  const isVisible = el => !!el?.getClientRects().length && !el.closest('aside, nav, footer, [aria-hidden="true"]');
  const validName = text => text.length > 1 && text.length <= 100 &&
    !/^(linkedin|profile|member profile|profile unavailable|page not found|sign in|log in|join linkedin|feed|my network|error)$/i.test(text);
  const headingName = el => clean(el?.innerText).replace(/\s*[·•]\s*(?:1st|2nd|3rd\+?)$/i, '');
  const card = Array.from(document.querySelectorAll(cardSelector)).find(isVisible);
  const root = card?.closest('main, [role="main"]') || roots.find(el => Array.from(el.querySelectorAll(nameSelector)).some(node => isVisible(node) && validName(headingName(node)))) || roots.find(el => clean(el.innerText));
  const sourceRoot = card || root;
  const heading = Array.from(sourceRoot?.querySelectorAll(nameSelector) || []).find(el => isVisible(el) && validName(headingName(el)));
  if (heading) return { root, name: headingName(heading), node: heading, card, source: 'profile header' };
  if (!/^\/in\/[^/]+\/?$/i.test(window.location.pathname)) return { root, card };

  const canonical = document.querySelector('meta[property="og:url"]')?.content;
  const pagePath = window.location.pathname.replace(/\/$/, '');
  const matchesPage = !canonical || (URL.canParse(canonical, window.location.href) &&
    new URL(canonical, window.location.href).pathname.replace(/\/$/, '') === pagePath);
  const titles = [matchesPage ? document.querySelector('meta[property="og:title"]')?.content : '', document.title];
  for (const title of titles) {
    const match = clean(title).match(/^(?:\(\d+\)\s*)?(.+?)\s*\|\s*LinkedIn$/i);
    if (!match || !validName(match[1])) continue;
    const name = match[1];
    const searchRoots = card ? [card] : roots.length ? roots : [document.body];
    for (const area of searchRoots) {
      const candidates = Array.from(area.querySelectorAll('h2, [role="heading"], p, span, div'));
      const node = candidates.find(el => isVisible(el) && !el.children.length && headingName(el) === name);
      if (node) return { root: node.closest('main, [role="main"]') || root, card, node, name, source: 'visible name confirmed by the page title' };
    }
    // Title-only fallback needs current profile content to be useful. The worker
    // checks that the active tab still matches before returning the analysis.
    if (matchesPage && (card || (canonical && root?.querySelector('section, [data-view-name]')))) {
      return { root, card, name, source: 'profile page title' };
    }
  }
  return { root, card };
}

function scrapeProfile(detailKind = null) {
  const clean = (str) => (str || '').replace(/\s+/g, ' ').trim();
  const roots = Array.from(document.querySelectorAll('main, [role="main"]')).filter(el => el.getClientRects().length);
  const identity = detailKind ? {} : profileIdentity(roots, clean);
  const main = identity.root || roots.find(el => clean(el.innerText)) || document.body;
  const offProfile = 'aside, nav, footer, [class*="msg-overlay"], [class*="pymk"], [class*="pv-browsemap"]';

  // Find a profile section by its heading — works whether LinkedIn uses <section><h2>,
  // an anchor <div id="experience">, or plain divs/spans for the heading.
  function getSection(heading) {
    const want = heading.toLowerCase();
    const headingText = el => clean(el.innerText).toLowerCase().replace(/\s*\(\d+\)$/, '');
    const anchor = document.getElementById(want);
    if (anchor && main.contains(anchor) && !anchor.closest(offProfile)) {
      const sec = anchor.closest('section') || anchor.parentElement;
      if (sec && sec !== main && clean(sec.innerText).length > heading.length + 5 && Array.from(sec.querySelectorAll('h2, [role="heading"]')).some(h => headingText(h) === want)) return sec;
    }
    const legacy = Array.from(main.querySelectorAll('section')).filter(sec => !sec.closest(offProfile)).find(sec => {
      const h = sec.querySelector('h2, h3, [role="heading"]');
      return h && headingText(h) === want;
    });
    if (legacy) return legacy;
    const headings = Array.from(main.querySelectorAll('h2, h3, [role="heading"], span, p, div'))
      .filter(el => el.children.length <= 1 && headingText(el) === want && !el.closest(offProfile + ', header'));
    for (const h of headings) {
      if (h.closest('section')) return h.closest('section');
      let box = h.parentElement;
      for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
        if (box === main) break;
        if (box !== h && Array.from(box.children).some(child => !child.contains(h) && clean(child.innerText) && !child.matches('button, a'))) return box;
      }
    }
    return null;
  }

  // Visible text lines inside an element, in reading order (skips screen-reader duplicates).
  function leafLines(el) {
    if (!el) return [];
    const out = [];
    el.querySelectorAll('*').forEach(n => {
      if (n.closest('.visually-hidden, .sr-only, [aria-hidden="false"].visually-hidden, button, svg') || n.closest(offProfile)) return;
      const hasTextChild = Array.from(n.children).some(c => clean(c.innerText));
      if (hasTextChild) return;
      const t = clean(n.innerText);
      if (t && t.length < 1200 && out[out.length - 1] !== t) out.push(t);
    });
    return out;
  }

  // Get all leaf text nodes from a section using P tags and spans
  function getTexts(section) {
    if (!section) return [];
    return Array.from(section.querySelectorAll('p, span'))
      .filter(el => el.children.length === 0)
      .map(el => clean(el.innerText))
      .filter(t => t.length > 2 && !/^[·•\s]+$/.test(t));
  }

  // ── NAME ──────────────────────────────────────────────────────────────────
  const titleNode = identity.node;
  const name = identity.name || '';

  // ── HEADLINE ──────────────────────────────────────────────────────────────
  let headline = null;
  const topCard = identity.card || titleNode?.closest('section') || titleNode?.parentElement?.parentElement;
  const allSections = topCard && topCard !== main ? [topCard] : [];
  for (const sec of allSections) {
    if (!titleNode || sec.contains(titleNode)) {
      const pTags = leafLines(sec).filter(t => t.length > 5 && t !== name && !/^(connect|message|contact info|open to work|save in sales navigator|\d[\d,+]* connections)/i.test(t));
      // Headline often contains | or @ or job title keywords
      const headlineEl = pTags.find(t => t.includes('|') || t.includes('@')) || pTags.find(t =>
        /manager|engineer|analyst|developer|designer|founder|director|lead|specialist|consultant|intern|fellow|trainee/i.test(t)
      ) || pTags[0];
      if (headlineEl) { headline = headlineEl; break; }
    }
  }

  // ── LOCATION ──────────────────────────────────────────────────────────────
  let location = null;
  for (const sec of allSections) {
    if (!titleNode || sec.contains(titleNode)) {
      const pTags = Array.from(sec.querySelectorAll('p'))
        .filter(p => p.children.length === 0)
        .map(p => clean(p.innerText))
        .filter(t => t.length > 3);
      // Location is usually the 2nd or 3rd p tag — looks like "City, Country"
      const locEl = pTags.find(t =>
        t.includes(',') && t.length < 60 && !t.includes('|') && !t.includes('@')
      );
      if (locEl) { location = locEl; break; }
    }
  }

  // ── ABOUT ─────────────────────────────────────────────────────────────────
  let about = null;
  const aboutSection = getSection('About');
  if (aboutSection) {
    const texts = getTexts(aboutSection);
    const longText = texts.filter(t => t.length > 3 && !/^(about|show more|see more)$/i.test(t)).sort((a, b) => b.length - a.length)[0];
    if (longText) about = longText;
  }

  // ── SECTIONS, ENTRY BY ENTRY ──────────────────────────────────────────────
  // Two ways to split a section into entries (one job / school / post each):
  //  1. list items (<li>) when LinkedIn uses lists;
  //  2. otherwise, anchor on the DATE line ("Apr 2026 - May 2026 · 2 mos"): the lines just
  //     above a date are that entry's title and company (or school and degree).
  const MON = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
  const DATE_LINE = new RegExp('^(?:' + MON + '\\s+)?(?:19|20)\\d{2}(?:\\s*[-–—]\\s*(?:(?:' + MON + '\\s+)?(?:19|20)\\d{2}|present))?(?:\\s*·.*)?$', 'i');
  const NOISE = /^(show all|see more|show more|endorse|…see more|\d+ endorsements?|passed linkedin skill assessment|experience|education|skills|activity|licenses|projects)\b/i;

  function sectionEntries(section) {
    if (!section) return [];
    const items = Array.from(section.querySelectorAll('li, [role="listitem"]'))
      .filter(li => !li.closest(offProfile) && !li.matches('nav li'));
    const itemSet = new Set(items);
    return items.map(item => {
      const ownLines = leafLines(item);
      const nested = Array.from(item.querySelectorAll('li, [role="listitem"]')).filter(el => itemSet.has(el));
      if (nested.length && !ownLines.some(t => DATE_LINE.test(t))) return [];
      // Grouped jobs stay together so the parser can retain every title under the employer.
      if (section === expSection || detailKind === 'experience') {
        if (item.parentElement?.closest('li, [role="listitem"]') && itemSet.has(item.parentElement.closest('li, [role="listitem"]'))) return [];
      } else if (nested.length) return [];
      return ownLines;
    }).filter(l => l.length && !NOISE.test(l[0]));
  }

  function dateAnchored(section, kind) {
    const lines = leafLines(section).filter(t => !NOISE.test(t));
    const out = [];
    let last = -1;
    const isDegree = (t) => /\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?e\b|b\.?sc|m\.?sc|bca|mca|mba|phd|diploma|degree|higher secondary|secondary|class\s*\d+|grade|hsc|ssc|cbse|science|engineering|commerce|arts)\b/i.test(t) || /,/.test(t);
    const isDuration = (t) => /^\s*(full-time|part-time|internship|contract|freelance|self-employed)?\s*·?\s*\d+\s*(yrs?|mos?)\b/i.test(t);
    for (let i = 0; i < lines.length; i++) {
      if (!DATE_LINE.test(lines[i])) continue;
      if (kind === 'experience') {
        const a = lines[i - 2], b = lines[i - 1];
        if (!b || i - 1 <= last) continue;
        if (a && i - 2 > last && isDuration(a) && lines[i - 3]) out.push([b, lines[i - 3], lines[i]]);   // grouped: Company, "2 yrs", Title, dates
        else if (a && i - 2 > last) out.push([a, b, lines[i]]);                                           // Title, "Company · Type", dates
        else out.push([b, '', lines[i]]);
      } else {
        const a = lines[i - 2], b = lines[i - 1];
        if (!b || i - 1 <= last) continue;
        if (a && i - 2 > last && isDegree(b) && (!isDegree(a) || /\b(university|college|institute|school)\b/i.test(a))) out.push([a, b, lines[i]]);
        else out.push([b, '', lines[i]]);
      }
      last = i;
    }
    return out;
  }

  // Experience, line by line. Handles all three LinkedIn shapes:
  //   Title / "Company · Contract" / dates / location
  //   Company / "8 yrs 1 mo"  ← group header, then per role: Title / "Full-time" / dates / location
  //   Title / dates            (role inside a group with no type line)
  const EMP_TYPE = /^(full-time|part-time|contract|internship|freelance|self-employed|apprenticeship|seasonal|temporary|permanent|casual)$/i;
  const DURATION = /^(?:(?:full-time|part-time|contract|internship|freelance|self-employed)\s*·\s*)?\d+\s*(?:yrs?|mos?)(?:\s+\d+\s*mos?)?$/i;
  const JOB_SKILLS = /^(.+?)\s+and\s+\+\d+\s+skills?$/i;
  const PLACE = { test: t => /\b(remote|on-?site|hybrid)\b/i.test(t) || /^[A-Z][\w .'-]+,\s*[A-Z]/.test(t) };
  function experienceFromLines(rawLines) {
    const L = rawLines.filter(t => !NOISE.test(t) && !/^present$/i.test(t) && !JOB_SKILLS.test(t) && !/^show all \d+/i.test(t));
    const out = [];
    let group = '', lastEnd = -1;
    for (let i = 0; i < L.length; i++) {
      if (DURATION.test(L[i]) && i > 0 && !DATE_LINE.test(L[i - 1])) { group = L[i - 1]; lastEnd = i; continue; }
      if (!DATE_LINE.test(L[i])) continue;
      const prev = L[i - 1] || '';
      let title, company;
      if (EMP_TYPE.test(prev)) { title = L[i - 2]; company = group ? `${group} · ${prev}` : prev; }
      else if (prev.includes(' · ') && i - 2 > lastEnd) { title = L[i - 2]; company = prev; if (!EMP_TYPE.test(prev.split(' · ')[1] || '')) group = ''; }
      else { title = prev; company = group; }
      if (!title || i - 1 <= lastEnd && !group) continue;
      const item = [title, company || '', L[i]];
      if (L[i + 1] && PLACE.test(L[i + 1]) && !DATE_LINE.test(L[i + 1])) item.push(L[i + 1]);
      out.push(item);
      lastEnd = i;
    }
    return out;
  }
  // Education, line by line: School / Degree, field / years (degree and years may be missing).
  const SCHOOLISH = /\b(universit(?:y|é|at)|vidyapeetham|vidyapeeth|vidyalaya|college|institute|school|academy|polytechnic|iit|nit|iiit|tafe|campus)\b/i;
  const DEGREEISH = /\b(bachelor|master|b\.?\s?tech|m\.?\s?tech|b\.?e\b|b\.?sc|m\.?sc|bca|mca|mba|ph\.?d|doctor|diploma|certificate|degree|higher secondary|secondary|hsc|ssc|cbse|grade|class\s*\d+)\b/i;
  function educationFromLines(rawLines) {
    const L = rawLines.filter(t => !NOISE.test(t) && !/^show all \d+/i.test(t));
    const out = [];
    for (let i = 0; i < L.length; i++) {
      if (!SCHOOLISH.test(L[i]) || DEGREEISH.test(L[i]) || DATE_LINE.test(L[i]) || L[i].length > 120) continue;
      const item = [L[i], '', ''];
      let j = i + 1;
      if (L[j] && !DATE_LINE.test(L[j]) && (DEGREEISH.test(L[j]) || !SCHOOLISH.test(L[j])) && L[j].length <= 160 && !/^(gpa|grade|activities)\b/i.test(L[j])) { item[1] = L[j]; j++; }
      if (L[j] && DATE_LINE.test(L[j])) item[2] = L[j];
      const prev = out[out.length - 1];
      if (prev && prev[0] === item[0] && !item[1] && !item[2]) continue;               // logo link + name link of the same school
      if (prev && prev[0] === item[0] && prev.length === 1) out.pop();                 // …in either order
      out.push(item.filter((v, k) => k === 0 || v));
    }
    return out;
  }

  function skillsFromJobs(section) {
    const found = [];
    for (const t of leafLines(section)) {
      const m = t.match(JOB_SKILLS);
      if (m) m[1].split(/,\s*|\s+and\s+/).map(clean).filter(x => x && x.length <= 60).forEach(x => found.push(x));
    }
    return [...new Set(found)].map(x => [x]);
  }

  const expSection = detailKind === 'experience' ? main : getSection('Experience');
  const eduSection = detailKind === 'education' ? main : getSection('Education');
  const skillsSection = detailKind === 'skills' ? main : getSection('Skills');
  const activitySection = getSection('Activity');

  function cardsFor(section, selector) {
    if (!section) return [];
    return Array.from(section.querySelectorAll(selector)).filter(el => !el.closest(offProfile)).map(label => {
      let card = label;
      while (card.parentElement && card.parentElement !== section && card.parentElement.querySelectorAll(selector).length === 1) {
        card = card.parentElement;
      }
      return leafLines(card).filter(t => !NOISE.test(t));
    }).filter(lines => lines.length);
  }

  function entries(section, kind) {
    if (kind === 'experience' && section) {
      const lined = experienceFromLines(leafLines(section));
      const listed = sectionEntries(section);
      // Prefer the line reader unless the list reader clearly found more (it keeps companies on grouped roles).
      if (lined.length && lined.length >= listed.length) return lined;
      if (listed.length) return listed;
    }
    const listed = sectionEntries(section);
    if (listed.length) return listed;
    if (kind === 'skills') return leafLines(section).filter(t => t.length <= 120 && !NOISE.test(t) && !/endorse|follower|connection/i.test(t)).map(t => [t]);
    if (kind === 'education') {
      const lined = educationFromLines(leafLines(section));
      const linkedSchools = cardsFor(section, 'a[href*="/school/"]');
      const filled = rows => rows.reduce((n, r) => n + r.filter(Boolean).length, 0);
      const best = [lined, linkedSchools, dateAnchored(section, kind)].sort((a, b) => filled(b) - filled(a))[0];
      if (best.length) return best;
    }
    const headedCards = cardsFor(section, 'h3, [role="heading"][aria-level="3"]');
    if (headedCards.length) return headedCards;
    return dateAnchored(section, kind);
  }

  function sectionTitles(heading) {
    const section = getSection(heading);
    const items = sectionEntries(section);
    const cards = items.length ? items : cardsFor(section, 'h3, [role="heading"][aria-level="3"]');
    return [...new Set(cards.map(lines => lines[0]))];
  }

  if (detailKind) return entries(main, detailKind);
  const experienceItems = entries(expSection, 'experience');
  const educationItems = entries(eduSection, 'education');
  let skillItems = entries(skillsSection, 'skills');
  // No Skills section (common): use the skills LinkedIn lists under each job.
  const skillsFromExperience = !skillItems.length && expSection ? skillsFromJobs(expSection) : [];
  if (skillsFromExperience.length) skillItems = skillsFromExperience;
  let activityItems = sectionEntries(activitySection).slice(0, 6);
  if (!activityItems.length && activitySection) {
    // No list items: each post starts at its age stamp ("2w •"); the header lines just above say
    // whether it is their post or a repost, the longest line after the stamp is the post text.
    const lines = leafLines(activitySection).filter(t => !/^(activity|show all|see more|…see more)/i.test(t));
    const stamps = lines.map((t, i) => (/^\d+\s*(m|h|d|w|mo|yr)\b/i.test(t) && t.length < 40 ? i : -1)).filter(i => i >= 0);
    stamps.forEach((si, k) => {
      const end = k + 1 < stamps.length ? stamps[k + 1] - 2 : lines.length;
      activityItems.push(lines.slice(Math.max(0, si - 2), Math.max(si + 1, end)));
    });
    activityItems = activityItems.slice(0, 6);
  }


  // Older flat fields, now derived from the entries
  const experienceEntries = experienceItems.map((l) => ({ title: l[0], company: String(l[1] || '').split('·')[0].trim() || null, duration: l.find(x => DATE_LINE.test(x)) || null, isCurrent: l.some(x => DATE_LINE.test(x) && /\bpresent\b/i.test(x)) }));
  const currentEntry   = experienceEntries.find(e => e.isCurrent) || null;
  const currentTitle   = currentEntry?.title || (extractFromHeadline(headline, 'company') ? extractFromHeadline(headline, 'title') : null);
  const currentCompany = currentEntry?.company || (/\b(student|undergrad|undergraduate|pursuing)\b/i.test(headline || '') ? null : extractFromHeadline(headline, 'company'));
  const pastCompanies  = [...new Set(experienceEntries.slice(1).map(e => e.company).filter(Boolean))];
  const skills = skillItems.map(l => l[0]);
  const educationEntries = educationItems.map(l => [l[0], l[1]].filter(Boolean).join(' — '));

  // What was found — shown in the popup so a miss is visible, not silent
  const readStats = {
    identitySource: identity.source || null,
    experience: experienceItems.length, education: educationItems.length, skills: skillItems.length,
    skillsSource: skillsFromExperience.length ? 'experience' : (skillItems.length ? 'skills' : null),
    sectionsFound: ['Experience', 'Education', 'Skills', 'Activity'].filter((n, i) => [expSection, eduSection, skillsSection, activitySection][i])
  };

  // ── RECENT POSTS — their OWN posts only (reposts/comments/likes are other people's words) ──
  const recentPosts = [];
  for (const lines of activityItems) {
    const head = lines.slice(0, 4).join(' ');
    const ownPost = !!name && lines.slice(0, 5).some(line => line === name || line.startsWith(name + ' ·') || line.startsWith(name + ' •'));
    const kind = /\breposted\b/i.test(head) ? 'repost'
      : /\bcommented\b|\breplied\b/i.test(head) ? 'comment'
      : /\b(liked|loves|celebrates|supports|finds this|reacted)\b/i.test(head) ? 'reaction' : ownPost ? 'post' : 'unconfirmed';
    const stampLine = lines.find(l => /(^|•\s*)\d+\s*(m|h|d|w|mo|yr)\b/i.test(l) && l.length < 60) || '';
    const stamp = (stampLine.match(/(\d+\s*(?:mo|yr|m|h|d|w))\b/i) || [])[1] || '';
    const text = lines.filter(l => l.length >= 16 && l !== headline && l !== name && !/followers|^\d+\s*(m|h|d|w|mo|yr)\b/i.test(l)).sort((x, y) => y.length - x.length)[0] || '';
    if (text) recentPosts.push({ text: text.slice(0, 500), stamp, kind });
  }

  // ── CONNECTION DEGREE, MUTUALS, CONNECTED? ────────────────────────────────
  const topSection = topCard && topCard !== main ? topCard : null;
  const topText = clean(topSection?.innerText || '');
  const degreeMatch = topText.match(/(?:·|•)\s*(1st|2nd|3rd\+?)\b/) || topText.match(/\b(1st|2nd|3rd\+?)\b/);
  const degree = degreeMatch ? degreeMatch[1].replace('+', '') : null;
  let mutuals = null;
  const NAME = "[A-Z][\\w'’-]+(?:\\s[A-Z][\\w'’-]+)*";
  const withOthers = topText.match(new RegExp('(' + NAME + '(?:,\\s*' + NAME + ')*)\\s+and\\s+(\\d+)\\s+other\\s+mutual connections?'));
  const plain = topText.match(/(\d+)\s+mutual connections?/i);
  const fewNamed = topText.match(new RegExp(NAME + '(\\s+and\\s+' + NAME + ')?\\s+(?:is|are)\\s+(?:a\\s+)?mutual connections?'));
  if (withOthers) mutuals = withOthers[1].split(',').length + parseInt(withOthers[2], 10);
  else if (plain) mutuals = parseInt(plain[1], 10);
  else if (fewNamed) mutuals = fewNamed[1] ? 2 : 1;
  const buttons = Array.from(topSection?.querySelectorAll('button, a') || []).map(b => clean(b.innerText || b.getAttribute('aria-label') || ''));
  const isConnected = degree === '1st';

  // ── SCHOOL / COMPANY SHOWN IN THE TOP CARD (loads even when lower sections don't) ──
  const SCHOOL_RE = /\b(university|universit[ée]|vidyapeetham|vidyapeeth|college|institute|iit|nit|iiit|polytechnic|school of)\b/i;
  const ariaLabels = Array.from(topSection?.querySelectorAll('[aria-label]') || []).map(el => clean(el.getAttribute('aria-label')));
  let topSchool = '';
  const eduAria = ariaLabels.find(a => /^education[:\s]/i.test(a));
  if (eduAria) topSchool = eduAria.replace(/^education[:\s]+/i, '').replace(/\.\s*click.*$/i, '').trim();
  if (!topSchool && topSection) {
    const schoolLink = Array.from(topSection.querySelectorAll('a[href*="/school/"]')).map(a => clean(a.innerText) || clean(a.getAttribute('aria-label'))).find(Boolean);
    const schoolControl = Array.from(topSection.querySelectorAll('button, [role="button"]')).map(el => clean(el.innerText)).find(t => t.length <= 110 && SCHOOL_RE.test(t));
    topSchool = schoolLink || schoolControl || '';
  }
  if (topSchool && !educationEntries.some(e => e.toLowerCase().includes(topSchool.toLowerCase().slice(0, 12)))) {
    educationEntries.unshift(topSchool);
  }
  const companyAria = ariaLabels.find(a => /^current company[:\s]/i.test(a));
  const topCompany = companyAria ? companyAria.replace(/^current company[:\s]+/i, '').replace(/\.\s*click.*$/i, '').trim() : '';

  // Sales Insights can be an aside, or a separate card beside the main profile.
  // Trust the exact signal only in the current profile's own insights/highlights.
  const unrelated = 'nav, footer, [class*="msg-overlay"], [class*="pymk"], [class*="pv-browsemap"], [aria-label*="people you may know" i], [aria-label*="people also viewed" i]';
  const signals = Array.from(document.querySelectorAll('h2, h3, h4, [role="heading"], span, p, div, strong'))
    .filter(el => !el.closest(unrelated) && el.getClientRects().length)
    .filter(el => /^(shared education|you both (?:studied|went to school|attended) at .+)$/i.test(clean(el.innerText)));
  let sharedSchoolSignal = '';
  for (const el of signals) {
    const line = clean(el.innerText);
    // Some layouts put each insight in its own card nested under an unlabelled div.
    // Find the nearest ancestor with the paired Sales Insights / Key signals headings.
    let ownInsights = false;
    for (let box = el.parentElement; box && box !== document.body && box !== main; box = box.parentElement) {
      const text = box.innerText || '';
      if (/\b(people you may know|people also viewed|similar profiles|suggested for you)\b/i.test(text)) break;
      if (/\b(sales insights|key signals|highlights)\b/i.test(text)) { ownInsights = true; break; }
    }
    const named = line.match(/^You both (?:studied|went to school|attended) at (.+)$/i)?.[1]?.replace(/\.$/, '');
    if (ownInsights || (named && main.contains(el) && !el.closest(offProfile))) {
      sharedSchoolSignal = named || 'the same school';
      if (named) break;
    }
  }

  const sharedCompanySignal = leafLines(main)
    .map(line => line.match(/^(?:You both worked at|Past colleague (?:from|at)) (.+)$/i)?.[1])
    .find(Boolean) || '';

  // ── WHO IS THIS? student / own profile ──
  const isStudent = /\b(undergrad|undergraduate|student|pursuing|final[- ]year|freshman|sophomore|b\.?\s?tech|m\.?\s?tech|bachelor'?s|master'?s student|class of \d{4})\b/i.test(headline || '');
  const isSelf = /linkedin\.com\/in\/me\b/.test(window.location.href) ||
    buttons.some(t => /^(add profile section|add section|enhance profile|open to|resources)$/i.test(t));

  const detailLinks = {};
  const profilePath = window.location.pathname.match(/^\/in\/[^/]+/i)?.[0];
  if (profilePath) {
    for (const a of main.querySelectorAll('a[href], [role="link"][data-href], button[data-href]')) {
      if (a.closest(offProfile)) continue;
      const href = a.getAttribute('href') || a.getAttribute('data-href');
      if (!URL.canParse(href, window.location.href)) continue;
      const url = new URL(href, window.location.href);
      const match = url.pathname.match(/^(\/in\/[^/]+)\/details\/(experience|education|skills)\/?$/i);
      if (url.origin === window.location.origin && match && match[1].toLowerCase() === profilePath.toLowerCase()) {
        detailLinks[match[2].toLowerCase()] = url.origin + url.pathname;
      }
    }
  }

  return {
    name,
    headline,
    currentTitle,
    currentCompany,
    location,
    about,
    recentPosts:       recentPosts.slice(0, 3),
    experienceEntries: experienceEntries,
    pastCompanies:     pastCompanies,
    educationEntries:  educationEntries,
    skills:            skills,
    profileUrl:        window.location.href.split('?')[0],
    rawTitle:          document.title,
    degree,
    mutuals,
    isConnected,
    topSchool,
    topCompany,
    sharedSchoolSignal,
    sharedCompanySignal,
    experienceItems,
    educationItems,
    projects: sectionTitles('Projects'),
    certifications: sectionTitles('Licenses & certifications'),
    skillItems,
    readStats,
    detailLinks,
    isStudent,
    isSelf
  };
}

// "Melbourne, Victoria, Australia" / "Remote" / "Hybrid" — any country, not a fixed city list.
function looksLikeLocation(text) {
  if (!text) return false;
  return /\b(remote|on-?site|hybrid)\b/i.test(text) ||
    (/^[A-Z][\w .'-]+,\s*[A-Z][\w .'-]+/.test(text) && text.length < 70 && !/\d{4}/.test(text));
}

function extractFromHeadline(headline, field) {
  if (!headline) return null;
  const atMatch = headline.match(/^(.+?)\s*(?:\s+at\s+|@)\s*(.+)$/i);
  if (atMatch) return field === 'title' ? atMatch[1].trim() : atMatch[2].trim();
  const pipeMatch = headline.match(/^(.+?)\s*[|·]\s*(.+)$/);
  if (pipeMatch && field === 'title') return pipeMatch[1].trim();
  return null;
}