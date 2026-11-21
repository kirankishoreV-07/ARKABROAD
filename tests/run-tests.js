// Node tests for the extension's logic libraries. Run: node tests/run-tests.js
'use strict';
const path = require('path');
const assert = require('assert');
const EXT = path.join(__dirname, '..', 'linkedin extention', 'lib');

// Minimal chrome.storage.local mock that persists across "restarts" via a shared object.
const disk = {};
global.chrome = { storage: { local: {
  get(keys, cb) { const out = {}; (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in disk) out[k] = JSON.parse(JSON.stringify(disk[k])); }); cb(out); },
  set(obj, cb) { Object.assign(disk, JSON.parse(JSON.stringify(obj))); cb && cb(); }
} } };

function fresh(name) { delete require.cache[require.resolve(path.join(EXT, name))]; return require(path.join(EXT, name)); }
const E = fresh('evidence.js'); global.ArkEvidence = E;
const S = fresh('storage.js'); global.ArkStore = S;
const V = fresh('verifier.js'); global.ArkVerifier = V;
const SC = fresh('scoring.js');
const W = fresh('writer.js');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { failed++; console.log('  ✗ ' + name + '\n    ' + e.message); }
}

const me = { name: 'Ravi Kumar', targetRole: 'Data Analyst', city: 'Melbourne', homeCountry: 'India',
  university: 'Swinburne University of Technology', pastCompanies: 'Amazon', story: 'Worked nights in a warehouse while building data skills',
  projectName: 'a Melbourne housing price dashboard', projectLink: 'https://github.com/ravi/housing', projectResult: 'cleaned 50k rows in Power BI',
  translatedFacts: [], voiceSamples: '', premium: false };
const priya = { name: 'Priya Sharma', headline: 'Data Analyst at Telstra', currentTitle: 'Data Analyst', currentCompany: 'Telstra',
  location: 'Melbourne, Victoria, Australia', educationEntries: ['Swinburne University of Technology — Master of Data Science', 'University of Delhi — B.Com'],
  pastCompanies: ['Infosys'], recentPosts: [{ text: 'Exciting times — our team is growing this year and we are hiring analysts!', stamp: '3d' }],
  profileUrl: 'https://www.linkedin.com/in/priya-sharma', degree: '2nd', mutuals: 4 };
const tom = { name: 'Tom Lee', headline: 'Data Engineer at Acme', currentTitle: 'Data Engineer', currentCompany: 'Acme', location: 'Sydney',
  educationEntries: ['UNSW'], pastCompanies: [], recentPosts: [], degree: '3rd', mutuals: null };

