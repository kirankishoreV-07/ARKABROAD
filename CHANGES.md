# What changed — Ark Outreach Coach v4.0 (from "LinkedIn Outreach AI" v3.1)

## Load it in Chrome
1. `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose the `linkedin extention` folder.
2. Open **My profile**: add target role, proof project (+ link), and optionally resume text and 2–3 of your own messages. Save.
3. Open any LinkedIn profile → click the extension → **Analyse this profile**.

## v4.0.2 profile loading
- Resolves the active profile across standard and custom main/header layouts. A page title or saved name can recover the identity when enough current profile evidence is available.
- Hides the previous score during a fresh scan and saves refreshed results for existing contacts.

## v4.0.1 shared education
- Recognizes the current profile's Sales Insights shared-education signal, plus school buttons and span-based headlines in the profile header.
- Waits for Experience, Education, and Skills independently. Activity no longer stops retries when another section is still missing.

## Profile analysis update
- The recipient scan reads the loaded summary and follows its own Experience, Education, and Skills detail links when offered. It merges those records with the summary and shows section availability in Why this score.
- Education now compares every pair, with separate results for institution, field, program, and overlap in study years. Institution names use explicit aliases or exact normalized names.
- Missing evidence is shown as unknown. Partial scores show their coverage, and AI cannot override the deterministic score.
- The full profile content available to Chrome varies with visibility, layout, and sign-in. Manual entry remains available when data cannot be read.

## New
- **Score weights learn from your real replies** (`lib/learning.js`):
  - Each contact keeps the four factor points it had when analysed. Outcome = **replied**, or **no reply after 14 days** / closed without a reply.
  - Model: logistic regression P(reply) = σ(b + Σ β·points/10), fitted on-device by MAP with a Gaussian prior centred on the coach's AHP weights — little data can't swing the score; your pattern takes over gradually (α = n / (n + 20), **capped at 50%** so the coach's judgement always counts).
  - Starts after 8 finished conversations with at least 2 replies and 2 non-replies; until then the popup shows how many more are needed.
  - Coach settings shows **Coach vs Your replies vs Used** weights, plain-language evidence ("Strong shared ground: 75% replied vs 20% when weak") and an on/off switch. Tracker shows a learning strip, the weekly coach report adds a learning line, and scores show a "Tuned by your replies" badge.
- **Premium warm-beige interface**: paper-beige surfaces, espresso-ink primary buttons, one accent (Ark Abroad blue) for data and selection, Anton display numbers + Inter text (type and accent taken from arkabroad.com):
  - First-run **welcome screen** with logo, headline and 3-step onboarding ("Set up my profile" / "Skip for now").
  - Header with logo and a live AI-engine status dot; tabs as a segmented control with a sliding indicator and icons.
  - Current tab ordered by what you do next: hero card with an **animated score ring** → insight tiles and Best move → selectable hook cards → message composer (draft tabs, check chips, action bar) → score breakdown and evidence → similar people.
  - Tracker: large KPI numbers, chip filters, cascading contact cards. My profile: strength meter with big percentage, one-click LinkedIn / resume buttons, labelled fields, collapsible Coach settings and AI engine, sticky Save.
  - Motion with purpose (staggered reveals, spring tab indicator, hover/press feedback), visible focus rings, and reduced-motion support. Presentation lives in `ui.js`; app logic in `popup.js` is untouched.
- **Match score (0–100)** with four explained factors — Role fit, Shared ground, Reachability, Timing.
  Weights come from **AHP** (6 coach questions, geometric mean, consistency ratio shown). Default: 46.7 / 27.8 / 16.0 / 9.5, CR 0.011.
- **Top 3 hooks** with evidence; switching the hook changes only the opening line and keeps your edits.
- **Two saved drafts per person**: invite note (≤200 chars, 300 with Premium) and **"After they accept"** (shares your proof project, asks one specific question).
- **Checker** on every draft: length, no generic opener, no AI-sounding phrases, asks for a chat not a job, every name exists in the fact notebook, no placeholders. AI drafts that fail are sent back with the exact errors (max 2 retries), then fall back to a template.
- **AI engines**: on-device Gemini Nano (Chrome Prompt API — free, private), Claude with your own key (Haiku 5.5 reads, Opus 5.5 writes), or templates. Works with no key.
- **Deep Mode is real**: Claude web search for company news (max 3 searches), shown with source links.
- **Sounds like you**: drafts copy your greeting, contractions and punctuation from your own messages.
- **Same college + same course now counts properly** (found in real testing: a classmate on the same course scored 0/10 shared ground):
  - School names are matched in layers, the way institution registries such as ROR do it: an alias list (Amrita University = Amrita Vishwa Vidyapeetham = "@AmritaUniversity", RMIT = Royal Melbourne Institute of Technology, SSN, VIT, PSG…), then distinctive words with generic words and city names removed, then acronyms. Look-alikes stay apart (PSG Tech ≠ PSG Arts & Science).
  - Four independent sources for a shared school: both education lists, LinkedIn's own "Shared education" signal (LinkedIn computed it from both profiles), the school in their top card, and their headline ("B.Tech AI @ Amrita").
  - Same college AND same course earns a bonus; field-of-study matching understands "CSE", "Computer science with artificial intelligence", "(AI)".
  - Role fit reads both the job title and the headline, plus field domains (AI, cloud, data, software…): "AI Intern" vs "AI & Cloud Developer" = similar. Fixed a bug where a 2-letter target like "AI" could count as an exact match by substring.
  - Students are scored honestly: same-field peer = 4/10 role fit, career help Low, best move = ask for an intro.
  - "Why this score" shows the side-by-side comparison (your schools / target / skills vs theirs).
- **Reads the whole profile, not just what is on screen** (found in real testing: Experience showed "not visible" although it was on the page):
  - LinkedIn builds the lower sections only when you scroll near them; the extension now scrolls the whole page step by step until it stops growing, waits for the sections, reads them, then returns you to where you were.
  - Sections are found by anchor, heading or plain text, so a layout change on LinkedIn does not break it.
  - Entries are split by list items, or — when LinkedIn uses plain blocks — by the date lines ("Apr 2026 - May 2026"): the lines just above a date are the title and company / school and degree.
  - "Why this score" now shows what was read ("1 job · 2 schools · 3 skills") and flags sections that were not found, and asks you to re-analyse contacts saved with an older version.
- **Evidence-checked matching** (found in real testing: a false "both worked at Latlon", "also from India" for someone living in India, and a repost read as their own post):
  - Reads each profile section entry by entry (one job / school / post per entry), so titles and companies stay paired.
  - Only the profile's main column is read — the right rail and messaging overlay describe *other* people.
  - Shared school/company must appear on **both** profiles, matched on the core name ("Latlon Technologies" ≠ "Netkathir Technologies"); AI may not add shared history.
  - "Shared migrant path" only when they moved away from your home country, not when they still live there.
  - Only their own posts count (reposts, comments and likes are ignored).
  - New comparisons: field of study, shared skills (lifts role fit when you use the same tools), seniority (senior people = more career help).
  - "Why this score" panel lists every matched fact with its source, plus their experience, education and skills as read.
  - Senior connections get an advice-first message based on their real career path; the AI prompt is pinned to their real current role.
- **Profile in seconds, in a proper structure**:
  - **Import from my LinkedIn** (one click): opens your own profile and its Experience / Education / Skills pages in a background tab, reads them, closes the tab.
  - **Upload resume (PDF or DOCX)** read on your computer — no AI or key needed; a Claude key is only used for scanned PDFs without selectable text.
  - Structured profile: education list (all schools, so school friends count too), experience list, skills, proof project, Australian-ready facts with real numbers.
  - **Profile strength** meter that shows what each piece unlocks (target role → role fit, education → classmates & alumni, experience → ex-colleagues…).
  - New information only fills empty fields and adds new entries — it never overwrites what you typed.
- **Automatic resume parsing**: paste resume text (or upload a PDF with a Claude key) at the top of My profile — it is read straight away and fills name, target role, university, home country, city, past companies, story and best project, then saves. Auto-read never overwrites what you typed; "Re-read resume" does. No AI available → basic rules still fill the main fields.
- **Overseas experience translator**: resume → Australian-ready facts (company size instead of unknown names, outcomes instead of duties; never invents numbers — asks instead).
- **Tracker**: unique contact IDs, stages (Invite sent → Connected → Replied → Call → Referral), day-4 / day-10 follow-up reminders (toolbar badge), reply assistant, coffee-chat prep card, weekly coach report, CSV export.
- **Knows who the person is to you** (found in real testing: a classmate with 105 mutuals scored 13):
  - Reads LinkedIn's own signals — "You both studied at…", "Shared education", "Past colleague from…" — plus the school in the top card, so shared ground is found even before you fill My profile.
  - Missing info is **left out** of the score (weights re-scaled) instead of counting as 0.
  - Already connected = strongest tie = 10/10 reachability. Students get a fair role score (they can introduce you to their network).
  - New plain-language panel: **Who** (classmate / ex-colleague / alumni / new contact), **Reply chance**, **Career help**, **Best move**.
  - Classmates and existing connections get a warm direct message asking for an intro, not "thanks for connecting"; the invite tab is marked "not needed".
  - Open your own LinkedIn profile and the extension offers to import it into My profile.
- **Manual entry fallback** when a page can't be read; **Find similar people** opens LinkedIn's own search (nothing is collected automatically).

## Bugs fixed from the original
| Where | Problem | Fix |
|---|---|---|
| popup.html / background.js | Deep Mode showed "OpenAI — Profile Parser / Web Enrichment" but only ran a template after a 300 ms delay | Removed the fake pipeline; real AI steps with honest labels |
| popup.js | Uploaded resume stored but never used | Resume is read and translated into facts used in drafts |
| utils/cache.js:20, background.js:41 | Contacts matched by profile URL — two contacts without a URL overwrote each other | Every contact has its own id; empty URLs never match |
| popup.js:496 | Recent tab showed "Copied!" even when the clipboard write failed | "Copied" only after the clipboard confirms; otherwise text is selected for manual copy |
| content_script.js:122 | Experience parser hard-coded Indian city names | Generic location detection (any city/country, remote/hybrid) |
| content_script.js | Scrolled the user's page and left them at the top | Restores the user's scroll position |
| background.js | Free-mode Regenerate returned identical text | Regenerate cycles real variants |
| popup | Notes over LinkedIn's limit could be produced | Hard 200/300 limit on invites, live counter |

## Not built (on purpose)
- Auto-sending (Playwright or otherwise): LinkedIn restricts accounts for automated activity; it also goes against Ark's quality-first outreach.
- Debating agents / AI-generated scores: research shows no accuracy gain over simpler designs, and AI judges are inconsistent — scores are computed in code.

## Tests
- `node tests/run-tests.js` — 38 tests (incl. real PDF/DOCX resumes, LinkedIn import parsing, and the real classmate, Aaditya and Hari cases) — plus tests/fixtures/linkedin-like.html, a LinkedIn-style page whose sections only appear after scrolling: AHP weights + consistency, role matching, scoring, hooks, every draft passing the checker, hook switch keeping edits, voice, reply classification, legacy migration, two empty-URL contacts surviving a restart, reminders, report, CSV.
- `node tests/build-harness.js`, then serve the project folder and open `tests/harness.html` to click through the real popup with a fake `chrome` object.
- Still to do in real Chrome before recording: live LinkedIn profiles (page reading), on-device model on a supported machine, real Claude key.

## 21 Nov — LinkedIn Nov 2026 layout fix (found on a real Amrita alum's profile)
- **Lazy sections:** Experience/Education are empty `<section>` shells until they stay on screen ~0.6 s. The reader now parks on each empty shell (≤1.6 s, gives up on ad slots) — before, the fast scroll skipped past them and read 0 jobs.
- **Grouped jobs:** "Company / 8 yrs 1 mo" headers with roles below (Title / Full-time / dates) — roles now keep the employer (TCS, Cognizant) instead of "Full-time". First job outside any list is no longer dropped.
- **Skills without a Skills section:** read from "Databricks, PySpark and +11 skills" lines under each job.
- **Education without list items:** school + degree + years per entry; logo/name duplicate links merged.
- **Moved-from-India detection:** Amrita and South-Indian cities added; job location lines now count.
- Tests: `tests/fixtures/linkedin-2026.html` (browser) + 2 parser tests; 55 passing.
