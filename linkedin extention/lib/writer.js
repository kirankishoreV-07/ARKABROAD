'use strict';

// writer.js — template writing (works with no AI at all), the student's voice,
// hook switching that keeps edits, coffee-chat prep, reply drafts and the coach report.

(function (root) {
  const V = root.ArkVerifier || (typeof require !== 'undefined' ? require('./verifier.js') : null);
  const S = root.ArkStore || (typeof require !== 'undefined' ? require('./storage.js') : null);

  function first(name) { return String(name || '').trim().split(/\s+/)[0] || 'there'; }
  function pick(arr, i) { return arr[((i % arr.length) + arr.length) % arr.length]; }

  // ── Voice: learn simple style signals from messages the student wrote ──────
  function analyseVoice(samples) {
    const text = String(samples || '').trim();
    if (!text) return null;
    const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
    const words = text.split(/\s+/).filter(Boolean);
    const avg = sentences.length ? words.length / sentences.length : 12;
    const greeting = /\bhey\b/i.test(text) ? 'Hey' : /\bhello\b/i.test(text) ? 'Hello' : 'Hi';
    const exclaim = (text.match(/!/g) || []).length / Math.max(1, sentences.length) > 0.25;
    const contractions = /\b(i'm|i've|you're|it's|don't|can't|i'd|that's)\b/i.test(text);
    const signoffMatch = text.match(/\n\s*(cheers|thanks|best|regards|thank you|ta)[,!.]?\s*$/im);
    const emoji = /[\u{1F300}-\u{1FAFF}]/u.test(text);
    return {
      greeting, exclaim, contractions, emoji,
      signoff: signoffMatch ? cap(signoffMatch[1]) : null,
      length: avg < 10 ? 'short' : avg > 18 ? 'long' : 'medium'
    };
  }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }

  function applyVoice(text, voice) {
    if (!voice) return text;
    let t = text;
    if (!voice.contractions) {
      t = t.replace(/\bI'm\b/g, 'I am').replace(/\bI'd\b/g, 'I would').replace(/\byou're\b/g, 'you are')
        .replace(/\bI've\b/g, 'I have').replace(/\bit's\b/g, 'it is');
    }
    if (!voice.exclaim) t = t.replace(/!(\s|$)/g, '.$1');
    t = t.replace(/^(Hi|Hey|Hello)\b/, voice.greeting);
    return t;
  }

  // ── Invite note (≤200 characters) ───────────────────────────────────────────
  function inviteDraft({ them, me, hook, variant = 0, voice, premium }) {
    const name = first(them.name);
    const target = me.targetRole || '';
    const closers = [
      'Would love to connect!',
      'Keen to connect and learn from your path.',
      'Would be great to connect.'
    ];
    const meLines = [
      target ? (me.projectName ? `I'm building towards ${target} roles (made ${withArticle(me.projectName)}).` : `I'm working towards ${target} roles.`)
        : (me.projectName ? `I recently built ${withArticle(me.projectName)}.` : `I'm starting my career here.`),
      target ? `I'm working towards ${target} roles here.` : `I'm early in my career and keen to learn.`,
      ''
    ];
    const opening = hook ? hook.line : `Your path${them.currentCompany ? ' to ' + them.currentCompany : ''} stood out to me`;
    // Don't say the goal twice when the opening already names it ("I'm working towards a Data Analyst role…")
    const saidGoal = target && opening.toLowerCase().includes(target.toLowerCase());
    const meLine = saidGoal ? (me.projectName ? `I recently built ${withArticle(me.projectName)}.` : '') : pick(meLines, variant);
    let text = `Hi ${name}, ${lowerFirst(opening)}. ${meLine} ${pick(closers, variant)}`.replace(/\s+/g, ' ').trim();
    text = applyVoice(text, voice);
    const limit = premium ? 300 : 200;
    if (text.length > limit) text = `Hi ${name}, ${lowerFirst(opening)}. ${pick(closers, variant)}`;
    return V ? V.fitToLimit(text, limit) : text;
  }

  // ── "After they accept" — proof-of-work question ────────────────────────────
  // Already-close people (classmates, existing connections) get a warm, direct message —
  // usually asking for an intro into their network rather than "thanks for connecting".
  function warmDraft({ them, me, hook, facts, variant = 0, voice }) {
    const name = first(them.name);
    const target = (me.targetRole || '').trim();
    // "AI Intern" → "AI internships"; "Data Analyst" → "Data Analyst roles"
    const core = target.replace(/\b(intern|internship)s?\b/i, '').trim();
    const goalPhrase = !target ? '' : /intern/i.test(target) ? `${core || target} internships` : `${target} roles`;
    const project = me.projectName ? ` (just built ${withArticle(me.projectName)}${me.projectLink ? ': ' + me.projectLink : ''})` : '';
    const where = facts && facts.sharedCompany ? `from your time at ${facts.sharedCompany} or ` : '';
    const opener = hook && hook.type === 'classmate' ? `${hook.line}!` : `Hope you're doing well!`;
    // "Data Analyst" is a job title → "works as a Data Analyst"; "AI" is a field → "works in AI"
    const isTitle = (t) => /\b(analyst|engineer|scientist|developer|designer|manager|consultant|accountant|architect|specialist|officer|associate)s?$/i.test(t);
    const whoDoes = (t) => isTitle(t) ? `works as ${withArticle(t)}` : `works in ${t}`;
    const who = target ? whoDoes(core || target) : 'works in the industry';
    const work = target ? `${core || target} work` : 'industry work';
    const goal = target ? `I'm going after ${goalPhrase}${project}.` : `I'm starting to look for my first corporate role${project}.`;
    // A more senior connection: ask THEM for advice first (an intro is the fallback), not for an intro to an intern.
    if (facts && facts.relationship !== 'classmate' && facts.seniority != null && facts.seniority >= 2) {
      const tp = them.experienceItems || them.educationItems ? (root.ArkEvidence ? root.ArkEvidence.theirProfile(them) : null) : null;
      const now = tp && tp.experience[0], before = tp && tp.experience[1];
      const path = now && before ? `Seeing how you went from ${before.title} at ${before.company} to ${now.title} at ${now.company}` : now ? `Seeing your work as ${now.title} at ${now.company}` : 'Seeing your career path';
      const advice = [
        `${path}, would you be open to a quick 10-minute chat on what helped most? Or if someone in your network ${core ? whoDoes(core) : 'works in this space'}, a pointer would mean a lot.`,
        `${path}, I'd love your take on one thing: what would you focus on if you were starting out in ${core || 'this field'} today?`,
        `${path}, could I ask you 2–3 quick questions about breaking into ${core || 'the field'}? Totally fine if you're busy.`
      ];
      return applyVoice(`Hey ${name}, hope you're doing well! Quick one: ${goal}\n\n${pick(advice, variant)}`, voice);
    }
    const asks = [
      `Do you know anyone ${where}in your network who ${who} and might be open to a 10-minute chat? Happy to send a short note you can forward.`,
      `Is there anyone ${where}in your circle doing ${work} I could learn from? Even one name would really help.`,
      `If someone ${where}in your network does ${work}, would you be comfortable introducing me? Totally fine if not.`
    ];
    const text = `Hey ${name}, ${lowerFirst(opener)} Quick one: ${goal}\n\n${pick(asks, variant)}`;
    return applyVoice(text, voice);
  }

  function afterAcceptDraft({ them, me, hook, variant = 0, voice, facts }) {
    const rel = facts && facts.relationship;
    const connectedBefore = facts && String(facts.degree || '').startsWith('1');
    if (connectedBefore && (rel === 'classmate' || rel === 'connection' || rel === 'ex_colleague')) {
      return warmDraft({ them, me, hook, facts, variant, voice });
    }
    const name = first(them.name);
    const target = me.targetRole || 'analyst';
    const project = me.projectName ? withArticle(me.projectName) : 'a project for my portfolio';
    const result = me.projectResult ? ` (${me.projectResult.replace(/\.$/, '')})` : '';
    const link = me.projectLink ? `\n${me.projectLink}` : '';
    const questions = [
      `If you were reviewing this for a junior ${target} role, what's one thing you'd look for?`,
      `What's one thing you'd change to make it stand out to a ${target} hiring manager${them.currentCompany ? ' at ' + them.currentCompany : ''}?`,
      `Is this the kind of work your team actually does day to day, or would you build it differently?`
    ];
    const thanks = hook && hook.type === 'school' ? `Thanks for connecting, ${name} — always good to meet a fellow ${hook.keyword} grad!`
      : `Thanks for connecting, ${name}!`;
    const text = `${thanks}\n\nI recently built ${project}${result}.${link}\n\n${pick(questions, variant)}\n\nNo pressure if you're busy — even a one-line answer would help a lot.`;
    return applyVoice(text, voice);
  }

  function followUpDraft({ them, n }) {
    const name = first(them.name);
    return n === 1
      ? `Hi ${name}, just floating this back up in case it got buried. Even a one-line answer would mean a lot. Thanks!`
      : `Hi ${name}, last nudge from me, I promise! If now's not a good time, no worries at all. Thanks either way.`;
  }

  // ── Switching the hook changes only the opening line ───────────────────────
  // Returns { text, replaced } — replaced=false means the user edited the opening,
  // so their text is kept untouched.
  function swapOpening(draft, oldHook, newHook) {
    const text = String(draft || '');
    if (!oldHook || !newHook) return { text, replaced: false };
    const oldLine = lowerFirst(oldHook.line);
    const newLine = lowerFirst(newHook.line);
    for (const candidate of [oldHook.line, oldLine]) {
      const i = text.indexOf(candidate);
      if (i >= 0) {
        const replacement = candidate === oldHook.line ? newHook.line : newLine;
        return { text: text.slice(0, i) + replacement + text.slice(i + candidate.length), replaced: true };
      }
    }
    return { text, replaced: false };
  }

  // Lower-case the first letter so a hook reads naturally mid-sentence — but never the pronoun "I".
  function lowerFirst(s) {
    s = String(s || '');
    if (/^I(\s|'|’)/.test(s)) return s;
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  // "a Melbourne housing dashboard" / "Melbourne housing dashboard" → always one article.
  function withArticle(s) {
    s = String(s || '').trim();
    if (/^(a|an|the|my)\s/i.test(s)) return s;
    return (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s;
  }

  // ── Reply assistant (template fallback) ─────────────────────────────────────
  const REPLY_TYPES = ['interested', 'busy', 'not_interested', 'referral_offer', 'question'];

  function classifyReplyRules(reply) {
    const t = String(reply || '').toLowerCase();
    if (/\brefer|referral|pass (your|it) on|forward your|send (me )?your (cv|resume)/.test(t)) return 'referral_offer';
    if (/\b(not interested|no thanks|can't help|cannot help|not able to help|please don't)\b/.test(t)) return 'not_interested';
    if (/\b(busy|swamped|later|next week|after .* (deadline|launch)|hectic|flat out)\b/.test(t)) return 'busy';
    if (/\b(happy to|sure|love to|keen|let's|lets|call|chat|coffee|zoom|teams|free on|available)\b/.test(t)) return 'interested';
    if (t.includes('?')) return 'question';
    return 'interested';
  }

  function replyDraft({ type, them, me }) {
    const name = first(them.name);
    switch (type) {
      case 'interested':
        return `Thanks so much, ${name}! Would a 10-minute call work? Happy to fit around whatever time suits you.`;
      case 'busy':
        return `Totally understand, ${name} — thanks for replying. No rush at all. If it's easier, a quick written answer whenever you have a moment would be great.`;
      case 'not_interested':
        return `No worries at all, ${name}, thanks for letting me know. All the best!`;
      case 'referral_offer':
        return `That's really kind, ${name}, thank you! I'll send my resume${me.projectLink ? ' and project link' : ''} here. Is there a specific role or team I should mention?`;
      default:
        return `Great question, ${name}! [Answer their question in 1–2 lines.] Would a quick 10-minute chat be easier?`;
    }
  }

  // ── Coffee-chat prep card ───────────────────────────────────────────────────
  function prepCard({ them, me, facts }) {
    const name = first(them.name);
    const company = them.currentCompany || 'their company';
    const qs = [
      `What does a typical week look like for a ${facts && facts.theirTitle ? facts.theirTitle : 'person in your role'} at ${company}?`,
      `What skills or tools matter most for a junior ${me.targetRole || 'candidate'} on your team?`,
      `Looking at my ${me.projectName || 'project'}, what would make it more convincing to a hiring manager?`,
      facts && facts.sharedCountry ? `What helped you most when you first moved from ${facts.sharedCountry} into a corporate role here?` :
        `What do you wish you'd known when you started in this field in Australia?`,
      `Is there anyone else you'd suggest I speak to?`
    ];
    const intro = [
      me.name ? `I'm ${first(me.name)}` : `I'm`,
      me.targetRole ? `working towards a ${me.targetRole} role` : '',
      me.story ? `— ${me.story.replace(/\.$/, '')}` : '',
      me.projectName ? `. Recently I built ${me.projectName}${me.projectResult ? ', ' + me.projectResult.replace(/\.$/, '') : ''}.` : '.'
    ].filter(Boolean).join(' ').replace(/\s+\./g, '.').replace(/\s+/g, ' ');
    return { intro, questions: qs, tip: `Keep it to 10 minutes. End by thanking ${name} and asking who else you should talk to.` };
  }

  // ── Weekly coach report ─────────────────────────────────────────────────────
  function coachReport(contacts, now) {
    now = now || Date.now();
    const weekAgo = now - 7 * (S ? S.DAY : 86400000);
    const sentThisWeek = contacts.filter(c => c.inviteSentAt && c.inviteSentAt >= weekAgo);
    const messaged = contacts.filter(c => c.messageSentAt);
    const replied = contacts.filter(c => c.repliedAt);
    const rate = messaged.length ? Math.round((replied.filter(c => c.messageSentAt).length / messaged.length) * 100) : 0;

    const byHook = {};
    for (const c of contacts.filter(c => c.messageSentAt && c.hookType)) {
      byHook[c.hookType] = byHook[c.hookType] || { sent: 0, replied: 0 };
      byHook[c.hookType].sent++;
      if (c.repliedAt) byHook[c.hookType].replied++;
    }
    const hookNames = { post: 'post', school: 'alumni', classmate: 'classmate', mutuals: 'mutuals', country: 'shared path', company: 'ex-colleague', news: 'company news', role: 'same role' };
    const hookLines = Object.entries(byHook).sort((a, b) => (b[1].replied / b[1].sent) - (a[1].replied / a[1].sent))
      .map(([k, v]) => `${hookNames[k] || k} ${v.replied}/${v.sent}`);

    const due = contacts.map(c => ({ c, r: S ? S.dueReminder(c, now) : null })).filter(x => x.r);
    const calls = contacts.filter(c => c.stage === 'call').length;
    const referrals = contacts.filter(c => c.stage === 'referral').length;

    const lines = [
      `Weekly outreach report`,
      `• Invites sent this week: ${sentThisWeek.length} (goal 15–20)`,
      `• Messages sent: ${messaged.length} · replies: ${replied.length} (${rate}% reply rate)`,
      `• Calls booked: ${calls} · referrals: ${referrals}`,
      hookLines.length ? `• What's working: ${hookLines.join(', ')}` : `• What's working: not enough data yet`,
      due.length ? `• Next: ${due.slice(0, 4).map(x => `${first(x.c.name)} (${x.r.text.toLowerCase()})`).join('; ')}` : `• Next: keep going — no follow-ups due`
    ];
    return { text: lines.join('\n'), stats: { sentThisWeek: sentThisWeek.length, messaged: messaged.length, replied: replied.length, rate, calls, referrals, byHook } };
  }

  // ── CSV export ──────────────────────────────────────────────────────────────
  function toCSV(contacts) {
    const cols = ['name', 'company', 'headline', 'profileUrl', 'stage', 'score', 'hookType', 'inviteSentAt', 'connectedAt', 'messageSentAt', 'repliedAt', 'followUpsSent', 'invite', 'afterAccept', 'notes'];
    const fmt = v => v == null ? '' : typeof v === 'number' && v > 1e12 ? new Date(v).toISOString().slice(0, 10) : String(v);
    const esc = v => '"' + fmt(v).replace(/"/g, '""') + '"';
    const rows = contacts.map(c => cols.map(k => esc(k === 'invite' ? c.drafts?.invite : k === 'afterAccept' ? c.drafts?.afterAccept : c[k])).join(','));
    return [cols.join(',')].concat(rows).join('\n');
  }

  const api = { analyseVoice, applyVoice, inviteDraft, afterAcceptDraft, warmDraft, followUpDraft, swapOpening,
    REPLY_TYPES, classifyReplyRules, replyDraft, prepCard, coachReport, toCSV, first };
  root.ArkWriter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