(async () => {
  console.log('AHP');
  await test('default answers give 46.7 / 27.8 / 16.0 / 9.5 with CR < 0.10', () => {
    const r = SC.ahp(SC.DEFAULT_PAIRS);
    assert.strictEqual(r.weights.role.toFixed(3), '0.467');
    assert.strictEqual(r.weights.shared.toFixed(3), '0.278');
    assert.strictEqual(r.weights.reach.toFixed(3), '0.160');
    assert.strictEqual(r.weights.timing.toFixed(3), '0.095');
    assert.ok(r.CR < 0.02 && r.consistent);
  });
  await test('contradictory answers are flagged inconsistent', () => {
    const r = SC.ahp([{ a: 'role', b: 'shared', value: 9 }, { a: 'shared', b: 'reach', value: 9 }, { a: 'reach', b: 'role', value: 9 },
      { a: 'role', b: 'timing', value: 1 }, { a: 'shared', b: 'timing', value: 1 }, { a: 'reach', b: 'timing', value: 1 }]);
    assert.ok(!r.consistent, 'CR=' + r.CR);
  });
  await test('slider ⇄ Saaty value round-trips', () => {
    for (let s = -8; s <= 8; s++) assert.strictEqual(SC.valueToSlider(SC.sliderToValue(s)), s);
  });

  console.log('Understanding (rules)');
  const fp = E.ruleFacts(priya, me);
  await test('Priya: exact role, same uni, shared country, relevant post 3 days ago', () => {
    assert.strictEqual(fp.roleMatch, 'exact');
    assert.ok(fp.sameSchool && /Swinburne/.test(fp.sameSchool));
    assert.strictEqual(fp.sharedCountry, 'India');
    assert.ok(fp.post.relevant && fp.post.daysAgo === 3);
  });
  await test('role families: BI Analyst ≈ Data Analyst, Data Engineer is neighbouring area', () => {
    assert.strictEqual(E.roleMatch('Business Intelligence Analyst II', 'Data Analyst'), 'similar');
    assert.strictEqual(E.roleMatch('Data Engineer', 'Data Analyst'), 'area');
    assert.strictEqual(E.roleMatch('Chef', 'Data Analyst'), 'none');
    assert.strictEqual(E.roleMatch('Senior Data Analyst', 'Data Analyst'), 'exact');
  });
  await test('post stamps parse to days', () => {
    assert.strictEqual(E.daysFromStamp('3d'), 3);
    assert.strictEqual(E.daysFromStamp('2w'), 14);
    assert.strictEqual(E.daysFromStamp('1mo'), 30);
    assert.strictEqual(E.daysFromStamp('5h'), 0);
  });

  console.log('Scoring');
  await test('Priya scores ~92, Tom scores low, ranking is stable', () => {
    const w = SC.ahp(SC.DEFAULT_PAIRS).weights;
    const a = SC.scoreFacts(fp, w), b = SC.scoreFacts(E.ruleFacts(tom, me), w);
    assert.ok(a.score >= 85, 'Priya ' + a.score);
    assert.ok(b.score <= 30, 'Tom ' + b.score);
    assert.strictEqual(SC.scoreFacts(fp, w).score, a.score);
  });
  await test('reachability rewards 2nd-degree with some mutuals', () => {
    assert.strictEqual(SC.reachPoints({ degree: '2nd', mutuals: 4 }), 10);
    assert.strictEqual(SC.reachPoints({ degree: '2nd', mutuals: 0 }), 5);
    assert.strictEqual(SC.reachPoints({ degree: '3rd', mutuals: null }), 2);
  });
  await test('top 3 hooks, strongest first, include post + school', () => {
    const hooks = SC.buildHooks(fp, me, priya);
    assert.strictEqual(hooks.length, 3);
    assert.strictEqual(hooks[0].type, 'post');
    assert.ok(hooks.some(h => h.type === 'school'));
  });

  console.log('Writer + checker');
  const book = E.buildNotebook(priya, me, []);
  const bookText = book.map(n => n.text).join(' ') + ' ' + [me.city, me.university, me.projectName].join(' ');
  const hooks = SC.buildHooks(fp, me, priya);
  for (const hook of hooks) {
    await test(`invite draft for "${hook.type}" passes every hard check and is ≤200 chars`, () => {
      const t = W.inviteDraft({ them: priya, me, hook });
      const r = V.verify(t, { kind: 'invite', notebookText: bookText, hook, recipientFirst: 'Priya' });
      assert.ok(t.length <= 200, t.length + ': ' + t);
      assert.ok(r.ok, r.feedback + '\n' + t);
    });
  }
  await test('"after they accept" draft has the project, link and one question', () => {
    const t = W.afterAcceptDraft({ them: priya, me, hook: hooks[1] });
    const r = V.verify(t, { kind: 'afterAccept', notebookText: bookText, recipientFirst: 'Priya' });
    assert.ok(t.includes('housing') && t.includes('github.com') && t.includes('?'));
    assert.ok(r.ok, r.feedback);
  });
  await test('checker catches generic opener, AI phrase, job ask, invented company, length', () => {
    const bad = 'Hi Priya, I came across your profile and would love to leverage my skills at Google. Any job openings on your team? ' + 'x'.repeat(120);
    const r = V.verify(bad, { kind: 'invite', notebookText: bookText, recipientFirst: 'Priya' });
    const labels = r.issues.map(i => i.label).join(' | ');
    assert.ok(!r.ok);
    ['generic opener', 'AI phrases', 'not a job', 'notebook', 'Length'].forEach(k => assert.ok(labels.includes(k), 'missing ' + k + ' in ' + labels));
  });
  await test('switching hook replaces only the opening and keeps the rest of the edit', () => {
    const t = W.inviteDraft({ them: priya, me, hook: hooks[0] }) + ' (edited by Ravi)';
    const s = W.swapOpening(t, hooks[0], hooks[1]);
    assert.ok(s.replaced && s.text.includes('(edited by Ravi)') && s.text.toLowerCase().includes(hooks[1].line.toLowerCase()));
    const own = W.swapOpening('Hi Priya, totally my own words.', hooks[0], hooks[1]);
    assert.ok(!own.replaced && own.text === 'Hi Priya, totally my own words.');
  });
  await test('voice: casual samples keep contractions and "Hey"; formal samples remove them', () => {
    const casual = W.analyseVoice("Hey mate! I'm keen to chat. Can't wait!");
    const formal = W.analyseVoice('Hello Sarah. I am writing about the analyst role. Thank you for your time.');
    assert.strictEqual(casual.greeting, 'Hey');
    assert.ok(W.applyVoice("Hi Priya, I'm keen!", formal).includes('I am'));
    assert.ok(!W.applyVoice("Hi Priya, I'm keen!", formal).includes('!'));
  });
  await test('reply rules classify common replies', () => {
    assert.strictEqual(W.classifyReplyRules('Happy to chat, free Thursday?'), 'interested');
    assert.strictEqual(W.classifyReplyRules('Bit swamped this week, maybe next week'), 'busy');
    assert.strictEqual(W.classifyReplyRules('Send me your resume and I can refer you'), 'referral_offer');
    assert.strictEqual(W.classifyReplyRules('Sorry, not interested'), 'not_interested');
  });

  console.log('Real case: a classmate (1st-degree, shared education, ex-colleague signal)');
  const mhokesh = { name: 'Mhokesh Palanivel', headline: 'CSE(AI) Undergrad @AmritaUniversity', currentTitle: 'CSE(AI) Undergrad', currentCompany: 'AmritaUniversity',
    location: 'Coimbatore, Tamil Nadu, India', educationEntries: ['Amrita Vishwa Vidyapeetham'], pastCompanies: [], recentPosts: [],
    profileUrl: 'https://www.linkedin.com/in/mhokesh', degree: '1st', mutuals: 105, isConnected: true, isStudent: true,
    topSchool: 'Amrita Vishwa Vidyapeetham', sharedSchoolSignal: 'Amrita Vishwa Vidyapeetham', sharedCompanySignal: 'Netkathir Technologies Pvt Ltd',
    experienceItems: [['Software Intern', 'Netkathir Technologies Pvt Ltd · Internship', 'May 2024 - Jul 2024 · 3 mos']] };
  const emptyMe = { targetRole: '', university: '', city: '', homeCountry: '', pastCompanies: '' };
  const kiran = Object.assign({}, me, { university: 'Amrita Vishwa Vidyapeetham', city: 'Coimbatore', homeCountry: 'India', targetRole: 'AI Engineer', pastCompanies: 'Netkathir Technologies Pvt Ltd' });
  await test('empty My profile: classmate still detected from LinkedIn signals; role left out, not 0', () => {
    const f = E.ruleFacts(mhokesh, emptyMe);
    const r = SC.scoreFacts(f, SC.ahp(SC.DEFAULT_PAIRS).weights);
    assert.strictEqual(f.relationship, 'classmate');
    assert.strictEqual(r.points.role, null);
    assert.strictEqual(r.points.reach, 10);
    assert.ok(r.score >= 60, 'score ' + r.score);
    assert.strictEqual(r.replyChance, 'Very high');
    assert.ok(/intro/i.test(r.action));
  });
  await test('filled My profile: classmate scores well, career help is honest, best move is an intro', () => {
    const f = E.ruleFacts(mhokesh, kiran);
    const r = SC.scoreFacts(f, SC.ahp(SC.DEFAULT_PAIRS).weights);
    assert.ok(r.score >= 50, 'score ' + r.score);
    assert.ok(['Very high', 'High'].includes(r.replyChance));
    assert.strictEqual(r.careerHelp, 'Low');
    const hooks = SC.buildHooks(f, kiran, mhokesh);
    assert.strictEqual(hooks[0].type, 'classmate');
  });
  await test('classmate gets a warm intro-ask message (not "thanks for connecting") that passes the checker', () => {
    const f = E.ruleFacts(mhokesh, kiran);
    const hooks = SC.buildHooks(f, kiran, mhokesh);
    const t = W.afterAcceptDraft({ them: mhokesh, me: kiran, hook: hooks[0], facts: f });
    const nb = E.buildNotebook(mhokesh, kiran, []).map(n => n.text).join(' ') + ' ' + kiran.projectName;
    const r = V.verify(t, { kind: 'afterAccept', notebookText: nb, recipientFirst: 'Mhokesh' });
    assert.ok(!/thanks for connecting/i.test(t) && /network/i.test(t) && t.includes('Netkathir'), t);
    assert.ok(r.ok, r.feedback + '\n' + t);
  });

  console.log('Real case: Aaditya (no shared company, both in India, reposted someone else\'s post)');
  const aaditya = { name: 'Aaditya Umashankar', headline: 'Software Engineer 3 at Zuora', currentTitle: 'Software Engineer 3', currentCompany: 'Zuora',
    location: 'Chennai, Tamil Nadu, India', degree: '1st', mutuals: 5, isConnected: true,
    sharedCompanySignal: 'Latlon Technologies Pvt. Ltd.',   // came from the right-hand rail, about someone else
    experienceItems: [['Software Engineer 3', 'Zuora · Full-time', 'Aug 2024 - Present · 1 yr 4 mos'], ['Software Engineer 2', 'Freshworks · Full-time', 'Jul 2021 - Aug 2024']],
    educationItems: [['SSN College of Engineering', 'Bachelor of Engineering - BE, Computer Science and Engineering', '2017 - 2021']],
    skillItems: [['Java'], ['Python'], ['Machine Learning'], ['Distributed Systems'], ['SQL']],
    recentPosts: [{ text: 'From Strategy to Performance Delivery: our Chief Revenue Officer shares how we scaled revenue operations across APAC this year.', stamp: '1w', kind: 'repost' }] };
  const kiran2 = Object.assign({}, kiran, { targetRole: 'AI Intern', skills: ['Python', 'Machine Learning', 'LangChain', 'SQL'],
    education: [{ school: 'Amrita Vishwa Vidyapeetham', degree: 'B.Tech Computer Science (AI)', years: '2022 - 2026' }] });
  await test('no false "both worked at", no "moved from India" when he lives in India, repost ignored', () => {
    const f = E.ruleFacts(aaditya, kiran2);
    assert.strictEqual(f.sharedCompany, null);
    assert.strictEqual(f.sharedCountry, null);
    assert.strictEqual(f.post, null);
    const hooks = SC.buildHooks(f, kiran2, aaditya).map(h => h.type);
    assert.ok(!hooks.includes('company') && !hooks.includes('country') && !hooks.includes('post'), hooks.join());
  });
  await test('real overlap is found and explained: same field (computer science) + shared skills; role fit is "area"', () => {
    const f = E.ruleFacts(aaditya, kiran2);
    assert.ok(f.sameField, 'field');
    assert.deepStrictEqual(f.commonSkills.sort(), ['Machine Learning', 'Python', 'SQL']);
    assert.strictEqual(f.roleMatch, 'area');
    assert.strictEqual(f.seniority, 3);
    const r = SC.scoreFacts(f, SC.ahp(SC.DEFAULT_PAIRS).weights);
    assert.ok(r.reasons.find(x => x.c === 'shared').text.includes('Shared skills'));
    assert.strictEqual(SC.buildHooks(f, kiran2, aaditya)[0].type, 'skills');
  });
  await test('company names match on the core name only ("Netkathir Technologies" ≠ "Latlon Technologies")', () => {
    assert.notStrictEqual(E.companyKey('Latlon Technologies Pvt. Ltd.'), E.companyKey('Netkathir Technologies Pvt Ltd'));
    assert.strictEqual(E.companyKey('Zoho Corporation Pvt Ltd'), E.companyKey('Zoho'));
  });

  console.log('Real case: Hari (sections read after scrolling the whole page)');
  await test('Hari: classmate at Amrita, same field (CS + AI), shared skills incl. "Python (Programming Language)"', () => {
    const hari = { name: 'Hari vaarthan T.D', headline: 'AI & Cloud Developer | AWS Serverless | Python | LLMs | B.Tech AI @ Amrita | Open to Internships',
      location: 'Coimbatore, Tamil Nadu, India', degree: '1st', mutuals: 83, isConnected: true, isStudent: true,
      experienceItems: [['Cloud intern', 'SkyLena Info Technology Pvt. Ltd · Internship', 'Apr 2026 - May 2026 · 2 mos']],
      educationItems: [['Amrita Vishwa Vidyapeetham', 'B.Tech, Computer science with artificial intelligence', 'Aug 2023 – Aug 2027'], ['Sri Chaitanya College of Education', '', 'Apr 2019 – Mar 2023']],
      skillItems: [['Amazon Web Services (AWS)'], ['Python (Programming Language)'], ['Large Language Models (LLM)']] };
    const f = E.ruleFacts(hari, Object.assign({}, kiran2, { skills: ['Python', 'LLMs', 'AWS', 'SQL'] }));
    assert.strictEqual(f.relationship, 'classmate');
    assert.ok(/Amrita/.test(f.sameSchool));
    assert.ok(f.commonField.includes('Computer Science') && f.commonField.includes('AI'), f.commonField.join());
    assert.strictEqual(f.commonSkills.length, 3, f.commonSkills.join());
    const r = SC.scoreFacts(f, SC.ahp(SC.DEFAULT_PAIRS).weights);
    assert.strictEqual(r.points.shared, 10);  // school 4 + field 2 + same course 2 + 3 skills 1 + city 1 (capped at 10)
  });

  console.log('Real case: Hari again — school written differently, or sections not read');
  const hariBase = { name: 'Hari vaarthan T.D', headline: 'AI & Cloud Developer | AWS Serverless | Python | LLMs | B.Tech AI @ Amrita | Open to Internships',
    location: 'Greater Coimbatore Area', degree: '1st', mutuals: 83, isConnected: true, isStudent: true };
  await test('my school "Amrita University" = their "Amrita Vishwa Vidyapeetham" (alias), course matches too', () => {
    const f = E.ruleFacts(Object.assign({}, hariBase, { educationItems: [['Amrita Vishwa Vidyapeetham', 'B.Tech, Computer science with artificial intelligence', 'Aug 2023 – Aug 2027']] }),
      Object.assign({}, kiran2, { university: 'Amrita University', education: [{ school: 'Amrita University', degree: 'B.Tech CSE (AI)', years: '2022 - 2026' }] }));
    assert.strictEqual(f.relationship, 'classmate');
    assert.ok(f.commonField.includes('AI'), f.commonField.join());
  });
  await test('shared education without study dates is reported without claiming a shared class', () => {
    const f = E.ruleFacts(Object.assign({}, hariBase, { topSchool: 'Amrita Vishwa Vidyapeetham', sharedSchoolSignal: 'the same school' }), kiran2);
    assert.strictEqual(f.relationship, 'alumni');
    // and with an empty My profile, LinkedIn's own signal alone is enough
    const g = E.ruleFacts(Object.assign({}, hariBase, { headline: 'Developer', sharedSchoolSignal: 'the same school', topSchool: '' }), { targetRole: '' });
    assert.ok(g.sameSchool && g.evidence.some(e => /LinkedIn/.test(e.source)), JSON.stringify(g.evidence));
  });
  await test('nothing but the headline "@ Amrita" still finds the shared school', () => {
    const f = E.ruleFacts(hariBase, kiran2);
    assert.ok(/Amrita/.test(f.sameSchool || ''), String(f.sameSchool));
    assert.ok(f.evidence.some(e => e.source === 'their headline'));
  });
  await test('role fit: "AI Intern" vs "AI & Cloud Developer" headline = similar (not "different area")', () => {
    const f = E.ruleFacts(hariBase, kiran2);
    assert.strictEqual(f.roleMatch, 'similar');
  });
  await test('school matcher: aliases yes, look-alikes no', () => {
    assert.ok(E.schoolsMatch('RMIT', 'Royal Melbourne Institute of Technology'));
    assert.ok(E.schoolsMatch('SSN', 'SSN College of Engineering'));
    assert.strictEqual(E.schoolsMatch('PSG College of Technology', 'PSG College of Arts and Science'), null);
    assert.strictEqual(E.schoolsMatch('Anna University', 'Amrita Vishwa Vidyapeetham'), null);
    assert.strictEqual(E.schoolsMatch('University of Melbourne', 'Monash University'), null);
  });

  console.log('Resume (rule fallback)');
  await test('basic rules pull name, uni, city, home country, companies, project link', () => {
    const r = E.parseResumeRules(`Ravi Kumar
Data Analyst | SQL · Power BI
Melbourne, VIC · ravi@example.com
EXPERIENCE
Warehouse Associate at Amazon, 2023–now
Analyst at Vardhman Industries, Ludhiana
EDUCATION
Swinburne University of Technology — Master of Data Science
University of Delhi — B.Com
PROJECTS
Melbourne housing price dashboard — Power BI
https://github.com/ravi/housing`);
    assert.strictEqual(r.name, 'Ravi Kumar');
    assert.ok(/Swinburne/.test(r.university), r.university);
    assert.strictEqual(r.city, 'Melbourne');
    assert.strictEqual(r.homeCountry, 'India');
    assert.ok(r.pastCompanies.includes('Amazon'), r.pastCompanies.join());
    assert.strictEqual(r.projectLink, 'https://github.com/ravi/housing');
    assert.ok(/housing/i.test(r.projectName), r.projectName);
    assert.ok(/Data Analyst/.test(r.targetRole), r.targetRole);
  });

  console.log('Resume files + LinkedIn import (structured profile)');
  const FT = fresh('fileText.js');
  const fs = require('fs');
  for (const n of ['resume.pdf', 'resume.docx']) {
    await test(`${n}: text read on-device and turned into education / experience / skills / project`, async () => {
      const r = await FT.extract(new File([fs.readFileSync(path.join(__dirname, 'fixtures', n))], n));
      assert.ok(r.readable, 'words ' + r.words);
      const p = E.parseResumeRules(r.text);
      assert.strictEqual(p.name, 'Kiran Kishore V');
      assert.strictEqual(p.education[0].school, 'Amrita Vishwa Vidyapeetham');
      assert.ok(/B\.Tech/.test(p.education[0].degree), p.education[0].degree);
      assert.strictEqual(p.experience[0].company, 'Netkathir Technologies Pvt Ltd');
      assert.strictEqual(p.experience[0].title, 'Machine Learning Intern');
      assert.ok(p.skills.includes('PyTorch'), p.skills.join());
      assert.strictEqual(p.projectLink, 'https://github.com/kiran/ark-outreach');
      assert.strictEqual(p.targetRole, 'AI Engineer');
      assert.ok(p.translatedFacts[0].includes('60%'));
    });
  }
  await test('LinkedIn details pages (single + grouped roles) become structured entries', () => {
    const d = E.parseLinkedInDetails({
      experience: [['Machine Learning Intern', 'Netkathir Technologies Pvt Ltd · Internship', 'Jun 2024 - Jan 2025 · 8 mos', 'Coimbatore, India'],
        ['Zoho', 'Full-time · 2 yrs', 'Software Developer', 'Jan 2023 - Present']],
      education: [['Amrita Vishwa Vidyapeetham', 'Bachelor of Technology - BTech, Computer Science (AI)', '2022 - 2026']],
      skills: [['Python'], ['Machine Learning'], ['Show all 20 skills']]
    });
    assert.deepStrictEqual(d.experience.map(e => e.company), ['Netkathir Technologies Pvt Ltd', 'Zoho']);
    assert.strictEqual(d.experience[1].title, 'Software Developer');
    assert.strictEqual(d.education[0].school, 'Amrita Vishwa Vidyapeetham');
    assert.deepStrictEqual(d.skills, ['Python', 'Machine Learning']);
  });
  await test('any school in my education list (not just the first) finds classmates', () => {
    const meMulti = { targetRole: 'AI Engineer', university: 'Chinmaya Vidyalaya', education: [{ school: 'Chinmaya Vidyalaya' }, { school: 'Amrita Vishwa Vidyapeetham' }] };
    const f = E.ruleFacts(Object.assign({}, mhokesh, { sharedSchoolSignal: '' }), meMulti);
    assert.ok(/Amrita/.test(f.sameSchool || ''), f.sameSchool);
  });

  console.log('Profile completeness and scoring');
  await test('later education entries can match while an unrelated first degree does not get the program bonus', () => {
    const mine = { education: [{ school: 'Amrita University', degree: 'B.Tech CSE (AI)', years: '2022 – 2026' }] };
    const view = { educationItems: [
      ['Amrita Vishwa Vidyapeetham', 'Bachelor of Commerce', '2016 – 2020'],
      ['Amrita Vishwa Vidyapeetham', 'B.Tech Computer Science and Engineering (AI)', '2023 – 2027'],
      ['University of Melbourne', 'Master of Data Science', '2027 – 2029']
    ] };
    const f = E.ruleFacts(view, mine);
    assert.ok(f.sameSchoolCourse);
    assert.strictEqual(f.relationship, 'classmate');
    const different = E.ruleFacts({ educationItems: [
      ['Amrita University', 'Bachelor of Commerce', '2016 – 2020'],
      ['University of Melbourne', 'B.Tech CSE (AI)', '2022 – 2026']
    ] }, mine);
    assert.ok(different.sameSchool && different.sameField);
    assert.strictEqual(different.sameSchoolCourse, false);
    assert.strictEqual(different.relationship, 'alumni');
  });
  await test('missing sections stay unknown and AI does not change the score', () => {
    const f = E.ruleFacts({ currentTitle: 'Data Analyst', readStats: { sectionsFound: [] } }, { targetRole: 'Data Analyst' });
    const result = SC.scoreFacts(E.mergeFacts(f, { roleMatch: 'none', postHiring: true }));
    assert.strictEqual(result.points.role, 10);
    assert.strictEqual(result.points.shared, null);
    assert.strictEqual(result.points.reach, null);
    assert.strictEqual(result.points.timing, null);
    assert.strictEqual(result.score, null);
  });
  await test('same school word in different institution names does not count as a shared school', () => {
    assert.strictEqual(E.schoolsMatch('Newcastle University', 'Newcastle College'), null);
    assert.strictEqual(E.schoolsMatch('PSG College of Technology', 'PSG College of Arts and Science'), null);
  });
  await test('all grouped jobs and later skills survive details parsing without duplicate preview rows', () => {
    const grouped = ['Acme', 'Full-time · 3 yrs', 'Senior Analyst', 'Jan 2024 – Present', 'Analyst', 'Jan 2022 – Dec 2023'];
    const skills = Array.from({ length: 45 }, (_, i) => ['Topic ' + i]);
    const parsed = E.parseLinkedInDetails({ experience: [grouped, grouped], skills });
    assert.deepStrictEqual(parsed.experience.map(x => x.title), ['Senior Analyst', 'Analyst']);
    assert.strictEqual(parsed.skills.length, 45);
  });

  await test('Sales Insights shared education contributes even without saved education or target role', () => {
    const view = { topSchool: 'Amrita Vishwa Vidyapeetham', sharedSchoolSignal: 'the same school', degree: '1st',
      headline: 'AI & Cloud Developer | B.Tech AI @ Amrita | Open to Internships', readStats: { sectionsFound: ['Activity'] } };
    const f = E.ruleFacts(view, {});
    assert.equal(f.sameSchool, 'the same school');
    assert.equal(f.relationship, 'alumni');
    assert.equal(SC.scoreFacts(f).points.shared, 4);
    assert.ok(f.evidence.some(row => row.source.includes('shared-education')));
    const fromSaved = E.ruleFacts(view, { university: 'Amrita University' });
    assert.equal(fromSaved.sameSchool, 'Amrita Vishwa Vidyapeetham');
  });
  await test('headline compares the school in an education clause, even after an employer tag', () => {
    const view = { headline: 'Software Intern @ Example | B.Tech AI @ Amrita' };
    assert.equal(E.ruleFacts(view, { university: 'Amrita University' }).sameSchool, 'Amrita University');
    assert.equal(E.ruleFacts(view, { university: 'Example' }).sameSchool, null);
  });

  console.log('Learning score weights from real replies');
  const LRN = fresh('learning.js');
  const AHPW = SC.ahp(SC.DEFAULT_PAIRS).weights;
  const NOW = Date.now(), D = 86400000;
  const mkC = (i, p, replied, daysAgo) => ({ name: 'c' + i, points: p, messageSentAt: NOW - (daysAgo || 20) * D,
    repliedAt: replied ? NOW - 15 * D : null, stage: replied ? 'replied' : 'connected' });
  const shapedSet = () => {
    const cs = []; let i = 0;
    [10, 9, 8, 7, 8, 9].forEach(sv => cs.push(mkC(i++, { role: 2, shared: sv, reach: 6, timing: 0 }, true)));
    [9, 8].forEach(sv => cs.push(mkC(i++, { role: 9, shared: sv, reach: 6, timing: 0 }, false)));
    [0, 1, 2, 0, 1, 3, 2, 0].forEach(sv => cs.push(mkC(i++, { role: 9, shared: sv, reach: 6, timing: 0 }, false)));
    [1, 0].forEach(sv => cs.push(mkC(i++, { role: 3, shared: sv, reach: 6, timing: 0 }, true)));
    return cs;
  };
  await test('outcomes: reply = 1, silent 14+ days = 0, still waiting / never sent = not counted', () => {
    assert.strictEqual(LRN.outcomeOf({ repliedAt: NOW }, NOW), 1);
    assert.strictEqual(LRN.outcomeOf({ messageSentAt: NOW - 15 * D }, NOW), 0);
    assert.strictEqual(LRN.outcomeOf({ messageSentAt: NOW - 3 * D }, NOW), null);
    assert.strictEqual(LRN.outcomeOf({ stage: 'drafted' }, NOW), null);
    assert.strictEqual(LRN.outcomeOf({ inviteSentAt: NOW - 2 * D, stage: 'closed' }, NOW), 0);
  });
  await test('too few outcomes: keeps the coach (AHP) weights and says what is still needed', () => {
    const r = LRN.learn(shapedSet().slice(0, 5), AHPW, NOW);
    assert.strictEqual(r.status, 'collecting');
    assert.deepStrictEqual(r.weights, AHPW);
    assert.ok(/needs/.test(r.message));
  });
  await test('replies driven by shared ground: shared weight rises, role fit falls, coach keeps ≥ 50%', () => {
    const r = LRN.learn(shapedSet(), AHPW, NOW);
    assert.strictEqual(r.status, 'ready');
    assert.ok(r.weights.shared > AHPW.shared + 0.08, 'shared ' + r.weights.shared);
    assert.ok(r.weights.role < AHPW.role - 0.08, 'role ' + r.weights.role);
    assert.ok(r.alpha <= LRN.MAX_ALPHA);
    const sum = Object.values(r.weights).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, 'weights sum to 1');
    assert.strictEqual(r.topGain, 'shared');
    assert.ok(r.lifts.shared.strong > r.lifts.shared.weak);
  });
  await test('learning is deterministic and can be switched off', () => {
    const a = LRN.learn(shapedSet(), AHPW, NOW), b = LRN.learn(shapedSet(), AHPW, NOW);
    assert.deepStrictEqual(a.weights, b.weights);
    assert.deepStrictEqual(LRN.effectiveWeights(AHPW, a, false), AHPW);
    assert.deepStrictEqual(LRN.effectiveWeights(AHPW, a, true), a.weights);
  });
  await test('contacts saved without factor points are ignored, unknown factors count as neutral', () => {
    const ex = LRN.examples([{ name: 'old', repliedAt: NOW }, { name: 'new', points: { role: null, shared: 4, reach: 10, timing: 0 }, repliedAt: NOW }], NOW);
    assert.strictEqual(ex.length, 1);
    assert.deepStrictEqual(ex[0].x, [0.5, 0.4, 1, 0]);
  });

  console.log('Storage (simulated browser restart)');
  await test('legacy "recentContacts" are migrated once and still open', async () => {
    disk.recentContacts = [{ profileUrl: '', name: 'Old Contact', headline: 'x', company: 'y', message: 'hello', timestamp: 1 }];
    assert.strictEqual(await S.migrateLegacy(), 1);
    assert.strictEqual(await S.migrateLegacy(), 0);
    const all = await S.getContacts();
    assert.ok(all.some(c => c.name === 'Old Contact' && c.drafts.invite === 'hello' && c.id));
  });
  await test('two contacts with empty profile links do NOT overwrite each other (original bug)', async () => {
    const a = S.newContact({ name: 'Priya', profileUrl: '' });
    const b = S.newContact({ name: 'Maya', profileUrl: '' });
    await S.saveContact(a); await S.saveContact(b);
    const S2 = fresh('storage.js'); // "restart"
    const names = (await S2.getContacts()).map(c => c.name);
    assert.ok(names.includes('Priya') && names.includes('Maya'));
    assert.strictEqual(await S2.findByProfileUrl(''), null);
  });
  await test('edits and stage survive a restart; reminders fire on day 4 and day 10', async () => {
    const c = S.newContact({ name: 'Priya', profileUrl: 'https://www.linkedin.com/in/priya-sharma/' });
    c.drafts.afterAccept = 'edited text'; c.edited = { afterAccept: true };
    S.setStage(c, 'invite_sent'); S.setStage(c, 'connected');
    c.messageSentAt = Date.now() - 5 * S.DAY;
    await S.saveContact(c);
    const S2 = fresh('storage.js');
    const back = await S2.findByProfileUrl('https://www.linkedin.com/in/priya-sharma?trk=x');
    assert.ok(back && back.drafts.afterAccept === 'edited text' && back.stage === 'connected');
    assert.strictEqual(S2.dueReminder(back).kind, 'followup1');
    back.followUpsSent = 1; back.messageSentAt = Date.now() - 11 * S.DAY;
    assert.strictEqual(S2.dueReminder(back).kind, 'followup2');
  });
  await test('coach report and CSV include the contacts', async () => {
    const all = await S.getContacts();
    const rep = W.coachReport(all);
    assert.ok(rep.text.includes('Weekly outreach report'));
    const csv = W.toCSV(all);
    assert.ok(csv.split('\n').length === all.length + 1 && csv.includes('Maya'));
  });

  console.log('\nLoom demo cast (Australia · Monash)');
  {
    // Same records the harness serves for ?person=rahul|chloe|tom&me=ananya
    const src = require('fs').readFileSync(path.join(__dirname, 'chrome-stub.js'), 'utf8');
    const sandbox = { localStorage: { _d: {}, getItem(k) { return this._d[k] || null; }, setItem(k, v) { this._d[k] = v; }, removeItem(k) { delete this._d[k]; } }, console };
    const people = {};
    for (const who of ['rahul', 'chloe', 'tom']) {
      const win = {}; sandbox.location = { search: `?person=${who}&me=ananya&demo=au`, reload() {} }; sandbox.window = win; sandbox.localStorage._d = {};
      new Function('window', 'localStorage', 'location', 'console', src)(win, sandbox.localStorage, sandbox.location, console);
      people[who] = await new Promise(r => win.chrome.runtime.sendMessage({ action: 'scrapeProfile' }, res => r(res.data)));
      if (who === 'rahul') people.me = JSON.parse(sandbox.localStorage._d.arkHarnessStore).arkProfile;
    }
    const w = SC.ahp(SC.DEFAULT_PAIRS).weights;
    const run = (who) => { const f = E.ruleFacts(people[who], people.me); return { f, r: SC.scoreFacts(f, w), hooks: SC.buildHooks(f, people.me, people[who]) }; };
    await test('Rahul (Monash alum, moved from India, BI Analyst at NAB) ranks first ≈ 82 with school + migrant hooks', async () => {
      const { f, r, hooks } = run('rahul');
      assert.ok(r.score >= 78 && r.score <= 88, 'score ' + r.score);
      assert.strictEqual(f.relationship, 'alumni');
      const types = hooks.map(h => h.type);
      assert.ok(types.includes('school') && types.includes('country'), types.join());
    });
    await test('Chloe (Monash classmate, 1st-degree) is a warm intro-ask, not a cold invite', async () => {
      const { f } = run('chloe');
      assert.strictEqual(f.relationship, 'classmate');
      const msg = W.warmDraft({ them: people.chloe, me: people.me, hook: run('chloe').hooks[0], facts: f });
      assert.ok(/works as a Data Analyst/.test(msg) && /Monash/.test(msg), msg);
    });
    await test('Tom (Sydney, 3rd-degree, nothing shared) scores lower and the invite never repeats the goal', async () => {
      const { r, hooks } = run('tom');
      assert.ok(r.score < run('rahul').r.score && r.replyChance === 'Low');
      const inv = W.inviteDraft({ them: people.tom, me: people.me, hook: hooks[0] });
      assert.strictEqual((inv.match(/Data Analyst/g) || []).length, 1, inv);
      assert.ok(inv.length <= 200);
    });
  }

  await test('Amrita alum now in Melbourne → same university AND "also moved from India" (job location lines count)', async () => {
    const kiranMe = { targetRole: 'AI Engineer', homeCountry: 'India', city: 'Coimbatore', university: 'AMRITA UNIVERSITY',
      education: [{ school: 'Amrita Vishwa Vidyapeetham', degree: 'B.Tech CSE (AI)', years: '2022 - 2026' }] };
    const alum = { name: 'Demo Alum', headline: 'Data Platform Engineer at Allianz Australia', currentTitle: 'Data Platform Engineer', currentCompany: 'Allianz Australia',
      location: 'Melbourne, Victoria, Australia', degree: '3rd', mutuals: 0,
      experienceItems: [['Data Platform Engineer', 'Allianz Australia · Full-time', 'Jan 2025 - Present', 'Melbourne, Victoria, Australia'],
        ['Data Engineer', 'Acme Analytics · Full-time', '2018 - 2022', 'Bengaluru, Karnataka, India · On-site']],
      educationItems: [['Amrita Vishwa Vidyapeetham', 'Bachelor of Technology - BTech, Computer Science', '2012 - 2016']],
      readStats: { experience: 2, education: 1, skills: 0, details: true } };
    const f = E.ruleFacts(alum, kiranMe), txt = f.evidence.map(e => e.text).join(' | ');
    assert.ok(/Same school/.test(txt) && /Also moved from India/.test(txt), txt);
    // Only the school (no Indian job lines) is enough too
    const f2 = E.ruleFacts(Object.assign({}, alum, { experienceItems: [alum.experienceItems[0]] }), kiranMe);
    assert.ok(f2.evidence.some(e => /Also moved from India/.test(e.text)));
    // …but someone still living in India is NOT a "moved" match
    const f3 = E.ruleFacts(Object.assign({}, alum, { location: 'Kochi, Kerala, India' }), kiranMe);
    assert.ok(!f3.evidence.some(e => /Also moved/.test(e.text)));
  });

  console.log('\nLinkedIn Nov 2026 layout (grouped jobs, no Skills section)');
  {
    const fs = require('fs');
    const src = fs.readFileSync(path.join(__dirname, '..', 'linkedin extention', 'content_script.js'), 'utf8');
    const grab = (a, b) => { const i = src.indexOf(a); return src.slice(i, src.indexOf(b, i)); };
    const code = grab('  const MON =', '  function sectionEntries') + grab('  const EMP_TYPE', '  function skillsFromJobs');
    const clean = (x) => (x || '').replace(/\s+/g, ' ').trim();
    const { experienceFromLines, educationFromLines } = new Function('clean', code + '; return { experienceFromLines, educationFromLines };')(clean);
    const lines = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'grouped-experience-lines.json'), 'utf8'));
    await test('grouped roles keep their employer (TCS / Cognizant), standalone jobs keep theirs (Allianz / NAB)', async () => {
      const rows = experienceFromLines(lines);
      assert.strictEqual(rows.length, 11);
      const jobs = E.parseLinkedInDetails({ experience: rows, education: [], skills: [] }).experience;
      assert.strictEqual(jobs.length, 8);   // identical repeated roles collapse
      assert.deepStrictEqual(jobs.map(j => j.company), ['Allianz Australia', 'Tata Consultancy Services', 'Tata Consultancy Services',
        'Tata Consultancy Services', 'NAB', 'Cognizant', 'Cognizant', 'Cognizant']);
      assert.ok(!jobs.some(j => /full-time|present/i.test(j.company)), 'employment type leaked into company');
      assert.ok(rows[4][3] === 'On-site' && rows[0][3].startsWith('Melbourne'));
    });
    await test('education without list items: school + degree + years, logo/name duplicates merged', async () => {
      const edu = educationFromLines(['Education', 'Amrita Vishwa Vidyapeetham', 'Amrita Vishwa Vidyapeetham', 'Bachelor of Technology, Mechanical Engineering', '2008 – 2012', 'GPA: 8.2', 'Amrita Vishwa Vidyapeetham', 'Bachelor of Technology - BTech', 'Show all 3 educations']);
      assert.deepStrictEqual(edu, [['Amrita Vishwa Vidyapeetham', 'Bachelor of Technology, Mechanical Engineering', '2008 – 2012'], ['Amrita Vishwa Vidyapeetham', 'Bachelor of Technology - BTech']]);
    });
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
