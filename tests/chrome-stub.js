// Fake chrome.* APIs for the UI harness. Storage persists in localStorage (survives reloads = "restart").
(function () {
  const KEY = 'arkHarnessStore';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } };
  const save = (d) => localStorage.setItem(KEY, JSON.stringify(d));
  const params = new URLSearchParams(location.search);
  const onProfile = params.get('page') !== 'feed';
  const PROFILE = {
    name: 'Priya Sharma', headline: 'Data Analyst at Telstra | SQL · Power BI', currentTitle: 'Data Analyst', currentCompany: 'Telstra',
    location: 'Melbourne, Victoria, Australia', about: 'Analyst turning messy data into decisions.',
    educationEntries: ['Swinburne University of Technology — Master of Data Science', 'University of Delhi — B.Com'],
    pastCompanies: ['Infosys'], experienceEntries: [], skills: ['SQL', 'Power BI', 'Python'],
    recentPosts: [{ text: 'Exciting times — our team is growing this year and we are hiring analysts in Melbourne!', stamp: '3d' }],
    profileUrl: 'https://www.linkedin.com/in/priya-sharma-demo', degree: '2nd', mutuals: 4, isConnected: false
  };
  if (params.get('person') === 'classmate') Object.assign(PROFILE, {
    name: 'Mhokesh Palanivel', headline: 'CSE(AI) Undergrad @AmritaUniversity', currentTitle: 'CSE(AI) Undergrad', currentCompany: '',
    location: 'Coimbatore, Tamil Nadu, India', educationEntries: [], pastCompanies: [], recentPosts: [], skills: [],
    profileUrl: 'https://www.linkedin.com/in/mhokesh-demo', degree: '1st', mutuals: 105, isConnected: true, isStudent: true,
    topSchool: 'Amrita Vishwa Vidyapeetham', sharedSchoolSignal: 'Amrita Vishwa Vidyapeetham', sharedCompanySignal: 'Netkathir Technologies Pvt Ltd'
  });
  if (params.get('person') === 'aaditya') Object.assign(PROFILE, {
    name: 'Aaditya Umashankar', headline: 'Software Engineer 3 at Zuora', currentTitle: 'Software Engineer 3', currentCompany: 'Zuora',
    location: 'Chennai, Tamil Nadu, India', educationEntries: [], pastCompanies: [], skills: [],
    profileUrl: 'https://www.linkedin.com/in/aaditya-demo', degree: '1st', mutuals: 5, isConnected: true,
    sharedCompanySignal: 'Latlon Technologies Pvt. Ltd.',
    experienceItems: [['Software Engineer 3', 'Zuora · Full-time', 'Aug 2024 - Present · 1 yr 4 mos'], ['Software Engineer 2', 'Freshworks · Full-time', 'Jul 2021 - Aug 2024']],
    educationItems: [['SSN College of Engineering', 'Bachelor of Engineering - BE, Computer Science and Engineering', '2017 - 2021']],
    skillItems: [['Java'], ['Python'], ['Machine Learning'], ['Distributed Systems'], ['SQL']],
    recentPosts: [{ text: 'From Strategy to Performance Delivery: our Chief Revenue Officer shares how we scaled revenue operations.', stamp: '1w', kind: 'repost' }]
  });
  if (params.get('person') === 'hari') Object.assign(PROFILE, {
    name: 'Hari vaarthan T.D', headline: 'AI & Cloud Developer | AWS Serverless | Python | LLMs | B.Tech AI @ Amrita | Open to Internships',
    currentTitle: 'Cloud intern', currentCompany: 'SkyLena Info Technology Pvt. Ltd', location: 'Greater Coimbatore Area',
    educationEntries: [], pastCompanies: [], skills: [], profileUrl: 'https://www.linkedin.com/in/hari-demo', degree: '1st', mutuals: 83, isConnected: true, isStudent: true,
    topSchool: 'Amrita Vishwa Vidyapeetham', sharedSchoolSignal: 'the same school',
    experienceItems: [['Cloud intern', 'SkyLena Info Technology Pvt. Ltd · Internship', 'Apr 2026 - May 2026 · 2 mos']],
    educationItems: [['Amrita Vishwa Vidyapeetham', 'B.Tech, Computer science with artificial intelligence', 'Aug 2023 – Aug 2027']],
    skillItems: [['Amazon Web Services (AWS)'], ['Python (Programming Language)'], ['Large Language Models (LLM)']],
    readStats: { experience: 1, education: 1, skills: 3, sectionsFound: ['Experience', 'Education', 'Skills', 'Activity'] },
    recentPosts: [{ text: 'Completed my AI Developer Internship — thanks to the team for the support!', stamp: '2w', kind: 'post' }]
  });
  // ── Australian demo cast (Loom): student Ananya Rao, Master of Data Science at Monash ──
  const AU = {
    rahul: { name: 'Rahul Menon', headline: 'Business Intelligence Analyst at NAB | SQL · Power BI · Python', currentTitle: 'Business Intelligence Analyst', currentCompany: 'NAB',
      location: 'Melbourne, Victoria, Australia', about: 'Helping NAB teams make decisions with clean data.', educationEntries: [], pastCompanies: [], skills: [],
      profileUrl: 'https://www.linkedin.com/in/rahul-menon-demo', degree: '2nd', mutuals: 3, isConnected: false,
      experienceItems: [['Business Intelligence Analyst', 'NAB · Full-time', 'Feb 2024 - Present · 1 yr 10 mos'], ['Graduate Data Analyst', 'NAB · Full-time', 'Feb 2023 - Feb 2024 · 1 yr'], ['Data Analyst', 'Tata Consultancy Services · Full-time', 'Jul 2017 - Jun 2021 · 4 yrs']],
      educationItems: [['Monash University', 'Master of Data Science', '2021 - 2022'], ['Anna University, Chennai', 'Bachelor of Engineering - BE, Computer Science', '2013 - 2017']],
      skillItems: [['SQL'], ['Power BI'], ['Python'], ['Data Visualization'], ['Stakeholder Management']],
      readStats: { experience: 3, education: 2, skills: 5, details: true, sectionsFound: ['Experience', 'Education', 'Skills', 'Activity'] },
      recentPosts: [{ text: 'Two years since I finished my Master of Data Science at Monash. Three SQL habits that helped me land my first data analyst role in Melbourne. Our analytics team is hiring two graduate analysts this summer.', stamp: '2w', kind: 'post' }] },
    chloe: { name: 'Chloe Bennett', headline: 'Master of Data Science student at Monash University | Data & Analytics', currentTitle: '', currentCompany: '',
      location: 'Melbourne, Victoria, Australia', about: '', educationEntries: [], pastCompanies: [], skills: [],
      profileUrl: 'https://www.linkedin.com/in/chloe-bennett-demo', degree: '1st', mutuals: 38, isConnected: true, isStudent: true, sharedSchoolSignal: 'Monash University',
      experienceItems: [['Data & Insights Intern', 'Australia Post · Internship', 'Nov 2025 - Feb 2026 · 4 mos']],
      educationItems: [['Monash University', 'Master of Data Science', '2025 - 2026'], ['University of Melbourne', 'Bachelor of Commerce', '2020 - 2022']],
      skillItems: [['Python'], ['SQL'], ['Tableau']], readStats: { experience: 1, education: 2, skills: 3, details: true, sectionsFound: ['Experience', 'Education', 'Skills'] },
      recentPosts: [] },
    tom: { name: 'Tom Harris', headline: 'Senior Data Analyst at Telstra', currentTitle: 'Senior Data Analyst', currentCompany: 'Telstra',
      location: 'Sydney, New South Wales, Australia', about: '', educationEntries: [], pastCompanies: [], skills: [],
      profileUrl: 'https://www.linkedin.com/in/tom-harris-demo', degree: '3rd', mutuals: 0, isConnected: false,
      experienceItems: [['Senior Data Analyst', 'Telstra · Full-time', 'Mar 2021 - Present · 4 yrs 9 mos'], ['Analyst', 'Deloitte · Full-time', 'Jan 2017 - Mar 2021']],
      educationItems: [['UNSW Sydney', 'Bachelor of Commerce, Finance', '2013 - 2016']],
      skillItems: [['Excel'], ['SAS'], ['Financial Modelling']], readStats: { experience: 2, education: 1, skills: 3, details: true, sectionsFound: ['Experience', 'Education', 'Skills'] },
      recentPosts: [] }
  };
  if (AU[params.get('person')]) { for (const k of Object.keys(PROFILE)) delete PROFILE[k]; Object.assign(PROFILE, AU[params.get('person')]); }
  if (params.get('me') === 'ananya' && !load().arkProfile) save(Object.assign(load(), { arkProfile: {
    name: 'Ananya Rao', targetRole: 'Data Analyst', city: 'Melbourne', homeCountry: 'India', university: 'Monash University',
    story: 'Moved from Bengaluru to Melbourne for my Master of Data Science at Monash.',
    education: [{ school: 'Monash University', degree: 'Master of Data Science', years: '2025 - 2026' }, { school: 'Christ University Bengaluru', degree: 'B.Sc Statistics', years: '2017 - 2020' }],
    experience: [{ title: 'Data Analyst', company: 'Infosys', years: '2021 - 2024' }], pastCompanies: 'Infosys',
    skills: ['SQL', 'Python', 'Power BI', 'Tableau', 'Excel'],
    projectName: 'Melbourne tram-delay dashboard', projectLink: 'https://github.com/ananya-demo/ptv-delays' } }));
  if (params.get('me') === 'kiran' && !load().arkProfile) save(Object.assign(load(), { arkProfile: {
    name: 'Kiran Kishore', targetRole: 'AI INTERN', city: 'Coimbatore', homeCountry: 'India', university: 'AMRITA UNIVERSITY',
    education: [{ school: 'AMRITA UNIVERSITY', degree: 'B.Tech CSE (AI)', years: '2023 - 2027' }],
    experience: [{ title: 'Machine Learning Intern', company: 'Netkathir Technologies Pvt Ltd', years: '2024 - 2025' }],
    pastCompanies: 'Netkathir Technologies Pvt Ltd', skills: ['Python', 'Machine Learning', 'LangChain', 'SQL'],
    projectName: 'an AI outreach coach', projectLink: 'https://github.com/kiran/ark-outreach' } }));
  const listeners = [];
  const IMPORT_DATA = {
    main: { name: 'Kiran Kishore V', headline: 'AI Engineer | LLMs', location: 'Coimbatore, Tamil Nadu, India', about: 'I build AI tools that help people get hired. Final-year CSE (AI) student.', educationEntries: ['Amrita Vishwa Vidyapeetham'], skills: [] },
    details: {
      experience: [['Machine Learning Intern', 'Netkathir Technologies Pvt Ltd · Internship', 'Jun 2024 - Jan 2025 · 8 mos']],
      education: [['Amrita Vishwa Vidyapeetham', 'Bachelor of Technology - BTech, CSE (AI)', '2022 - 2026'], ['Chinmaya Vidyalaya', 'Higher Secondary', '2008 - 2022']],
      skills: [['Python'], ['LangChain'], ['SQL']]
    }
  };
  if (params.get('demo') === 'au' || params.get('me') === 'ananya') {
    IMPORT_DATA.main = { name: 'Ananya Rao', headline: 'Data Analyst | SQL · Python · Power BI | Master of Data Science @ Monash', location: 'Melbourne, Victoria, Australia',
      about: 'Moved from Bengaluru to Melbourne for my Master of Data Science at Monash. Looking for my first data analyst role in Australia.', educationEntries: ['Monash University'], skills: [] };
    IMPORT_DATA.details = {
      experience: [['Data Analyst', 'Infosys · Full-time', 'Jul 2021 - Dec 2024 · 3 yrs 6 mos']],
      education: [['Monash University', 'Master of Data Science', '2025 - 2026'], ['Christ University Bengaluru', 'Bachelor of Science - BSc, Statistics', '2017 - 2020']],
      skills: [['SQL'], ['Python'], ['Power BI'], ['Tableau'], ['Excel']]
    };
  }
  window.chrome = {
    storage: {
      local: {
        get(keys, cb) { const d = load(), out = {}; (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in d) out[k] = d[k]; }); cb(out); },
        clear(cb) { save({}); cb && cb(); },
        set(obj, cb) {
          const d = load(); const changes = {};
          for (const [k, v] of Object.entries(obj)) changes[k] = { oldValue: d[k], newValue: JSON.parse(JSON.stringify(v)) };
          Object.assign(d, JSON.parse(JSON.stringify(obj))); save(d); cb && cb();
          listeners.forEach(fn => fn(changes, 'local'));
        }
      },
      onChanged: { addListener: fn => listeners.push(fn), removeListener: fn => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } }
    },
    tabs: {
      query: async () => [{ id: 1, url: onProfile ? PROFILE.profileUrl : 'https://www.linkedin.com/feed/' }],
      create: ({ url }) => console.log('[harness] would open', url)
    },
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        setTimeout(() => {
          if (msg.action === 'scrapeProfile') cb && cb({ success: true, data: JSON.parse(JSON.stringify(PROFILE)) });
          else if (msg.action === 'importMyLinkedIn') {
            const jobId = Date.now();
            cb && cb({ success: true, data: { jobId } });
            const setImp = (v) => window.chrome.storage.local.set({ arkImport: Object.assign({ jobId }, v) });
            setTimeout(() => setImp({ status: 'running', step: 'Reading your experience…' }), 150);
            setTimeout(() => setImp({ status: 'done', at: Date.now(), data: IMPORT_DATA }), 500);
          }
          else cb && cb({ ok: true });
        }, 250);
      }
    }
  };
  window.__arkResetHarness = () => { localStorage.removeItem(KEY); location.reload(); };
})();
