'use strict';

// verifier.js — the strict checklist every draft passes before the user sees it.
// AI is poor at catching its own mistakes but good at fixing them when told exactly
// what is wrong (Huang et al. 2023; CRITIC, Gou et al. 2023). This file is that "telling".

(function (root) {
  const LIMITS = { invite: 200, invitePremium: 300, afterAccept: 700, followUp: 400, reply: 700 };

  const GENERIC_OPENERS = [
    'i came across your profile', 'i hope this message finds you well', 'i hope you are doing well',
    "i hope you're doing well", 'i hope this finds you', 'i am reaching out', "i'm reaching out",
    'i wanted to reach out', 'dear sir', 'dear madam', 'to whom it may concern', 'greetings'
  ];
  const AI_PHRASES = [
    'delve', 'leverage', 'synergy', 'esteemed', 'thrilled to', 'i would be honored', 'a testament to',
    "in today's fast-paced", 'navigate the', 'navigating the', 'seamless', 'unlock', 'embark', 'tapestry',
    'game-changer', 'cutting-edge', 'passionate about', 'resonate', 'i am confident that', 'invaluable insights',
    'look forward to the possibility'
  ];
  const JOB_ASKS = [
    /\bany (job )?openings?\b/i, /\bjob opportunit/i, /\bhire me\b/i, /\blooking for (a )?job\b/i,
    /\brefer me\b/i, /\breferral\b/i, /\bopen (roles|positions) (in|on) your team\b/i, /\bget me (a|an) (job|interview)\b/i
  ];

  const COMMON_CAPS = new Set(['I', 'Hi', 'Hey', 'Hello', 'Thanks', 'Thank', 'Cheers', 'Best', 'Regards', 'Kind', 'Would',
    'If', 'No', 'Happy', 'Saw', 'Fellow', 'Congrats', 'Congratulations', 'Just', 'Quick', 'Your', 'You', 'My', 'We',
    'It', 'This', 'That', 'Love', 'Loved', 'Great', 'Looking', 'Hope', 'Also', 'And', 'But', 'So', 'Since', 'As',
    'What', 'How', 'When', 'Where', 'Why', 'Which', 'Who', 'LinkedIn', 'Australia', 'Australian', 'Monday', 'Tuesday',
    'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'AI', 'BI', 'SQL', 'PDF', 'CV', 'OK', 'Totally', 'Either',
    'Mind', 'Absolutely', 'Sure', 'Sounds', 'Last', 'Floating', 'Following', 'Glad', 'Really', 'Keen', 'Here', 'There',
    'Built', 'Working', 'Currently', 'Recently', 'Am', 'Are', 'Is', 'Do', 'Does', 'Could', 'Can', 'Shall', 'Will',
    'Mins', 'Minutes', 'Junior', 'Senior', 'Team', 'Role', 'Analyst', 'Engineer', 'Manager', 'Developer', 'Data']);

  // Proper nouns the draft mentions (heuristic: capitalised words not at sentence start)
  function mentionedNames(text) {
    const out = new Set();
    const sentences = String(text).split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
      const words = s.split(/\s+/);
      words.forEach((w, i) => {
        const word = w.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z&]+$/, '').replace(/['’]s$/, '');
        if (!word || i === 0) return;
        if (/^[A-Z][a-zA-Z&.-]{1,}$/.test(word) && !COMMON_CAPS.has(word)) out.add(word);
      });
    }
    return [...out];
  }

  function lower(s) { return String(s || '').toLowerCase(); }

  // opts: { kind, premium, notebookText, hook, recipientFirst }
  function verify(text, opts) {
    opts = opts || {};
    const kind = opts.kind || 'invite';
    const t = String(text || '').trim();
    const lt = lower(t);
    const checks = [];
    const issues = [];
    const add = (label, pass, fix, severity) => {
      checks.push({ label, pass, severity: severity || 'error' });
      if (!pass) issues.push({ label, fix, severity: severity || 'error' });
    };

    // 1. Length
    const limit = kind === 'invite' ? (opts.premium ? LIMITS.invitePremium : LIMITS.invite) : LIMITS[kind] || 700;
    add(`Length ${t.length}/${limit}`, t.length > 0 && t.length <= limit,
      `Shorten to ${limit} characters or fewer (currently ${t.length}).`);

    // 2. No generic opener
    const opener = GENERIC_OPENERS.find(g => lt.includes(g));
    add('No generic opener', !opener, opener ? `Remove the generic phrase "${opener}" and open with the specific reason instead.` : '');

    // 3. No AI-sounding phrases
    const aiHits = AI_PHRASES.filter(p => lt.includes(p));
    add('Sounds human (no AI phrases)', aiHits.length === 0,
      aiHits.length ? `Replace these phrases with plain words: ${aiHits.map(x => '"' + x + '"').join(', ')}.` : '', 'warn');

    // 4. Asks for a conversation, not a job (referral asks only after a real conversation)
    if (kind === 'invite' || kind === 'afterAccept' || kind === 'followUp') {
      const ask = JOB_ASKS.find(r => r.test(t));
      add('Asks for a chat, not a job', !ask,
        ask ? 'Do not ask for a job or referral yet. Ask for advice or a short chat instead.' : '');
    }

    // 5. "After they accept" must contain a real question
    if (kind === 'afterAccept') {
      add('Asks one specific question', t.includes('?'), 'End with one specific question they can answer quickly.');
    }

    // 6. Uses the chosen hook
    if (opts.hook && opts.hook.keyword && kind === 'invite') {
      const k = lower(opts.hook.keyword);
      add('Uses your chosen reason', !k || lt.includes(k),
        `Mention the chosen reason ("${opts.hook.line}").`, 'warn');
    }

    // 7. Every name/place/company must exist in the notebook (no invented facts)
    if (opts.notebookText != null) {
      const known = lower(opts.notebookText + ' ' + (opts.recipientFirst || ''));
      const unknown = mentionedNames(t).filter(n => !known.includes(lower(n)));
      add('Every fact is in your notebook', unknown.length === 0,
        unknown.length ? `These names are not in the known facts — remove them or use only known facts: ${unknown.join(', ')}.` : '');
    }

    // 8. No leftover placeholders
    const placeholder = /\[[^\]]*\]|\{[^}]*\}|<[^>]+>/.test(t);
    add('No placeholders left', !placeholder, 'Replace every [placeholder] with real text or remove it.');

    const errors = issues.filter(i => i.severity === 'error');
    return {
      ok: errors.length === 0,
      checks,
      issues,
      feedback: issues.map(i => '- ' + i.fix).join('\n')
    };
  }

  // Trim a draft to the limit at a sentence or word boundary.
  function fitToLimit(text, limit) {
    let t = String(text || '').trim();
    if (t.length <= limit) return t;
    const sentences = t.split(/(?<=[.!?])\s+/);
    while (sentences.length > 1 && sentences.join(' ').length > limit) sentences.splice(sentences.length - 2, 1);
    t = sentences.join(' ');
    if (t.length > limit) t = t.slice(0, limit - 1).replace(/\s+\S*$/, '') + '…';
    return t;
  }

  const api = { LIMITS, GENERIC_OPENERS, AI_PHRASES, verify, mentionedNames, fitToLimit };
  root.ArkVerifier = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
