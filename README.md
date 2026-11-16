# Orbit Job Hunter

A local-first web app for discovering early-career technology roles, comparing them with your resume profile, ranking matches, and saving the shortlist to the existing Notion Application Pipeline.

## What it does

- Runs nine targeted public web searches for Hyderabad onsite/hybrid and India-wide remote fresher or entry-level technology roles.
- Searches company career pages and job sites such as HiringCafe, LinkedIn, Indeed, and Naukri through the Brave Search API.
- Filters senior roles and non-matching locations, estimates a 0–100 resume match, and sorts the shortlist.
- Keeps searches and ranked results in Orbit. You choose which jobs to save using the per-job checkboxes and **Add selected to Notion**; only selected jobs are written to the pipeline. Existing URLs are skipped.
- Can refresh job results daily at 9:00 AM Asia/Kolkata through 15 December 2026 while the local server remains running. Scheduled searches do not write to Notion.
- Never applies, messages recruiters, or claims an application was submitted.

## Start it

Install Node.js 20 or newer, then open a terminal in this folder and run:

```powershell
npm start
```

Open <http://127.0.0.1:4173>. The server binds to localhost and has no third-party npm dependencies.

## Connect search and Notion

Open **Setup** in the app:

1. Add a Brave Search API key. The server keeps it in `data/local-config.json`, which is excluded from Git and never sent to the browser.
2. To enable manual Notion saves, create a Notion internal integration, grant it read/insert content access, and share the existing **Application Pipeline** database with it.
3. Paste the integration token and your Notion data source ID, then use **Test Notion** before saving jobs.
4. Run a search. Review and select the jobs you want, then click **Add selected to Notion**. The daily switch schedules discovery only; it never saves jobs automatically.

The app uses the Notion API directly. Set your own Notion data source ID in Setup. The Notion connection already available to the assistant cannot be reused as an API token by a standalone local website.

## Ranking

Scores use the rubric already added to THE JOB HUNT HQ: skills/project fit 45%, experience eligibility 20%, location/work-mode fit 15%, and compensation fit 20%. Employer-confirmed ₹6 LPA+ receives full salary credit; third-party salary ranges are estimates; undisclosed salary receives partial credit only for a strong overall fit. Match scores are estimates based on search result descriptions, so always open the job listing and confirm its requirements before applying.

The app returns fewer than 10 when search results do not produce 10 qualifying roles. Search indexes cannot guarantee an exhaustive crawl of every career page. Some job sites may hide content behind login or restrict indexing; the app does not bypass those restrictions and labels the source for manual review.

## Local data and secrets

- Resume matching profile: create `data/profile.json` from `data/profile.example.json` and keep your personal profile local.
- Local API credentials and scheduler state are stored under `data/` and ignored by Git.
- Bind address is fixed to `127.0.0.1`. Do not expose this local server to the public internet without authentication and security hardening.
