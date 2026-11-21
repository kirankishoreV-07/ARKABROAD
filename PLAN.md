# Ark Outreach Coach — Final Build Plan

Assignment: improve Ark Abroad's LinkedIn outreach Chrome extension (not a rebuild) and record a Loom.
Deadline: **22 Nov 2026, 5:00 PM IST** (target: send by 12:00 PM IST).
Send to: mihir@arkabroad.xyz, CC hello@arkabroad.xyz and pm@arkabroad.xyz.

## Product idea in one line
Ark's outreach method, built into the tool: **who to contact** (AHP-weighted score), **what to say**
(fact-checked message in the student's own voice) and **what happens next** (tracker, replies, coach report).
Free, private AI on the student's own computer; Claude as the premium layer.

## Tabs
1. **CURRENT** (on a LinkedIn profile)
   - Match score 0–100 with breakdown: Role fit · Shared ground · Reachability · Timing
   - Top 3 hooks with evidence → user picks one
   - **Two-message flow ("After they accept") — the hero flow:**
     - Draft 1 *Invite note* (≤200 chars; warns ~3 personalised notes/month on free accounts; "send without note" option)
     - Draft 2 *After they accept* — uses the student's proof project to ask a specific question
       (e.g. "If you were reviewing this dashboard for a junior analyst role, what's one thing you'd look for?")
     - Both drafts saved under the contact; reopening the contact shows the next draft ready
   - Switching the hook changes only the opening line — the user's own edits are kept
   - Message + checker results + **Copy** (shows "Copied" only if the clipboard confirms) + **Mark invite sent** (separate button) + "Open in LinkedIn"
   - **Manual entry fallback**: if the page can't be read, the user types one detail about the person (one detail is enough; a second unlocks hook switching)
   - Deep Mode toggle: real company news via Claude web search
   - Find similar people: opens LinkedIn's own search, pre-filled (no scraping)
2. **TRACKER**
   - Stages: Invite sent → Connected → Replied → Call → Referral; reminders on day 4 and day 10
   - Marking a contact **Connected** opens their saved "After they accept" draft
   - Every contact has its **own unique ID** (not matched by profile link) and stores: chosen hook, project used, both drafts (with the user's edits), stage, dates
   - Keeps all contacts (not just the last 5); old Recent entries are migrated and still open
   - Weekly goal 15–20, reply rate, reply rate by hook type
   - **Reply assistant** (feature 4): paste a reply → type (interested / busy / no / referral offer) → next message drafted, stage updated
   - **Coffee-chat prep card** (feature 4): 5 questions from their profile + the student's 30-second intro
   - **Weekly coach report** (feature 5): one-click summary to copy to the Ark coach
   - CSV export
3. **MY PROFILE**
   - Target role, proof project link, one-line story, resume
   - **Overseas experience translator** (feature 3): resume facts rewritten the way Ark's guide teaches (company size instead of unknown names, results instead of duties; never invents numbers)
   - **"Sounds like you"** (feature 2): 2–3 messages the student wrote, used as a style sample
   - **Coach settings (AHP)**: 6 pairwise questions → weights + consistency ratio
   - AI engine: On-device (free) / Claude (API key) / Templates (fallback)

## The 7-step flow
1. COLLECT (code) — read profile + saved profile → numbered fact notebook
2. UNDERSTAND (AI) — messy text → yes/no facts ("BI Analyst ≈ Data Analyst")
   RESEARCH (AI agent, Deep Mode only) — Claude built-in web search, max 3 searches
3. SCORE (code) — factor points × AHP weights → 0–100
4. YOU PICK (user) — choose 1 of the top 3 hooks
5. WRITE (AI) — uses only notebook facts, in the student's voice
6. CHECK (code) — length, every fact exists in the notebook, asks for a chat (not a job), no generic opener, no AI-sounding phrases → rewrite (max 2 tries)
7. TRACK (code) — save, remind, reply rates, coach report

## AI engines (feature 1)
| Tier | Engine | Used for |
|---|---|---|
| Free | Chrome built-in AI (Gemini Nano, Prompt API — stable for extensions since Chrome 138) | Understand, write, reply assistant |
| Pro | Claude — Haiku 5.5 (understanding), Opus 5.5 (writing, web research) | Best quality + Deep Mode |
| Fallback | Templates + keyword rules | Devices that can't run the on-device model |
Always feature-detect; the checker runs on every engine's output.

## Scoring
Score = 10 × Σ (weight × factor points). Factors 0–10 each:
- **Role fit**: exact target title 10 · similar 7 · same area 4 · unrelated 0
- **Shared ground** (cap 10): same uni +4 · home country / migrant path +3 · same past company +3 · same city +1
- **Reachability**: 2nd-degree with 1–15 mutuals 10 · connected 8 · 2nd-degree no mutuals 5 · 3rd+ 2 · posted in last 30 days +1
- **Timing**: relevant post ≤7 days 10 · company hiring/news 8 · post ≤30 days 6 · none 0

Weights from **AHP** (geometric mean, consistency ratio must be < 0.10). Default answers give
Role 46.7% · Shared 27.8% · Reach 16.0% · Timing 9.5% (geometric mean; CR 0.012). AHP sets weights only — never ranks people.
Later: small adjustments from real reply data, starting from the AHP weights.

## Storage
- `chrome.storage.local` — source of truth (profile, AHP weights, tracker)
- CSV export (must)
- Google Sheets sync — optional, only if time remains
- No Cognee / GitNexus in the product

## Files
| File | Change |
|---|---|
| content_script.js | Fix profile reading (remove Indian-city hack and visible scrolling); add connection status + mutual count |
| background.js | Replace fake Deep Mode; AI engine router (on-device / Claude / templates); fix Regenerate |
| popup.html/css/js | Current, Tracker, My Profile tabs |
| utils/cache.js | Becomes tracker storage |
| lib/evidence.js (new) | Fact notebook |
| lib/scoring.js (new) | Factor rules + AHP |
| lib/verifier.js (new) | Message checker incl. AI-phrase list |
| lib/ai.js (new) | Engine router + prompts |

## Build order (cut line = stop here if time runs out; each step is demo-able)
| # | Step | Priority |
|---|---|---|
| 1 | Fix profile reading + My Profile tab (incl. voice samples) | Must |
| 2 | Fact notebook + scoring + AHP defaults | Must |
| 3 | AI engine router: on-device + Claude + templates | Must |
| 4 | Resume reading + overseas translator | Must |
| 5 | Top 3 hooks + writer: invite note + "After they accept" draft; hook switch keeps edits; manual-entry fallback | Must |
| 6 | Checker (facts, length, ask, AI phrases) + rewrite loop | Must |
| 7 | Tracker: unique contact IDs + both drafts saved + migration of old entries; separate Copy / Mark invite sent; honest copy status; reminders + CSV export | Must |
| — | **Cut line 1 (minimum complete demo)** | |
| 8 | Weekly coach report | Should |
| 9 | Coach settings screen (AHP questions) | Should |
| 10 | Deep Mode web research | Should |
| 11 | Reply assistant + coffee-chat prep | Should |
| — | **Cut line 2** | |
| 12 | Reply-rate weight adjustment ✅ built (lib/learning.js) · Google Sheets sync (not built) | Nice |
| 13 | Test on real profiles, polish, record Loom | Must (always reserve time) |

Timing: 1–4 by 20 Nov · 5–9 on 21 Nov · 10–11 + Loom on 22 Nov morning.

## Must-pass tests before recording
- [ ] Two contacts (Priya and Maya) both survive a browser restart, including one added by manual entry
- [ ] Switching the hook keeps the rest of the user's edited draft
- [ ] Copy pastes the exact edited text; a failed copy does not show "Copied"
- [ ] "Mark invite sent" and "Connected" update the stage; reopening a contact shows the right next draft
- [ ] Invite draft never exceeds 200 characters; the 200 limit applies to the invite only
- [ ] Old Recent entries from the original extension still open after the upgrade
- [ ] Works with no API key (on-device AI or templates)

## Bugs found in the original code (fix + mention in Loom)
- utils/cache.js:20 and background.js:41 — contacts matched by profile link, so two entries without a link overwrite each other
- popup.js:496 — Recent tab shows "Copied!" even when the clipboard write fails
- Deep Mode shows fake "OpenAI" layers; uploaded resume is never used; Regenerate returns the same text in free mode; content_script.js:122 hardcodes Indian city names

## Not building (and why)
- Auto-send / Playwright — LinkedIn restricts accounts for automation; against Ark's quality-first method
- Debating agents / AI-made scores — research shows no accuracy gain; AI judges are inconsistent
- Search MCP — built-in web search is enough; an MCP adds a second account per student
- Visa checks — Ark gives no migration advice
- Recipient-simulation, bulk referral finding

## Loom outline (~6–7 min)
1. I researched Ark first: this extension is part 3 of your program (outreach)
2. Audit: fake Deep Mode, unused resume, generic messages, ignored LinkedIn limits
3. Live demo: score + hooks → invite note in my voice → checker → Copy + Mark invite sent → **close the popup, reopen Priya, mark Connected → "After they accept" draft with my project is ready** → coach report → free on-device mode
4. How it's built: facts → AHP score → write → verify; why no debating agents / auto-send (with sources)
5. Next steps: Google Sheets sync for coaches, weights learned from real replies

## Key sources
- Ark guide: https://www.arkabroad.com/first-professional-job-australia
- LinkedIn limits: https://www.linkedin.com/help/linkedin/answer/a563153 · automation policy: https://www.linkedin.com/help/linkedin/answer/a1341387
- Weak ties (Science 2022): https://doi.org/10.1126/science.abl4476 · Similarity effect: https://doi.org/10.1177/0146167203258838
- Multi-agent debate limits: https://arxiv.org/abs/2502.08788 · https://arxiv.org/abs/2611.17610
- LLM judge reliability: https://arxiv.org/abs/2606.13685 · Self-correction needs external feedback: https://arxiv.org/abs/2310.01798 · https://arxiv.org/abs/2305.11738
- AHP rank reversal / geometric mean: https://arxiv.org/abs/2512.11622
- AI-written message perception: https://arxiv.org/abs/2501.15678 · https://doi.org/10.3390/bs16071221
- Chrome Prompt API: https://developer.chrome.com/docs/ai/prompt-api
- Anthropic, Building effective agents: https://www.anthropic.com/research/building-effective-agents
