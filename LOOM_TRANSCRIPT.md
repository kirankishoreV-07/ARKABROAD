# Loom transcript (timestamps match the built video)


## Introduction

**[00:00:00]** Hi Mihir, and the Ark Abroad team. I'm Kiran Kishore Venkatesan, from India. I'm in my fourth year of Computer Science and Engineering, specialising in Artificial Intelligence, at Amrita Vishwa Vidyapeetham, Coimbatore. I work mainly on agentic AI and computer vision: building LLM agents, retrieval systems and vision models that real people use. Thank you for shortlisting me, and for this opportunity.


## The idea

**[00:00:25]** Before writing any code, I studied Ark's method. Outreach is the third step of your program, and your guide is clear: quality over volume. The extension I was given did the opposite. It wrote the same generic message for everyone, its Deep Mode was fake, the uploaded resume was never used, and two contacts could overwrite each other. So my idea was simple. Keep the extension, but build Ark's thinking into it: who should I contact, what should I say, and what happens next.


## What was hard

**[00:00:54]** Building it was not smooth. First, LinkedIn loads profile sections late, so on real profiles the extension was reading zero jobs. Second, early versions made false matches, like a company someone never worked at, or 'also from India' for people who still live in India. Third, I tried letting several AI agents debate the score, but research shows debate doesn't improve accuracy, and AI judges are inconsistent. And LinkedIn allows only about three personal notes a month on free accounts, and bans automation. The architecture is how I solved each of these.


## Architecture

**[00:01:29]** Here's the architecture. It's a Manifest V3 Chrome extension in plain JavaScript, and by default all data stays on your device.

**[00:01:36]** The inputs are the LinkedIn page you have open, and your own profile, imported from LinkedIn or read from your resume on-device. The page reader scrolls the whole profile and waits for each late section to load. That fixed the zero-jobs problem.

**[00:01:49]** Next, the evidence notebook: every fact needs a source on both profiles, which stopped the false matches. Then comes the score, and it's calculated in code, not by AI.

**[00:02:00]** Here's how the score works. Every person gets zero to ten on four factors: role fit, shared ground, reachability, and timing. But which factor matters most? Instead of guessing, I used A H P, the Analytic Hierarchy Process. Ark's coach compares the factors two at a time, in six questions. For example: is role fit more important than shared ground, and by how much? Here, a bit more, two times. A H P takes the geometric mean of each row, and turns the answers into weights: role fit forty-seven percent, shared ground twenty-eight, reachability sixteen, and timing about ten. It also checks the consistency ratio, which catches contradictory answers. Ours is point zero one. Anything under point one is consistent.

**[00:02:49]** The score is simply weights times points. For the person in my demo: role fit four, times forty-seven percent. Shared ground seven, for the same school and moving from India, times twenty-eight percent. Reachability two, times sixteen. Timing zero. That adds up to four point one three, so forty-one out of a hundred. Every score can be traced like this, AI never sets it, and after eight real outcomes the weights start learning from your replies, while the coach keeps at least half the say.

**[00:03:21]** The writer drafts an invite note and an after-accept message. A verifier checks length, facts, tone and the ask, and failed AI drafts are retried, then replaced by a template.

**[00:03:31]** On the right is what you see: an explained score, editable drafts, and a tracker with reminders.

**[00:03:36]** AI is optional: Gemini Nano on-device, or Claude with your own key. It never sets the score, and nothing is sent automatically.


## Demo

**[00:03:46]** Now the live demo, on the profile of an Amrita graduate working in Melbourne.

**[00:03:50]** A short welcome, then I click Set up my profile.

**[00:03:53]** Instead of typing everything, I import my own LinkedIn. A background job reads my profile, education and skills, and reports progress, so the popup never freezes.

**[00:04:01]** Then I upload my resume. It's read on my computer, and the profile fills in.

**[00:04:05]** Everything is filled: role, city, education, experience and skills. It rewrites my experience as Australian-ready facts, and asks for real numbers instead of inventing them.

**[00:04:17]** These are the coach's six A H P questions, as sliders. With these answers, role fit weighs forty-seven percent, and the consistency ratio is point zero one. When I move a slider, the weights and the consistency check recalculate live.

**[00:04:29]** The AI engine is on Auto, with Gemini Nano ready on this computer. I save, and open Current.

**[00:04:35]** Now I click Analyse. Step one reads the whole page, waiting for LinkedIn's late sections to appear. Step two uses the on-device model to understand messy job titles. Then the score is calculated in code, two drafts are written, and step five checks every draft against the evidence, before I ever see it. All of this runs locally.

**[00:04:53]** The result: priority forty-one. Same university, medium reachability and career help, and the best move is to lead with our shared university and ask for advice.

**[00:05:02]** The breakdown is the same formula from earlier: four, seven, two and zero, weighted, give forty-one.

**[00:05:08]** Why this score shows each fact with its source: same school, shared skills, also moved from India, and all eight of his roles, even those grouped under TCS.

**[00:05:17]** Similar people uses LinkedIn's own search.

**[00:05:20]** I pick, you both studied at Amrita. The note is rewritten, under the limit, and every check passes.

**[00:05:26]** I copy it, send it myself on LinkedIn, and mark the invite as sent. The tool never sends anything on its own.

**[00:05:32]** The Tracker now shows Vyshakh at Invite sent, with stages up to referral, day four and day ten reminders, a reply assistant, a weekly coach report, and CSV export.


## Close

**[00:05:42]** So that's Ark Outreach Coach: who to contact, what to say, and what to do next. Honest scores, fact-checked messages, and a tracker that follows through. It's covered by fifty-five automated tests and works without any API key. Thank you again for the opportunity. I'd love to walk you through any part of it.
