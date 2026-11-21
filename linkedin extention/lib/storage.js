'use strict';

// storage.js — everything the extension remembers, kept in chrome.storage.local.
// Contacts get their own id (the original cache matched by profile URL, so two
// contacts without a URL overwrote each other).

(function (root) {
  const KEYS = {
    profile:  'arkProfile',
    settings: 'arkSettings',
    weights:  'arkAhpPairs',
    contacts: 'arkContacts',
    migrated: 'arkMigratedV1'
  };

  const STAGES = ['drafted', 'invite_sent', 'connected', 'replied', 'call', 'referral', 'closed'];
  const STAGE_LABELS = {
    drafted: 'Drafted', invite_sent: 'Invite sent', connected: 'Connected',
    replied: 'Replied', call: 'Call booked', referral: 'Referral', closed: 'Closed'
  };

  const DAY = 24 * 60 * 60 * 1000;

  function area() { return root.chrome && root.chrome.storage && root.chrome.storage.local; }

  function get(keys) {
    return new Promise(resolve => area().get(keys, r => resolve(r || {})));
  }
  function set(obj) {
    return new Promise(resolve => area().set(obj, () => resolve()));
  }

  function uid() {
    if (root.crypto && typeof root.crypto.randomUUID === 'function') return root.crypto.randomUUID();
    return 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  // ── My profile ──────────────────────────────────────────────────────────────
  const EMPTY_PROFILE = {
    name: '', targetRole: '', city: '', homeCountry: '', university: '',
    pastCompanies: '', story: '', projectName: '', projectLink: '', projectResult: '',
    resumeText: '', translatedFacts: [], voiceSamples: '', premium: false,
    education: [], experience: [], skills: [], sources: {}
  };

  async function getProfile() {
    const r = await get([KEYS.profile, 'userName', 'userBio']);
    const p = Object.assign({}, EMPTY_PROFILE, r[KEYS.profile] || {});
    // Carry over the original extension's name/bio fields once.
    if (!p.name && r.userName) p.name = r.userName;
    if (!p.story && r.userBio) p.story = r.userBio;
    return p;
  }
  async function saveProfile(p) { await set({ [KEYS.profile]: p }); }

  // ── Settings ────────────────────────────────────────────────────────────────
  async function getSettings() {
    const r = await get([KEYS.settings, 'userApiKey']);
    const s = Object.assign({ engine: 'auto', apiKey: '', deepMode: false, useLearned: true }, r[KEYS.settings] || {});
    if (!s.apiKey && r.userApiKey) s.apiKey = r.userApiKey; // original key field
    return s;
  }
  async function saveSettings(s) { await set({ [KEYS.settings]: s }); }

  // ── AHP pairwise answers ────────────────────────────────────────────────────
  async function getPairs() {
    const r = await get([KEYS.weights]);
    return r[KEYS.weights] || null;
  }
  async function savePairs(pairs) { await set({ [KEYS.weights]: pairs }); }

  // ── Contacts ────────────────────────────────────────────────────────────────
  function newContact(fields) {
    const now = Date.now();
    return Object.assign({
      id: uid(), name: '', headline: '', company: '', profileUrl: '', source: 'page',
      score: null, factors: null, hookId: null, hookType: null, hookLine: '',
      drafts: { invite: '', afterAccept: '' },
      stage: 'drafted', history: [{ stage: 'drafted', at: now }],
      createdAt: now, updatedAt: now,
      inviteSentAt: null, connectedAt: null, messageSentAt: null, repliedAt: null,
      followUpsSent: 0, lastReply: '', replyType: null, notes: ''
    }, fields || {});
  }

  async function getContacts() {
    const r = await get([KEYS.contacts]);
    return r[KEYS.contacts] || [];
  }

  async function saveContact(contact) {
    const all = await getContacts();
    contact.updatedAt = Date.now();
    const i = all.findIndex(c => c.id === contact.id);
    if (i >= 0) all[i] = contact; else all.unshift(contact);
    await set({ [KEYS.contacts]: all });
    return contact;
  }

  async function deleteContact(id) {
    const all = await getContacts();
    await set({ [KEYS.contacts]: all.filter(c => c.id !== id) });
  }

  async function getContact(id) {
    return (await getContacts()).find(c => c.id === id) || null;
  }

  // Only match by URL when there IS a URL — an empty URL never matches.
  async function findByProfileUrl(url) {
    const clean = normalizeUrl(url);
    if (!clean) return null;
    return (await getContacts()).find(c => normalizeUrl(c.profileUrl) === clean) || null;
  }

  function normalizeUrl(url) {
    return String(url || '').split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  }

  function setStage(contact, stage) {
    if (!STAGES.includes(stage)) throw new Error('Unknown stage ' + stage);
    const now = Date.now();
    contact.stage = stage;
    contact.history = (contact.history || []).concat({ stage, at: now });
    if (stage === 'invite_sent' && !contact.inviteSentAt) contact.inviteSentAt = now;
    if (stage === 'connected' && !contact.connectedAt) contact.connectedAt = now;
    if (stage === 'replied' && !contact.repliedAt) contact.repliedAt = now;
    return contact;
  }

  // ── Reminders ───────────────────────────────────────────────────────────────
  // Follow up on day 4 and day 10 after the "after they accept" message if no reply.
  // Nudge when an invite has been pending for 14 days.
  function dueReminder(c, now) {
    now = now || Date.now();
    if (c.stage === 'connected' && c.messageSentAt && !c.repliedAt) {
      const days = (now - c.messageSentAt) / DAY;
      if (c.followUpsSent === 0 && days >= 4)  return { kind: 'followup1', text: 'Day 4: send a short follow-up' };
      if (c.followUpsSent === 1 && days >= 10) return { kind: 'followup2', text: 'Day 10: last friendly nudge' };
    }
    if (c.stage === 'connected' && !c.messageSentAt && c.connectedAt && (now - c.connectedAt) / DAY >= 1) {
      return { kind: 'send_after_accept', text: 'Connected — send your "after they accept" message' };
    }
    if (c.stage === 'invite_sent' && c.inviteSentAt && (now - c.inviteSentAt) / DAY >= 14) {
      return { kind: 'stale_invite', text: 'Invite pending 14+ days — try someone similar' };
    }
    return null;
  }

  // ── Migration from the original "recentContacts" cache ──────────────────────
  async function migrateLegacy() {
    const r = await get([KEYS.migrated, 'recentContacts', KEYS.contacts]);
    if (r[KEYS.migrated]) return 0;
    const legacy = r.recentContacts || [];
    const existing = r[KEYS.contacts] || [];
    const migrated = legacy.map(l => newContact({
      name: l.name || 'Unknown', headline: l.headline || '', company: l.company || '',
      profileUrl: l.profileUrl || '', source: 'legacy',
      drafts: { invite: l.message || '', afterAccept: '' },
      createdAt: l.timestamp || Date.now(), updatedAt: l.timestamp || Date.now()
    }));
    await set({ [KEYS.contacts]: existing.concat(migrated), [KEYS.migrated]: true });
    return migrated.length;
  }

  const api = {
    KEYS, STAGES, STAGE_LABELS, DAY, uid,
    getProfile, saveProfile, getSettings, saveSettings, getPairs, savePairs,
    newContact, getContacts, getContact, saveContact, deleteContact, findByProfileUrl,
    normalizeUrl, setStage, dueReminder, migrateLegacy
  };
  root.ArkStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
