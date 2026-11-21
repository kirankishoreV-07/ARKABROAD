'use strict';

// background.js — service worker.
// The original version faked a "3-layer OpenAI pipeline" (it ran a local template
// and waited 300 ms). All AI work now runs in the popup through lib/ai.js, honestly
// labelled. This worker only: (1) asks the LinkedIn tab to read the profile,
// (2) keeps the toolbar badge showing how many follow-ups are due.

importScripts('lib/storage.js', 'lib/evidence.js');

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'scrapeProfile') {
    handleScrapeProfile(sendResponse);
    return true;
  }
  if (message.action === 'importMyLinkedIn') {
    // Long job (~20 s): answer straight away and report progress/result through storage,
    // so it never depends on a message channel staying open.
    const jobId = Date.now();
    sendResponse({ success: true, data: { jobId } });
    runImportJob(jobId);
    return false;
  }
  if (message.action === 'refreshBadge') {
    refreshBadge().then(() => sendResponse({ ok: true }));
    return true;
  }
});

async function handleScrapeProfile(sendResponse) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) throw new Error('No active tab found.');
    if (!tab.url || !/^https:\/\/www\.linkedin\.com\/in\/[^/?#]+\/?(?:[?#].*)?$/i.test(tab.url)) {
      throw new Error('Open a LinkedIn profile page first.');
    }
    let result;
    try {
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    } catch (_) {
      // Content script not injected yet (tab opened before install) — inject and retry.
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_script.js'] });
      await new Promise(r => setTimeout(r, 400));
      result = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' });
    }
    if (!result?.success) throw new Error(result?.error || 'Could not read this profile.');
    const profile = result.data;
    const expected = ArkStore.normalizeUrl(tab.url);
    if (!profile?.profileUrl || ArkStore.normalizeUrl(profile.profileUrl) !== expected) {
      throw new Error('The LinkedIn profile changed during analysis. Open the profile and try again.');
    }
    if (!profile.isSelf) await collectLinkedDetails(profile);
    const currentTab = await chrome.tabs.get(tab.id);
    if (ArkStore.normalizeUrl(currentTab.url) !== expected) {
      throw new Error('The LinkedIn profile changed during analysis. Open the profile and try again.');
    }
    if (!profile.name) {
      const stats = profile.readStats;
      const freshEvidence = profile.headline || profile.sharedSchoolSignal || stats?.education || stats?.experience || stats?.skills;
      const saved = freshEvidence ? await ArkStore.findByProfileUrl(tab.url) : null;
      if (!saved?.name) throw new Error('Could not identify the person on the current LinkedIn page. Refresh the profile and try again.');
      profile.name = saved.name;
      profile.readStats ||= {};
      profile.readStats.identitySource = 'saved name for this profile URL';
    }
    sendResponse({ success: true, data: profile });
  } catch (err) {
    sendResponse({ success: false, error: err.message });
  }
}

