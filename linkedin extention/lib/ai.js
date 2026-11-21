'use strict';

// ai.js — one place that decides which AI engine runs, and the prompts it uses.
//   • On-device: Chrome's built-in Gemini Nano (Prompt API, `LanguageModel`) — free, private, no key.
//   • Claude: the user's own API key — best writing + Deep Mode web research.
//   • Templates: no AI at all — the extension still works.
// AI only READS (messy text → facts) and WRITES. Scores and checks are done in code.

(function (root) {
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  const MODEL_READ  = 'claude-haiku-5-5';  // cheap + fast: understanding text
  const MODEL_WRITE = 'claude-opus-5-5';   // writing + web research

  // ── Engine detection ────────────────────────────────────────────────────────
  async function onDeviceStatus() {
    try {
      if (typeof root.LanguageModel === 'undefined') return 'unsupported';
      const a = await root.LanguageModel.availability({ expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] });
      return a; // 'available' | 'downloadable' | 'downloading' | 'unavailable'
    } catch (_) {
      return 'unsupported';
    }
  }

  // settings.engine: 'auto' | 'ondevice' | 'claude' | 'templates'
  async function chooseEngine(settings) {
    const pref = (settings && settings.engine) || 'auto';
    const hasKey = !!(settings && settings.apiKey);
    if (pref === 'templates') return 'templates';
    if (pref === 'claude') return hasKey ? 'claude' : 'templates';
    const od = await onDeviceStatus();
    if (pref === 'ondevice') return od === 'available' ? 'ondevice' : (od === 'downloadable' || od === 'downloading') ? 'ondevice' : 'templates';
    if (hasKey) return 'claude';
    if (od === 'available') return 'ondevice';
    return 'templates';
  }

  // ── Low-level calls ─────────────────────────────────────────────────────────
  async function onDeviceSession(system, monitor) {
    const opts = {
      initialPrompts: [{ role: 'system', content: system }],
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }]
    };
    if (monitor) opts.monitor = monitor;
    return root.LanguageModel.create(opts);
  }

  async function onDevicePrompt(system, user, schema, onProgress) {
    const session = await onDeviceSession(system, onProgress ? (m) => {
      m.addEventListener('downloadprogress', e => onProgress(Math.round((e.loaded || 0) * 100)));
    } : null);
    try {
      const out = await session.prompt(user, schema ? { responseConstraint: schema } : undefined);
      return schema ? JSON.parse(out) : String(out).trim();
    } finally {
      try { session.destroy(); } catch (_) {}
    }
  }

  async function claudeCall(apiKey, body) {
    const isOpus = String(body.model).startsWith('claude-opus');
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (isOpus) {
      // If a safety classifier declines, the API retries on a fallback model inside the same call.
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body = Object.assign({ fallbacks: 'default' }, body);
    }
    const res = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || `Claude API error (${res.status})`);
    if (data.stop_reason === 'refusal') throw new Error('Claude declined this request.');
    return data;
  }

  function textOf(data) {
    return (data.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
  }

  async function claudeJSON(apiKey, model, system, user, schema) {
    const data = await claudeCall(apiKey, {
      model, max_tokens: 2000, system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema } }
    });
    return JSON.parse(textOf(data));
  }

  async function claudeText(apiKey, model, system, user, maxTokens) {
    const data = await claudeCall(apiKey, {
      model, max_tokens: maxTokens || 1500, system,
      messages: [{ role: 'user', content: user }]
    });
    return textOf(data);
  }

  async function testKey(apiKey) {
    await claudeText(apiKey, MODEL_READ, 'Reply with OK.', 'OK?', 10);
    return true;
  }

  // ── Task 1: understand a profile (messy text → yes/no facts) ────────────────
  const FACTS_SCHEMA = {
    type: 'object',
    properties: {
      roleMatch: { type: 'string', enum: ['exact', 'similar', 'area', 'none'] },
      sameSchool: { type: 'string', description: 'The shared university name, or empty string' },
      sharedCountry: { type: 'string', description: 'Country both moved from, or empty string' },
      sharedCompany: { type: 'string', description: 'Company both worked at, or empty string' },
      postTopic: { type: 'string', description: '3-6 word topic of their most relevant recent post, or empty' },
      postRelevant: { type: 'boolean' },
      postHiring: { type: 'boolean' }
    },
    required: ['roleMatch', 'sameSchool', 'sharedCountry', 'sharedCompany', 'postTopic', 'postRelevant', 'postHiring'],
    additionalProperties: false
  };

  const FACTS_SYSTEM = `You compare a job seeker with a LinkedIn profile and answer strict questions.
Only answer "yes" (non-empty) when the profile text clearly supports it. Never guess.
roleMatch: "exact" = same job as the seeker's target role (seniority words ignored); "similar" = same job family (e.g. BI Analyst vs Data Analyst); "area" = neighbouring field; "none" otherwise.
sameSchool: only if both attended the same university (spellings may differ).
sharedCountry: only if the profile clearly shows they came from the same country as the seeker (e.g. degree from a university in that country).
postRelevant: true if a recent post relates to hiring, their team, or the seeker's target field.`;

  async function understand(engine, settings, them, me) {
    if (engine === 'templates') return null;
    const user = JSON.stringify({
      seeker: { targetRole: me.targetRole, university: me.university, homeCountry: me.homeCountry, pastCompanies: me.pastCompanies },
      profile: {
        headline: them.headline, title: them.currentTitle, company: them.currentCompany, location: them.location,
        education: them.educationEntries, pastCompanies: them.pastCompanies,
        recentPosts: (them.recentPosts || []).map(p => typeof p === 'string' ? p : p.text).slice(0, 3),
        about: String(them.about || '').slice(0, 500)
      }
    });
    const raw = engine === 'claude'
      ? await claudeJSON(settings.apiKey, MODEL_READ, FACTS_SYSTEM, user, FACTS_SCHEMA)
      : await onDevicePrompt(FACTS_SYSTEM, user, FACTS_SCHEMA);
    return {
      roleMatch: raw.roleMatch,
      sameSchool: raw.sameSchool || null,
      sharedCountry: raw.sharedCountry || null,
      sharedCompany: raw.sharedCompany || null,
      postTopic: raw.postTopic || null,
      postRelevant: !!raw.postRelevant,
      postHiring: !!raw.postHiring,
      engine
    };
  }

  // ── Task 2: write a draft from notebook facts only ──────────────────────────
  const WRITE_SYSTEM = `You write LinkedIn outreach for international job seekers in Australia, following Ark Abroad's method:
reach people who already do the job you want, open with one specific shared reason, ask for advice or a short chat, never ask a stranger for a job or referral.
Rules:
- Use ONLY facts from the NOTEBOOK. Never invent names, companies, numbers or events.
- Sound like a real person: plain words, no "I hope this message finds you well", no "I came across your profile", no "delve", "leverage", "passionate".
- Match the sender's voice samples if given (greeting, sentence length, contractions, exclamation marks).
- Return only the message text.`;

  function writePrompt({ kind, notebook, hook, me, them, voiceSamples, limit, feedback, previous, facts }) {
    const warm = kind === 'afterAccept' && facts && String(facts.degree || '').startsWith('1') &&
      ['classmate', 'connection', 'ex_colleague'].includes(facts.relationship);
    const task = warm
      ? `${them.name} is already a ${facts.relationship === 'classmate' ? 'classmate' : facts.relationship === 'ex_colleague' ? 'former colleague' : 'connection'} of the sender. Write a warm, casual direct message (under 500 characters): a friendly opener, one line on the sender's target role${me.projectName ? ' and project' : ''}, then ask if they know ONE person in their network doing that role who might chat for 10 minutes. Offer to send a forwardable note. No job ask.`
      : kind === 'invite'
      ? `Write a LinkedIn connection note to ${them.name}. HARD LIMIT: ${limit} characters including spaces. Open with this reason: "${hook ? hook.line : ''}". One short line about the sender. Friendly close.`
      : kind === 'afterAccept'
        ? `They accepted the connection. Write the follow-up message to ${them.name} (under 600 characters). Thank them briefly, mention the sender's project ${me.projectName ? '"' + me.projectName + '"' : ''}${me.projectLink ? ' with its link' : ''}, then ask ONE specific question about it they can answer in a line. Make it easy to say yes. No job or referral ask.`
        : `Write a short follow-up to ${them.name}.`;
    const tp = (root.ArkEvidence && root.ArkEvidence.theirProfile) ? root.ArkEvidence.theirProfile(them) : null;
    const current = tp && tp.experience[0] ? `${tp.experience[0].title} at ${tp.experience[0].company}` : (them.headline || '');
    let p = `RECIPIENT'S CURRENT ROLE (authoritative — never describe them any other way): ${current}\n\nNOTEBOOK:\n${notebook.map(n => `${n.id} [${n.who}/${n.field}] ${n.text}${n.url ? ' (' + n.url + ')' : ''}`).join('\n')}\n\nTASK: ${task}`;
    if (voiceSamples) p += `\n\nSENDER VOICE SAMPLES:\n${String(voiceSamples).slice(0, 800)}`;
    if (feedback && previous) p += `\n\nYOUR PREVIOUS DRAFT:\n${previous}\n\nIT FAILED THESE CHECKS — FIX EXACTLY THESE AND CHANGE NOTHING ELSE:\n${feedback}`;
    return p;
  }

  async function write(engine, settings, args) {
    const prompt = writePrompt(args);
    if (engine === 'claude') return claudeText(settings.apiKey, MODEL_WRITE, WRITE_SYSTEM, prompt, 1200);
    return onDevicePrompt(WRITE_SYSTEM, prompt, null);
  }

  // ── Task 3: Deep Mode — real company news (Claude web search) ───────────────
  async function research(settings, them, me) {
    if (!settings.apiKey || !them.currentCompany) return [];
    const data = await claudeCall(settings.apiKey, {
      model: MODEL_WRITE, max_tokens: 1500,
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
      system: 'You find recent, verifiable news about a company that would give a job seeker a natural reason to reach out. Return at most 2 items, each on its own line exactly as: NEWS: <one short sentence> | URL: <source url>. If nothing relevant from the last 6 months, return NONE.',
      messages: [{ role: 'user', content: `Company: ${them.currentCompany}${them.location ? ' (' + them.location + ')' : ''}. The seeker targets ${me.targetRole || 'a corporate role'}. Prefer hiring, team growth, launches, or work in that field.` }]
    });
    const text = textOf(data);
    return text.split('\n').map(l => l.match(/NEWS:\s*(.+?)\s*\|\s*URL:\s*(\S+)/i)).filter(Boolean)
      .map(m => ({ text: m[1].replace(/\.$/, ''), url: m[2], source: 'web' })).slice(0, 2);
  }

  // ── Task 4: resume → facts + overseas-experience translation ────────────────
  const RESUME_SCHEMA = {
    type: 'object',
    properties: {
      name: { type: 'string' },
      targetRole: { type: 'string' }, university: { type: 'string' }, homeCountry: { type: 'string' },
      story: { type: 'string', description: 'One plain first-person sentence: background + goal' },
      projectName: { type: 'string', description: 'Best project for the target role, short noun phrase starting with "a"' },
      projectLink: { type: 'string' }, projectResult: { type: 'string', description: 'One result, only numbers from the resume' },
      city: { type: 'string' }, pastCompanies: { type: 'array', items: { type: 'string' } },
      education: { type: 'array', items: { type: 'object', properties: { school: { type: 'string' }, degree: { type: 'string' }, years: { type: 'string' } }, required: ['school', 'degree', 'years'], additionalProperties: false } },
      experience: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, company: { type: 'string' }, years: { type: 'string' } }, required: ['title', 'company', 'years'], additionalProperties: false } },
      skills: { type: 'array', items: { type: 'string' } },
      translatedFacts: { type: 'array', items: { type: 'string' }, description: 'Overseas experience rewritten for Australian readers' },
      missingNumbers: { type: 'array', items: { type: 'string' }, description: 'Questions to ask the user where a result number would help' }
    },
    required: ['name', 'targetRole', 'university', 'homeCountry', 'story', 'projectName', 'projectLink', 'projectResult', 'city', 'pastCompanies', 'education', 'experience', 'skills', 'translatedFacts', 'missingNumbers'],
    additionalProperties: false
  };

  const RESUME_SYSTEM = `You read a migrant job seeker's resume and translate their overseas experience so Australian hiring managers can read it, following Ark Abroad's guide:
- Replace company names Australians won't know with their size and industry (e.g. "a 4,000-person manufacturing group").
- Describe scope (team size, budget, decisions), not inflated or deflated titles.
- Turn duties into outcomes, but ONLY use numbers that appear in the resume. Never invent numbers; instead add a question to missingNumbers.
Also extract: name; targetRole (the role they are clearly aiming for, from their summary or most recent role family); university (most recent degree); homeCountry (country of earlier education/work, never Australia); city (current Australian city if stated); pastCompanies; story (one plain first-person sentence); their single best project for the target role (name, link if present, one result).
Return 3-6 translatedFacts, each one sentence. Leave a field as empty string/array if not in the resume.`;

  async function readResume(engine, settings, { text, pdfBase64 }) {
    if (engine === 'claude') {
      const content = [];
      if (pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } });
      content.push({ type: 'text', text: text ? `RESUME TEXT:\n${text}` : 'Read the attached resume.' });
      const data = await claudeCall(settings.apiKey, {
        model: MODEL_WRITE, max_tokens: 2500, system: RESUME_SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { format: { type: 'json_schema', schema: RESUME_SCHEMA } }
      });
      return JSON.parse(textOf(data));
    }
    if (engine === 'ondevice' && text) return onDevicePrompt(RESUME_SYSTEM, `RESUME TEXT:\n${text.slice(0, 6000)}`, RESUME_SCHEMA);
    return null;
  }

  // ── Task 5: reply assistant ─────────────────────────────────────────────────
  const REPLY_SCHEMA = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['interested', 'busy', 'not_interested', 'referral_offer', 'question'] },
      draft: { type: 'string' }
    },
    required: ['type', 'draft'], additionalProperties: false
  };

  async function replyAssist(engine, settings, { reply, them, me, history }) {
    if (engine === 'templates') return null;
    const system = `${WRITE_SYSTEM}\nClassify the recipient's reply and draft the sender's next message (under 500 characters). interested → propose a 10-minute call with two time options; busy → thank them and offer an async option; not_interested → thank them gracefully; referral_offer → thank them and ask which role/team to mention; question → answer briefly using only known facts.`;
    const user = `Recipient: ${them.name} (${them.headline || ''}). Sender target role: ${me.targetRole || ''}. Sender project: ${me.projectName || ''} ${me.projectLink || ''}.\nPrevious message from sender:\n${history || ''}\n\nTheir reply:\n${reply}`;
    return engine === 'claude'
      ? claudeJSON(settings.apiKey, MODEL_READ, system, user, REPLY_SCHEMA)
      : onDevicePrompt(system, user, REPLY_SCHEMA);
  }

  const api = { MODEL_READ, MODEL_WRITE, onDeviceStatus, chooseEngine, testKey, understand, write, research, readResume, replyAssist, writePrompt };
  root.ArkAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
