'use strict';

// evidence.js — the "fact notebook".
// Every fact the extension knows gets a numbered entry (E1, E2 …) with its source.
// The writer may only use facts from here; the checker verifies against it.
// Also contains the rule-based "understanding" used when no AI engine is available.

(function (root) {

  // ── Text helpers ────────────────────────────────────────────────────────────
  function clean(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }
  function norm(s) {
    return clean(s).toLowerCase()
      .replace(/&/g, ' and ')
      .normalize('NFKD').replace(/\p{M}/gu, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function firstName(name) { return clean(name).split(' ')[0] || 'there'; }

  // ── Role families (for "same job" vs "similar job") ─────────────────────────
  const FAMILIES = {
    data_analysis: ['data analyst', 'business analyst', 'bi analyst', 'business intelligence', 'reporting analyst',
      'insights analyst', 'analytics', 'data analytics', 'bi developer', 'reporting', 'power bi', 'tableau developer'],
    data_science:  ['data scientist', 'machine learning', 'ml engineer', 'ai engineer', 'data science', 'applied scientist',
      'ai intern', 'ml intern', 'ai developer', 'ai ml', 'artificial intelligence', 'deep learning', 'nlp', 'llm', 'genai', 'generative ai', 'computer vision', 'ai research'],
    data_eng:      ['data engineer', 'analytics engineer', 'etl', 'data platform', 'big data'],
    software:      ['software engineer', 'software developer', 'developer', 'full stack', 'frontend', 'front end',
      'backend', 'back end', 'web developer', 'programmer', 'devops', 'sre', 'mobile developer'],
    product:       ['product manager', 'product owner', 'product analyst', 'product lead'],
    project:       ['project manager', 'project coordinator', 'program manager', 'scrum master', 'delivery manager'],
    marketing:     ['marketing', 'digital marketing', 'growth', 'seo', 'content', 'brand', 'social media'],
    finance:       ['accountant', 'financial analyst', 'finance', 'auditor', 'accounting', 'payroll', 'underwriting', 'credit analyst'],
    hr:            ['recruiter', 'talent acquisition', 'human resources', 'hr ', 'people partner'],
    design:        ['designer', 'ux', 'ui ', 'product design', 'graphic'],
    engineering:   ['mechanical engineer', 'civil engineer', 'electrical engineer', 'structural', 'site engineer', 'process engineer'],
    cyber:         ['security analyst', 'cyber', 'soc analyst', 'penetration', 'security engineer'],
    consulting:    ['consultant', 'advisory'],
    sales:         ['sales', 'account executive', 'business development', 'account manager'],
    support:       ['support analyst', 'service desk', 'it support', 'helpdesk', 'systems analyst', 'system analyst']
  };
  const NEIGHBOURS = {
    data_analysis: ['data_science', 'data_eng', 'product', 'finance'],
    data_science:  ['data_analysis', 'data_eng', 'software'],
    data_eng:      ['data_analysis', 'data_science', 'software'],
    software:      ['data_eng', 'cyber', 'support', 'data_science'],
    product:       ['project', 'data_analysis', 'design'],
    project:       ['product', 'consulting'],
    cyber:         ['software', 'support'],
    support:       ['software', 'cyber'],
    finance:       ['data_analysis', 'consulting']
  };

  function familyOf(title) {
    const t = ' ' + norm(title) + ' ';
    for (const [fam, words] of Object.entries(FAMILIES)) {
      if (words.some(w => t.includes(' ' + w.trim() + ' '))) return fam;
    }
    return null;
  }

  // exact | similar | area | none
  function roleMatch(theirTitle, targetRole) {
    const a = norm(theirTitle), b = norm(targetRole);
    if (!a || !b) return 'none';
    const stripSeniority = s => s.replace(/\b(senior|sr|junior|jr|graduate|lead|principal|associate|ii|iii|i|intern)\b/g, '').replace(/\s+/g, ' ').trim();
    const core = stripSeniority(b);
    // "exact" only for a real phrase on word boundaries ("data analyst" in "senior data analyst"), never a 2-letter substring
    if (core && (stripSeniority(a) === core || (core.split(' ').length >= 2 && new RegExp('(^| )' + core + '( |$)').test(a)))) return 'exact';
    const fa = familyOf(a), fb = familyOf(b);
    if (fa && fb && fa === fb) return 'similar';
    if (fa && fb && (NEIGHBOURS[fb] || []).includes(fa)) return 'area';
    return 'none';
  }

  // ── Schools ─────────────────────────────────────────────────────────────────
  function schoolKey(s) {
    return norm(s)
      .replace(/\b(the|of|university|uni|univ|college|institute|technology|tech|school|campus)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function sameSchool(theirEducation, mySchool) {
    if (!clean(mySchool)) return null;
    for (const e of theirEducation || []) {
      const name = typeof e === 'string' ? e.split(' — ')[0] : (e.school || e.name);
      if (schoolsMatch(name, mySchool)) return name;
    }
    return null;
  }

  // ── Countries (to spot a shared migrant path) ───────────────────────────────
  const COUNTRY_HINTS = {
    India: ['india', 'delhi', 'mumbai', 'bengaluru', 'bangalore', 'chennai', 'hyderabad', 'pune', 'kolkata', 'iit ', 'nit ', 'vit ', 'anna university', 'amity', 'manipal', 'bits pilani', 'jntu',
      'amrita', 'coimbatore', 'kochi', 'cochin', 'kerala', 'tamil nadu', 'karnataka', 'telangana', 'maharashtra', 'thiruvananthapuram',
      'trivandrum', 'kozhikode', 'calicut', 'mysuru', 'mysore', 'madurai', 'vellore', 'noida', 'gurugram', 'gurgaon', 'ahmedabad',
      'chandigarh', 'jaipur', 'srm ', 'psg ', 'christ university', 'osmania', 'visvesvaraya'],
    Pakistan: ['pakistan', 'lahore', 'karachi', 'islamabad'],
    Nepal: ['nepal', 'kathmandu', 'tribhuvan'],
    'Sri Lanka': ['sri lanka', 'colombo'],
    Bangladesh: ['bangladesh', 'dhaka'],
    China: ['china', 'beijing', 'shanghai', 'tsinghua', 'peking', 'shenzhen'],
    Philippines: ['philippines', 'manila', 'cebu'],
    Vietnam: ['vietnam', 'hanoi', 'ho chi minh'],
    Indonesia: ['indonesia', 'jakarta'],
    Malaysia: ['malaysia', 'kuala lumpur'],
    Nigeria: ['nigeria', 'lagos'],
    Kenya: ['kenya', 'nairobi'],
    Brazil: ['brazil', 'sao paulo', 'rio de janeiro'],
    Colombia: ['colombia', 'bogota'],
    Iran: ['iran', 'tehran'],
    'United Kingdom': ['united kingdom', 'london', 'manchester'],
    'United States': ['united states', 'new york', 'california'],
    Canada: ['canada', 'toronto', 'vancouver'],
    Australia: ['australia', 'melbourne', 'sydney', 'brisbane', 'perth', 'adelaide']
  };

  function countryHints(text) {
    const t = ' ' + norm(text) + ' ';
    const found = [];
    for (const [country, hints] of Object.entries(COUNTRY_HINTS)) {
      if (hints.some(h => t.includes(' ' + h))) found.push(country);
    }
    return found;
  }

  // ── Post recency ("3d", "1w", "2mo" style stamps) ───────────────────────────
  function daysFromStamp(stamp) {
    const m = String(stamp || '').match(/(\d+)\s*(m|min|h|hr|d|w|wk|mo|yr|y)\b/i);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit === 'm' || unit === 'min' || unit === 'h' || unit === 'hr') return 0;
    if (unit === 'd') return n;
    if (unit === 'w' || unit === 'wk') return n * 7;
    if (unit === 'mo') return n * 30;
    return n * 365;
  }

  const HIRING_WORDS = ['hiring', 'we are growing', "we're growing", 'team is growing', 'expanding', 'join our team',
    'join us', 'open role', 'open position', 'looking for', 'new role', 'growing team', 'squad is expanding', 'opportunity'];

  // ── Build the notebook ──────────────────────────────────────────────────────
  // them: scraped profile; me: saved profile; extra: [{text, source, url}] (web research)
  function buildNotebook(them, me, extra) {
    const book = [];
    const add = (who, field, text, url) => {
      text = clean(text);
      if (!text) return null;
      const id = 'E' + (book.length + 1);
      book.push({ id, who, field, text, url: url || null });
      return id;
    };
    them = them || {}; me = me || {};
    add('them', 'name', them.name);
    add('them', 'title', [them.currentTitle, them.currentCompany].filter(Boolean).join(' at ') || them.headline);
    add('them', 'headline', them.headline);
    add('them', 'location', them.location);
    (them.pastCompanies || []).forEach(c => add('them', 'past_company', c));
    if (them.topCompany) add('them', 'company', them.topCompany);
    if (them.sharedSchoolSignal) add('them', 'shared_school', 'You both studied at ' + (them.sharedSchoolSignal === 'the same school' ? 'the same school' : them.sharedSchoolSignal));
    if (them.sharedCompanySignal) add('them', 'shared_company', 'You both worked at ' + them.sharedCompanySignal);
    const T = theirProfile(them);
    T.experience.forEach(x => add('them', 'experience', [x.title, x.company].filter(Boolean).join(' at ') + (x.years ? ' (' + x.years + ')' : '')));
    T.education.forEach(x => add('them', 'education', [x.school, x.degree, x.years].filter(Boolean).join(' — ')));
    if (T.skills.length) add('them', 'skills', T.skills.join(', '));
    (them.recentPosts || []).filter(p => !(p && p.kind && p.kind !== 'post')).slice(0, 3).forEach(p => {
      const text = typeof p === 'string' ? p : p.text;
      const stamp = typeof p === 'string' ? '' : p.stamp;
      add('them', 'post', text + (stamp ? ' (' + stamp + ')' : ''));
    });
    if (them.degree) add('them', 'connection', them.degree + '-degree connection');
    if (them.mutuals != null) add('them', 'mutuals', them.mutuals + ' mutual connections');
    if (them.about) add('them', 'about', them.about.slice(0, 300));

    add('me', 'target_role', me.targetRole);
    add('me', 'university', me.university);
    (me.education || []).forEach(x => add('me', 'education', [x.school, x.degree, x.years].filter(Boolean).join(' — ')));
    (me.experience || []).forEach(x => add('me', 'experience', [x.title, x.company].filter(Boolean).join(' at ')));
    if ((me.skills || []).length) add('me', 'skills', me.skills.slice(0, 12).join(', '));
    add('me', 'home_country', me.homeCountry);
    add('me', 'city', me.city);
    String(me.pastCompanies || '').split(',').forEach(c => add('me', 'past_company', c));
    add('me', 'project', [me.projectName, me.projectResult].filter(Boolean).join(' — '), me.projectLink);
    add('me', 'story', me.story);
    (me.translatedFacts || []).forEach(f => add('me', 'translated', f));

    (extra || []).forEach(x => add('web', 'news', x.text, x.url));
    return book;
  }

  // ── Rule-based understanding (used when no AI engine, or to back up AI) ─────
  // ── School matching, layered (the approach used for institution names, e.g. ROR):
  //   1. alias dictionary → one canonical name per institution
  //   2. normalise: lower-case, split "AmritaUniversity", drop punctuation, generic words and city names
  //   3. distinctive-word Jaccard ≥ 0.5, or same leading distinctive word, or acronym ("SSN")
  const SCHOOL_ALIASES = {
    'amrita vishwa vidyapeetham': ['amrita university', 'amrita school of engineering', 'amrita school of computing', 'amrita institute', 'amrita'],
    'vellore institute of technology': ['vit', 'vit university', 'vit vellore', 'vit chennai'],
    'psg college of technology': ['psg tech', 'psg', 'psgct'],
    'srm institute of science and technology': ['srm', 'srm university', 'srmist'],
    'anna university': ['ceg', 'college of engineering guindy', 'anna univ'],
    'indian institute of technology madras': ['iit madras', 'iitm', 'iit m'],
    'indian institute of technology bombay': ['iit bombay', 'iitb'],
    'indian institute of technology delhi': ['iit delhi', 'iitd'],
    'national institute of technology tiruchirappalli': ['nit trichy', 'nitt', 'nit tiruchirappalli'],
    'birla institute of technology and science pilani': ['bits pilani', 'bits'],
    'ssn college of engineering': ['ssn', 'sri sivasubramaniya nadar college of engineering', 'ssnce'],
    'kumaraguru college of technology': ['kct', 'kumaraguru'],
    'pes university': ['pes', 'pesit'],
    'manipal institute of technology': ['mit manipal', 'manipal academy of higher education', 'mahe'],
    'swinburne university of technology': ['swinburne', 'swinburne university'],
    'royal melbourne institute of technology': ['rmit', 'rmit university'],
    'university of melbourne': ['unimelb', 'melbourne university', 'the university of melbourne'],
    'monash university': ['monash'],
    'university of new south wales': ['unsw', 'unsw sydney'],
    'university of technology sydney': ['uts'],
    'university of sydney': ['usyd', 'sydney university', 'the university of sydney'],
    'deakin university': ['deakin'],
    'la trobe university': ['latrobe', 'la trobe'],
    'queensland university of technology': ['qut'],
    'university of queensland': ['uq'],
    'macquarie university': ['macquarie', 'mq'],
    'australian national university': ['anu'],
    'university of adelaide': ['adelaide university'],
    'curtin university': ['curtin']
  };
  const ALIAS_LOOKUP = (() => {
    const m = new Map();
    for (const [canon, list] of Object.entries(SCHOOL_ALIASES)) { m.set(canon, canon); list.forEach(a => m.set(a, canon)); }
    return m;
  })();
  // ("arts" / "science" stay distinctive: PSG College of Technology ≠ PSG College of Arts and Science)
  function splitCamel(s) { return String(s || '').replace(/([a-z])([A-Z])/g, '$1 $2'); }
  function schoolCanon(name) {
    const n = norm(splitCamel(name)).replace(/\s+/g, ' ');
    if (ALIAS_LOOKUP.has(n)) return ALIAS_LOOKUP.get(n);
    const base = norm(splitCamel(String(name || '').split(/[,|]/)[0])).replace(/^the /, '');
    return ALIAS_LOOKUP.get(base) || n.replace(/^the /, '');
  }
  function schoolsMatch(a, b) {
    const left = schoolCanon(a), right = schoolCanon(b);
    return left && left === right ? 'alias' : null;
  }
  function headlineSchool(headline, school) {
    return clean(headline).split(/[|·;]/).some(part => {
      const affiliation = part.match(/(?:@|\bstudent at\s+|\bpursuing\b.*?\bat\s+)(.+)$/i)?.[1];
      return !!affiliation && schoolsMatch(affiliation, school) &&
        /\b(student|undergrad|undergraduate|pursuing|b\.?\s*tech|m\.?\s*tech|cse|bachelor|master|phd)\b/i.test(part);
    });
  }

  // ── Role domains: what field a title/headline is about (works for "AI & Cloud Developer | LLMs") ──
  const DOMAINS = {
    ai: ['ai', 'artificial intelligence', 'ml', 'machine learning', 'llm', 'llms', 'genai', 'generative ai', 'deep learning', 'nlp', 'computer vision', 'data science', 'data scientist', 'mlops', 'agentic', 'agents'],
    cloud: ['cloud', 'aws', 'azure', 'gcp', 'devops', 'serverless', 'kubernetes', 'sre', 'platform engineer', 'infrastructure'],
    data: ['data analyst', 'analytics', 'business intelligence', 'bi', 'power bi', 'tableau', 'data engineer', 'etl', 'sql developer', 'reporting'],
    software: ['software', 'developer', 'sde', 'full stack', 'fullstack', 'backend', 'back end', 'frontend', 'front end', 'web developer', 'mobile developer', 'programmer', 'software engineer'],
    security: ['security', 'cyber', 'cybersecurity', 'soc', 'penetration', 'infosec'],
    product: ['product manager', 'product owner', 'product analyst'],
    design: ['ux', 'ui designer', 'product designer', 'designer']
  };
  const DOMAIN_NEIGHBOURS = { ai: ['data', 'software', 'cloud'], cloud: ['software', 'ai', 'security'], data: ['ai', 'software'], software: ['cloud', 'ai', 'data', 'security'], security: ['cloud', 'software'], product: ['design', 'data'], design: ['product'] };
  function domainsOf(text) {
    const t = ' ' + norm(splitCamel(text)).replace(/\band\b/g, ' ') + ' ';
    return new Set(Object.entries(DOMAINS).filter(([, words]) => words.some(w => t.includes(' ' + w + ' '))).map(([d]) => d));
  }
  // exact | similar | area | none — the best of: job-family match on title, on headline, and domain overlap
  function roleFit(theirTitle, headline, target) {
    const order = { exact: 3, similar: 2, area: 1, none: 0 };
    // Job title is the strongest evidence; a headline match is capped at "similar" (headlines are loose).
    let best = roleMatch(theirTitle, target);
    const fromHead = roleMatch(headline, target);
    const capped = fromHead === 'exact' ? 'similar' : fromHead;
    if (order[capped] > order[best]) best = capped;
    const want = domainsOf(target), have = new Set([...domainsOf(theirTitle), ...domainsOf(headline)]);
    const shared = [...want].filter(d => have.has(d));
    // Field domains only decide when the job families had no opinion (keeps Data Engineer vs Data Analyst at "area").
    if (!clean(theirTitle) && shared.length) best = 'similar';
    if (best === 'none') {
      if (shared.length) best = 'similar';
      else if ([...want].some(d => (DOMAIN_NEIGHBOURS[d] || []).some(n => have.has(n)))) best = 'area';
    }
    return { fit: best, shared };
  }

  // ── Normalisers used for matching ──────────────────────────────────────────
  const LEGAL = /\b(pvt|private|ltd|limited|llp|llc|inc|incorporated|corp|corporation|co|company|plc|gmbh|pty|the|group|india|technologies|technology|tech|solutions|software|services|systems|labs|global|international)\b/g;
  // Core company name: "Latlon Technologies Pvt. Ltd." → "latlon". Compared for EQUALITY, never substring.
  function companyKey(name) {
    const k = norm(name).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
    return k.length >= 3 ? k : norm(name);
  }
  const STOP = new Set(['of', 'in', 'and', 'the', 'b', 'tech', 'btech', 'be', 'bsc', 'msc', 'mtech', 'ms', 'ma', 'ba', 'bachelor', 'bachelors', 'master', 'masters',
    'degree', 'technology', 'science', 'engineering', 'with', 'honours', 'honors', 'hons', 'specialization', 'specialisation', 'major', 'minor', 'program', 'programme', 'course']);
  // "Bachelor of Technology - BTech, Computer Science (AI)" → {computer, ai} (field words only)
  function fieldTokens(degree) {
    const d = norm(degree).replace(/\bcse\b/g, 'computer science').replace(/\bece\b/g, 'electronics communication')
      .replace(/\beee\b/g, 'electrical electronics').replace(/\bit\b/g, 'information technology').replace(/\bml\b/g, 'machine learning').replace(/\bai\b/g, 'ai')
      // keep well-known multi-word fields together so they read properly ("Computer Science", not "computer")
      .replace(/computer science/g, 'computer_science').replace(/data science/g, 'data_science').replace(/information technology/g, 'information_technology')
      .replace(/machine learning/g, 'machine_learning').replace(/artificial intelligence/g, 'ai').replace(/electronics communication/g, 'electronics_communication');
    return new Set(d.split(' ').filter(w => w.length > 1 && !STOP.has(w)));
  }
  function degreeLevel(degree) {
    const d = norm(degree);
    if (/\b(phd|ph d|doctorate|doctor of)\b/.test(d)) return 'doctorate';
    if (/\b(master|masters|m tech|mtech|msc|m sc|mba|m e|mca|ms)\b/.test(d)) return 'master';
    if (/\b(bachelor|bachelors|b tech|btech|b e|be|bsc|b sc|bca|bcom|b com)\b/.test(d)) return 'bachelor';
    if (/\bdiploma\b/.test(d)) return 'diploma';
    return null;
  }

  function yearRange(value) {
    const years = clean(value).match(/\b(?:19|20)\d{2}\b/g) || [];
    if (/\bpresent\b/i.test(value || '') && years.length) return [Number(years[0]), new Date().getFullYear()];
    return years.length >= 2 ? years.slice(0, 2).map(Number) : null;
  }

  function compareEducation(mine, theirs) {
    const pairs = [];
    for (const own of mine) {
      for (const other of theirs) {
        const a = fieldTokens(own.degree), b = fieldTokens(other.degree);
        const fields = [...a].filter(field => b.has(field));
        const school = !!schoolsMatch(own.school, other.school);
        const level = degreeLevel(own.degree);
        const program = school && !!level && level === degreeLevel(other.degree) &&
          fields.length > 0 && fields.length === a.size && fields.length === b.size;
        const ownYears = yearRange(own.years), otherYears = yearRange(other.years);
        const overlap = ownYears && otherYears ? Math.max(ownYears[0], otherYears[0]) <= Math.min(ownYears[1], otherYears[1]) : null;
        if (school || fields.length) pairs.push({ mine: own, theirs: other, school, fields, program, overlap });
      }
    }
    return pairs.sort((a, b) => rank(b) - rank(a));
    function rank(pair) { return (pair.school ? 8 : 0) + (pair.program ? 4 : 0) + (pair.overlap === true ? 2 : 0) + (pair.fields.length ? 1 : 0); }
  }

  const SKILL_ALIASES = { 'ml': 'machine learning', 'ai': 'artificial intelligence', 'js': 'javascript', 'ts': 'typescript', 'nodejs': 'node js',
    'node.js': 'node js', 'reactjs': 'react', 'react.js': 'react', 'llms': 'llm', 'large language models': 'llm', 'genai': 'generative ai', 'postgres': 'postgresql',
    'gcp': 'google cloud', 'aws': 'amazon web services', 'dsa': 'data structures and algorithms', 'oop': 'object oriented programming' };
  // "Python (Programming Language)" → "python"; "Amazon Web Services (AWS)" → "amazon web services"
  function skillKey(s) { const k = norm(String(s || '').replace(/\([^)]*\)/g, ' ')); return SKILL_ALIASES[k] || k; }

  // Seniority from a title: 0 student/intern · 1 junior · 2 mid · 3 senior · 4 lead/manager · 5 head/director+
  function seniority(title) {
    const t = norm(title);
    if (!t) return null;
    if (/\b(intern|student|undergrad|trainee|apprentice|fresher)\b/.test(t)) return 0;
    if (/\b(chief|vp|vice president|head|director|founder|cto|ceo|cfo|partner)\b/.test(t)) return 5;
    if (/\b(lead|manager|principal|staff|architect)\b/.test(t)) return 4;
    if (/\b(senior|sr|iii|3|iv|4)\b/.test(t)) return 3;
    if (/\b(junior|jr|associate|graduate|i|1)\b/.test(t)) return 1;
    return 2;
  }

  // Structured view of THEIR profile from the entry-by-entry scrape (falls back to older fields).
  function theirProfile(them) {
    const d = parseLinkedInDetails({ experience: them.experienceItems || [], education: them.educationItems || [], skills: them.skillItems || [] });
    const experience = d.experience.length ? d.experience
      : (them.experienceEntries || []).map(e => ({ title: e.title || '', company: e.company || '', years: e.duration || '' }));
    const education = d.education.length ? d.education
      : (them.educationEntries || []).map(x => ({ school: String(x).split(' — ')[0], degree: String(x).split(' — ')[1] || '', years: '' }));
    if (them.topSchool && !education.some(e => schoolsMatch(e.school, them.topSchool))) education.unshift({ school: them.topSchool, degree: '', years: '' });
    const companies = [them.currentCompany, them.topCompany].concat(experience.map(e => e.company), them.pastCompanies || []).filter(Boolean);
    const skills = d.skills.length ? d.skills : (them.skills || []);
    return { experience, education, companies, skills };
  }

  function myProfile(me) {
    const education = (me.education || []).filter(row => clean(row?.school));
    if (clean(me.university) && !education.some(row => schoolsMatch(row.school, me.university))) education.push({ school: me.university, degree: '', years: '' });
    const companies = [...new Set(String(me.pastCompanies || '').split(',').concat((me.experience || []).map(x => x.company)).map(clean).filter(Boolean))];
    return { education, companies, skills: me.skills || [] };
  }

  // ── Rule-based understanding: every "yes" must be backed by evidence on BOTH sides ──
  function ruleFacts(them, me) {
    them = them || {}; me = me || {};
    const T = theirProfile(them), M = myProfile(me);
    const theirTitle = T.experience.find(x => /\bpresent\b/i.test(x.years))?.title || them.currentTitle || '';
    const evidence = [];   // { c, text, source } — shown to the user as "why"

    // Role fit: job family on their title AND headline, plus domain overlap ("AI Intern" ↔ "AI & Cloud Developer")
    let role = 'unknown';
    if (clean(me.targetRole)) {
      const rf = roleFit(theirTitle, them.headline || '', me.targetRole);
      role = theirTitle || them.headline ? rf.fit : 'unknown';
      if (rf.shared.length && role !== 'none') evidence.push({ c: 'role', text: `Works in your target field (${rf.shared.map(d => d.toUpperCase() === 'AI' ? 'AI' : d).join(', ')})`, source: 'their title / headline' });
    }

    const educationMatches = compareEducation(M.education, T.education);
    const sharedSchool = educationMatches.find(pair => pair.school);
    const schoolSignal = clean(them.sharedSchoolSignal);
    const fromHeadline = M.education.find(own => headlineSchool(them.headline, own.school));
    const namedSignal = schoolSignal === 'the same school' ? '' : schoolSignal;
    const school = sharedSchool?.theirs.school || namedSignal || fromHeadline?.school || schoolSignal || null;
    const sameSchoolCourse = educationMatches.some(pair => pair.program);
    if (school) {
      const source = sharedSchool ? 'both education lists' : namedSignal || !fromHeadline ? "LinkedIn's shared-education signal" : 'their headline';
      evidence.push({ c: 'shared', text: school === 'the same school' ? 'Shared education (school unspecified)' : `Same school: ${school}`, source });
      if (schoolSignal && source !== "LinkedIn's shared-education signal") evidence.push({ c: 'shared', text: 'LinkedIn shows shared education', source: 'profile insights' });
    }
    if (sameSchoolCourse) evidence.push({ c: 'shared', text: 'Matching degree level and field at the same school', source: 'both education lists' });
    // Shared company — exact core-name match, never substring ("Netkathir" ≠ "Latlon")
    const myKeys = new Map(M.companies.map(c => [companyKey(c), c]));
    let sharedCompany = null;
    for (const c of T.companies) { if (myKeys.has(companyKey(c))) { sharedCompany = c; break; } }
    if (!sharedCompany && them.sharedCompanySignal) {
      const k = companyKey(them.sharedCompanySignal);
      if (T.companies.some(c => companyKey(c) === k) && (myKeys.has(k) || !M.companies.length)) sharedCompany = them.sharedCompanySignal;
    }
    if (sharedCompany) evidence.push({ c: 'shared', text: `Both worked at ${sharedCompany}`, source: 'both experience lists' });

    // Field of study
    const myFields = new Set(); M.education.forEach(e => fieldTokens(e.degree).forEach(w => myFields.add(w)));
    const theirFields = new Set(); T.education.forEach(e => fieldTokens(e.degree).forEach(w => theirFields.add(w)));
    const pretty = (w) => w === 'ai' ? 'AI' : w.split('_').map(x => x.charAt(0).toUpperCase() + x.slice(1)).join(' ');
    const commonField = [...myFields].filter(w => theirFields.has(w)).map(pretty);
    const sameField = commonField.length > 0;
    if (sameField) evidence.push({ c: 'shared', text: `Same field of study (${commonField.join(', ')})`, source: 'education' });

    // Skills overlap
    const mySkills = new Map(M.skills.map(s => [skillKey(s), s]));
    const commonSkills = [...new Set(T.skills.filter(s => mySkills.has(skillKey(s))).map(s => mySkills.get(skillKey(s))))];
    if (commonSkills.length) evidence.push({ c: 'shared', text: `Shared skills: ${commonSkills.slice(0, 5).join(', ')}`, source: 'skills' });
    // Strong skills overlap lifts role fit from "none" to "area" (they work with the same tools)
    if (role === 'none' && commonSkills.length >= 3) role = 'area';

    // Same country: only a shared MIGRANT path counts (they moved from my home country to somewhere else).
    const home = clean(me.homeCountry);
    // Origin = schools, companies AND the raw job/education lines (LinkedIn puts "Bengaluru, Karnataka, India · On-site" there)
    const rawLines = [].concat(them.experienceItems || [], them.educationItems || []).map(r => [].concat(r).join(' ')).join(' ');
    const theirOrigin = countryHints([T.education.map(e => e.school + ' ' + e.degree).join(' '), T.companies.join(' '), rawLines].join(' '));
    const theyLiveIn = countryHints(them.location || '');
    const livesAtHome = home && theyLiveIn.map(c => c.toLowerCase()).includes(home.toLowerCase());
    const sharedCountry = home && theyLiveIn.length > 0 && !livesAtHome && theirOrigin.map(c => c.toLowerCase()).includes(home.toLowerCase()) ? home : null;
    if (sharedCountry) evidence.push({ c: 'shared', text: `Also moved from ${sharedCountry}`, source: 'education / experience' });

    const sameCity = me.city && them.location && norm(them.location).includes(norm(me.city)) ? me.city : null;
    if (sameCity) evidence.push({ c: 'shared', text: `Same city (${sameCity})`, source: 'location' });

    // Posts — their own only
    let post = null;
    for (const p of them.recentPosts || []) {
      if (p && typeof p === 'object' && p.kind && p.kind !== 'post') continue;
      const text = typeof p === 'string' ? p : p.text;
      const days = typeof p === 'string' ? null : daysFromStamp(p.stamp);
      const t = norm(text);
      const hiring = HIRING_WORDS.some(w => t.includes(norm(w)));
      const relevant = hiring || (me.targetRole && familyOf(text) && familyOf(text) === familyOf(me.targetRole));
      if (!post || (relevant && !post.relevant)) post = { text, daysAgo: days, relevant: !!relevant, hiring };
    }

    const first = String(them.degree || '').startsWith('1');
    const senior = seniority(theirTitle || them.headline);
    const student = !!them.isStudent && (!theirTitle || senior === 0);
    let relationship = 'stranger';
    if (school && (educationMatches.some(pair => pair.program && pair.overlap === true) || (!them.readStats && !sharedSchool?.mine.years && !sharedSchool?.theirs.years && (them.isStudent || (first && senior === 0))))) relationship = 'classmate';
    else if (sharedCompany) relationship = 'ex_colleague';
    else if (school) relationship = 'alumni';
    else if (first) relationship = 'connection';
    else if (typeof them.mutuals === 'number' && them.mutuals > 0) relationship = 'friend_of_friend';

    if (clean(me.targetRole) && ['none', 'unknown'].includes(role)) {
      const past = T.experience.find(job => !/\bpresent\b/i.test(job.years) && ['exact', 'similar'].includes(roleMatch(job.title, me.targetRole)));
      if (past) {
        role = 'area';
        evidence.push({ c: 'role', text: `Prior relevant role: ${past.title}`, source: 'their experience' });
      }
    }
    const read = them.readStats;
    const sharedObserved = (M.education.length && T.education.length) || (M.companies.length && T.companies.length) || (M.skills.length && T.skills.length);
    return {
      observed: read ? {
        shared: !!(sharedObserved || evidence.some(e => e.c === 'shared')),
        reach: !!(them.degree || them.mutuals != null || them.isConnected),
        timing: !!(post || read.sectionsFound?.includes('Activity'))
      } : null,
      educationMatches, sameSchoolCourse,
      roleMatch: role, relationship, isStudent: student, seniority: senior,
      theirTitle: clean(theirTitle || them.headline), sameSchool: school, sharedCountry, sharedCompany, sameCity,
      sameField, commonField, commonSkills,
      degree: them.degree || null, mutuals: typeof them.mutuals === 'number' ? them.mutuals : null,
      post, companyNews: null, evidence, engine: 'rules'
    };
  }

  // Merge AI-understood facts over rule facts, but only where AI gave an answer.
  function mergeFacts(rule, ai) {
    if (!ai) return rule;
    const out = Object.assign({}, rule);
    // AI may summarize a post for drafting. Scores use only observed evidence.
    if (ai.postTopic && out.post) out.post = { ...out.post, topic: ai.postTopic };
    out.engine = ai.engine || 'ai';
    return out;
  }

  // ── Resume (rule-based fallback when no AI engine is available) ─────────────
  const AU_CITIES = ['Melbourne', 'Sydney', 'Brisbane', 'Perth', 'Adelaide', 'Canberra', 'Hobart', 'Darwin', 'Gold Coast', 'Newcastle', 'Geelong', 'Wollongong'];
  // Section-aware resume reader → structured profile (education / experience / skills / projects).
  const HEADINGS = {
    experience: /^(work\s+)?experience|^employment|^professional experience|^work history|^internships?$/i,
    education: /^education|^academic/i,
    projects: /^projects?|^portfolio|^personal projects/i,
    skills: /^(technical\s+)?skills|^tools|^tech stack|^core competencies/i,
    summary: /^summary|^profile|^about( me)?|^objective/i,
    other: /^certifications?|^awards|^achievements|^languages|^interests|^volunteer|^publications|^references/i
  };
  const YEARS = /((?:19|20)\d{2})\s*(?:[-–—to]+\s*(?:[A-Za-z]{3,9}\.?\s+)?((?:19|20)\d{2}|present|now|current))?/i;

  function splitEntry(line) {
    // "Title at Company, 2024 – 2025" | "Title — Company — 2024" | "Company | Title | 2023"
    const years = (line.match(YEARS) || [])[0] || '';
    let rest = line.replace(YEARS, '').replace(/[,·|–—-]\s*$/, '').trim().replace(/[,(]\s*$/, '').trim();
    let a = rest, b = '';
    const at = rest.match(/^(.+?)\s+(?:at|@)\s+(.+)$/i);
    if (at) { a = at[1]; b = at[2]; }
    else { const parts = rest.split(/\s+[—–|·]\s+|\s+-\s+|,\s+/).map(x => x.trim()).filter(Boolean); a = parts[0] || ''; b = parts.slice(1).join(', '); }
    return { a: clean(a).replace(/[,.]$/, ''), b: clean(b).replace(/[,.]$/, ''), years: clean(years) };
  }

  function parseResumeRules(text) {
    const raw = String(text || '');
    const lines = raw.split(/\r?\n/).map(clean).filter(Boolean);
    const out = { name: '', headline: '', targetRole: '', university: '', homeCountry: '', city: '', story: '',
      projectName: '', projectLink: '', projectResult: '', pastCompanies: [], translatedFacts: [], missingNumbers: [],
      education: [], experience: [], skills: [], projects: [] };

    const first = lines[0] || '';
    if (/^[A-Z][a-zA-Z.'’-]*(\s[A-Z][a-zA-Z.'’-]*){1,3}$/.test(first)) out.name = first;
    if (lines[1] && lines[1].length < 90 && !/@|\d{4}/.test(lines[1])) out.headline = lines[1];

    // Group lines under headings
    let sec = 'top';
    const groups = { top: [], experience: [], education: [], projects: [], skills: [], summary: [], other: [] };
    for (const l of lines) {
      const h = Object.entries(HEADINGS).find(([, re]) => re.test(l) && l.length < 40);
      if (h) { sec = h[0]; continue; }
      groups[sec].push(l);
    }

    // Experience: an entry line has a year range or "at"; following lines are its bullets
    for (const l of groups.experience) {
      if (YEARS.test(l) || /\s(at|@)\s/i.test(l)) {
        const e = splitEntry(l);
        out.experience.push({ title: e.a, company: e.b, years: e.years, bullets: [] });
      } else if (out.experience.length) out.experience[out.experience.length - 1].bullets.push(l.replace(/^[•\-*]\s*/, ''));
    }
    // Education
    for (const l of groups.education) {
      if (/\b(university|universit|college|institute|vidyapeetham|vidyapeeth|school|academy|iit|nit|iiit)\b/i.test(l)) {
        const e = splitEntry(l);
        const schoolFirst = /\b(university|universit|college|institute|vidyapeetham|vidyapeeth|school|academy|iit|nit|iiit)\b/i.test(e.a);
        out.education.push({ school: schoolFirst ? e.a : e.b, degree: schoolFirst ? e.b : e.a, years: e.years });
      }
    }
    if (!out.education.length) {
      const uniLine = lines.find(l => /\b(university|institute of technology|college|vidyapeetham)\b/i.test(l));
      if (uniLine) { const e = splitEntry(uniLine); out.education.push({ school: e.a, degree: e.b, years: e.years }); }
    }
    // Skills
    out.skills = groups.skills.join(', ').split(/[,;•|·]/).map(x => clean(x)).filter(x => x && x.length < 40).slice(0, 25);
    // Projects: first non-link line = name, a link line = link, a line with a number = result
    for (const l of groups.projects) {
      const link = l.match(/https?:\/\/\S+/);
      if (link) { if (out.projects.length) out.projects[out.projects.length - 1].link = link[0]; continue; }
      if (!out.projects.length || out.projects[out.projects.length - 1].link || /—|–|:/.test(l)) {
        const name = l.split(/\s+[—–:]\s+/)[0];
        out.projects.push({ name: clean(name), link: '', result: clean(l.split(/\s+[—–:]\s+/).slice(1).join(' ')) });
      }
    }
    const anyLink = raw.match(/https?:\/\/(?:www\.)?(?:github\.com|public\.tableau\.com|[\w-]+\.github\.io|kaggle\.com|behance\.net|huggingface\.co)[^\s)]*/i);
    if (anyLink && out.projects.length && !out.projects[0].link) out.projects[0].link = anyLink[0];

    // Flat fields the scorer and writer use
    out.university = out.education[0] ? out.education[0].school : '';
    out.pastCompanies = [...new Set(out.experience.map(e => e.company).filter(Boolean))].slice(0, 6);
    if (out.projects[0]) { out.projectName = out.projects[0].name; out.projectLink = out.projects[0].link; out.projectResult = out.projects[0].result; }
    else if (anyLink) out.projectLink = anyLink[0];
    out.city = AU_CITIES.find(c => new RegExp('\\b' + c + '\\b').test(raw)) || '';
    if (!out.city) { const loc = groups.top.find(l => /^[A-Z][a-z]+,\s*[A-Z]/.test(l)); if (loc) out.city = loc.split(',')[0].trim(); }
    const eduText = out.education.map(e => e.school + ' ' + e.degree).join(' ') + ' ' + groups.top.join(' ');
    out.homeCountry = countryHints(eduText).find(c => c !== 'Australia') || '';
    const roleSource = out.headline || '';
    if (familyOf(roleSource)) out.targetRole = roleSource.split(/[|•·,]/)[0].trim();
    else if (out.experience[0] && familyOf(out.experience[0].title)) out.targetRole = out.experience[0].title.replace(/\b(intern|internship|trainee)\b/ig, '').trim();
    if (groups.summary.length) out.story = groups.summary.join(' ').split(/(?<=[.!?])\s/)[0].slice(0, 200);
    // Numbers that already exist become ready-made "Australian-ready" facts
    for (const e of out.experience) for (const b of e.bullets) if (/\d/.test(b)) out.translatedFacts.push(`${b.replace(/\.$/, '')} (${e.title}${e.company ? ', ' + e.company : ''})`);
    return out;
  }

  // LinkedIn details pages (lists of text lines per entry) → structured entries.
  function parseLinkedInDetails(details) {
    const dateLine = /^(?:(?:[a-z]{3,9}\.?)\s+)?(?:19|20)\d{2}\b/i;
    const groups = /^(?:(?:full-time|part-time|internship|contract|freelance|self-employed)\s*[·•]\s*)?\d+\s*(?:years?|yrs?|months?|mos?)\b/i;
    const unique = (items, key) => {
      const seen = new Set();
      return items.filter(item => { const id = key(item); if (seen.has(id)) return false; seen.add(id); return true; });
    };
    const experience = (details.experience || []).flatMap(lines => {
      const [first, second = ''] = lines;
      if (!first || /^(experience|nothing to see)$/i.test(first)) return [];
      const dateIndexes = lines.map((line, i) => dateLine.test(line) ? i : -1).filter(i => i > 0);
      const grouped = groups.test(second) || dateIndexes.length > 1;
      if (grouped) return dateIndexes.map(i => {
        const previous = lines[i - 1];
        const title = /^(full-time|part-time|internship|contract|freelance|self-employed)$/i.test(previous) ? lines[i - 2] : previous;
        return { title: clean(title), company: clean(first), years: clean(lines[i]), bullets: [] };
      });
      return [{ title: clean(first), company: !dateLine.test(second) ? clean(second.split(/[·•]/)[0]) : '',
        years: clean(lines[dateIndexes[0]]), bullets: lines.slice(3).filter(x => x.length > 40).slice(0, 2) }];
    }).filter(x => x.title);
    const education = (details.education || []).map(lines => ({ school: clean(lines[0]),
      degree: lines.slice(1).filter(t => !dateLine.test(t) && !/^(grade|activities and societies|skills)\s*[:·]/i.test(t)).slice(0, 2).join(', '),
      years: clean(lines.find(date => dateLine.test(date))) })).filter(x => x.school && !/^education$/i.test(x.school));
    const skills = (details.skills || []).map(l => clean(l[0])).filter(x => x && x.length <= 120 && !/endorse|^(show|see) (?:all|more)|^skills$/i.test(x));
    return {
      experience: unique(experience, x => [norm(x.title), norm(x.company)].join('|')),
      education: unique(education, x => [schoolCanon(x.school), norm(x.degree), (x.years.match(/\b(?:19|20)\d{2}\b/g) || []).join('-')].join('|')),
      skills: unique(skills, skillKey)
    };
  }

  const api = { clean, norm, firstName, parseResumeRules, parseLinkedInDetails, companyKey, fieldTokens, seniority, theirProfile, schoolsMatch, schoolCanon, roleFit, domainsOf, familyOf, roleMatch, schoolKey, sameSchool, countryHints,
    daysFromStamp, buildNotebook, ruleFacts, mergeFacts, HIRING_WORDS };
  root.ArkEvidence = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