// Only open section links exposed by the profile just analysed. Keep a summary
// when LinkedIn omits a link, redirects the tab, or returns an empty section.
async function collectLinkedDetails(profile) {
  const origin = 'https://www.linkedin.com';
  const profilePath = new URL(profile.profileUrl).pathname.replace(/\/$/, '');
  const sections = [['experience', 'experienceItems'], ['education', 'educationItems'], ['skills', 'skillItems']];
  const reads = await Promise.all(sections.map(async ([section, field]) => {
    const link = profile.detailLinks?.[section];
    const expected = origin + profilePath + '/details/' + section;
    if (!link || link.replace(/\/$/, '') !== expected) return [section, field, 'summary', []];
    let tab;
    try {
      tab = await chrome.tabs.create({ url: link, active: false });
      await waitForLoad(tab.id, 10000);
      const loaded = await chrome.tabs.get(tab.id);
      if (!loaded.url || loaded.url.split(/[?#]/)[0].replace(/\/$/, '') !== expected) return [section, field, 'unavailable', []];
      const items = await askTab(tab.id, 'scrapeDetails', 2);
      const afterRead = await chrome.tabs.get(tab.id);
      if (afterRead.url?.split(/[?#]/)[0].replace(/\/$/, '') !== expected) return [section, field, 'unavailable', []];
      return [section, field, items?.length ? 'details' : 'unavailable', items || []];
    } catch (_) {
      return [section, field, 'unavailable', []];
    } finally {
      if (tab) await chrome.tabs.remove(tab.id).catch(() => {});
    }
  }));
  profile.readStats ||= {};
  profile.readStats.details = {};
  for (const [section, field, status, items] of reads) {
    profile.readStats.details[section] = status;
    if (items.length) profile[field] = items.concat(profile[field] || []);
  }
  const parsed = ArkEvidence.theirProfile(profile);
  const current = parsed.experience.find(job => /\bpresent\b/i.test(job.years));
  if (current) {
    profile.currentTitle = current.title;
    profile.currentCompany = current.company || profile.topCompany || null;
  }
  profile.readStats.experience = parsed.experience.length;
  profile.readStats.education = parsed.education.length;
  profile.readStats.skills = parsed.skills.length;
}

// ── One-click import of the user's OWN LinkedIn profile ───────────────────────
// Opens linkedin.com/in/me (and its details pages) in a background tab, reads them, closes the tab.
// Only runs when the user clicks "Import from LinkedIn". Nothing is sent anywhere.
function waitForLoad(tabId, timeoutMs = 20000) {
  return new Promise(resolve => {
    const timer = setTimeout(done, timeoutMs);
    function done() { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(on); resolve(); }
    function on(id, info) { if (id === tabId && info.status === 'complete') done(); }
    chrome.tabs.onUpdated.addListener(on);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') done(); }).catch(done);
  });
}

async function askTab(tabId, action, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const r = await chrome.tabs.sendMessage(tabId, { action });
      if (r && r.success) return r.data;
    } catch (_) {
      try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] }); } catch (__) {}
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  return null;
}

function setImport(state) {
  return chrome.storage.local.set({ arkImport: state });
}

async function runImportJob(jobId) {
  try {
    await setImport({ jobId, status: 'running', step: 'Opening your LinkedIn profile…' });
    const data = await importMyLinkedIn((step) => setImport({ jobId, status: 'running', step }));
    await setImport({ jobId, status: 'done', data, at: Date.now() });
  } catch (err) {
    await setImport({ jobId, status: 'error', error: err.message, at: Date.now() });
  }
}

async function importMyLinkedIn(progress) {
  progress = progress || (() => {});
  const tab = await chrome.tabs.create({ url: 'https://www.linkedin.com/in/me/', active: false });
  try {
    await waitForLoad(tab.id);
    await new Promise(r => setTimeout(r, 2500));
    const t = await chrome.tabs.get(tab.id);
    if (!/linkedin\.com\/in\//.test(t.url || '')) throw new Error('Please sign in to LinkedIn in this browser first, then try again.');
    const base = t.url.match(/https:\/\/www\.linkedin\.com\/in\/[^/?#]+/)[0];
    await progress('Reading your main profile…');
    const main = await askTab(tab.id, 'scrapeProfile');
    const details = {};
    for (const section of ['experience', 'education', 'skills']) {
      await progress(`Reading your ${section}…`);
      await chrome.tabs.update(tab.id, { url: `${base}/details/${section}/` });
      await waitForLoad(tab.id);
      await new Promise(r => setTimeout(r, 2000));
      details[section] = (await askTab(tab.id, 'scrapeDetails')) || [];
    }
    return { main, details, profileUrl: base };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

// ── Follow-up reminders on the toolbar icon ───────────────────────────────────
async function refreshBadge() {
  const contacts = await ArkStore.getContacts();
  const due = contacts.filter(c => ArkStore.dueReminder(c)).length;
  await chrome.action.setBadgeText({ text: due ? String(due) : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#B45309' });
}

chrome.runtime.onInstalled.addListener(async () => {
  await ArkStore.migrateLegacy();          // keep the original "Recent" contacts
  chrome.alarms.create('arkReminders', { periodInMinutes: 60 });
  refreshBadge();
});
chrome.runtime.onStartup.addListener(refreshBadge);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'arkReminders') refreshBadge(); });
