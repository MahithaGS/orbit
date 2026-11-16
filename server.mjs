import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const CONFIG_FILE = path.join(DATA, 'local-config.json');
const STATE_FILE = path.join(DATA, 'state.json');
const PROFILE_FILE = path.join(DATA, 'profile.json');
const PORT = Number(process.env.PORT || 4173);
const HOST = '127.0.0.1';
const NOTION_VERSION = '2026-03-11';
const DEFAULT_DATA_SOURCE_ID = '';
const TZ = 'Asia/Kolkata';

await mkdir(DATA, { recursive: true });
await loadDotEnv();

let localConfig = await readJson(CONFIG_FILE, {});
let profile = await readJson(PROFILE_FILE, {});
let state = await readJson(STATE_FILE, {
  schedulerEnabled: false,
  lastRunDate: null,
  lastRunAt: null,
  lastRunCount: 0,
  lastSavedCount: 0,
  lastError: null,
  lastJobs: []
});
let running = false;

function config() {
  return {
    braveApiKey: process.env.BRAVE_API_KEY || localConfig.braveApiKey || '',
    notionToken: process.env.NOTION_API_KEY || localConfig.notionToken || '',
    notionDataSourceId: process.env.NOTION_DATA_SOURCE_ID || localConfig.notionDataSourceId || DEFAULT_DATA_SOURCE_ID,
    autoRunEnabled: state.schedulerEnabled === true,
    autoRunAt: '09:00',
    timeZone: TZ,
    endDate: '2026-12-15'
  };
}

async function loadDotEnv() {
  try {
    const text = await readFile(path.join(ROOT, '.env'), 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch { /* .env is optional; use the local settings panel */ }
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; }
}

async function saveState() { await writeFile(STATE_FILE, JSON.stringify(state, null, 2)); }

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Request body is too large.');
  }
  return raw ? JSON.parse(raw) : {};
}

function publicStatus() {
  const c = config();
  return {
    searchConfigured: Boolean(c.braveApiKey),
    notionConfigured: Boolean(c.notionToken && c.notionDataSourceId),
    schedulerEnabled: c.autoRunEnabled,
    schedule: `Daily at ${c.autoRunAt} ${c.timeZone} through ${c.endDate}`,
    running,
    lastRunAt: state.lastRunAt,
    lastRunCount: state.lastRunCount,
    lastSavedCount: state.lastSavedCount,
    lastError: state.lastError,
    latestJobs: state.lastJobs || []
  };
}

const queries = [
  'Hyderabad fresher entry level AI ML engineer Python jobs 0-1 year',
  'Hyderabad graduate software engineer fresher Python Java careers',
  'Hyderabad entry level data analyst data scientist fresher jobs SQL',
  'India remote fresher entry level AI ML engineer Python jobs',
  'India remote graduate software engineer jobs fresher 0-1 year',
  'site:linkedin.com/jobs/view Hyderabad fresher entry level software engineer AI ML',
  'site:in.indeed.com/viewjob Hyderabad fresher AI ML software engineer',
  'site:naukri.com/job-listings Hyderabad fresher AI ML software engineer',
  'site:hiring.cafe Hyderabad OR India remote fresher software engineer AI ML'
];

async function braveSearch(query) {
  const c = config();
  const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&country=IN&search_lang=en&count=20`, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': c.braveApiKey },
    signal: AbortSignal.timeout(18_000)
  });
  if (!response.ok) throw new Error(`Search provider returned ${response.status}.`);
  const data = await response.json();
  return (data.web?.results || []).map(item => ({
    title: item.title || 'Untitled role',
    url: item.url || '',
    description: item.description || '',
    published: item.page_age || item.age || '',
    sourceQuery: query,
    sourceDomain: safeHost(item.url)
  })).filter(item => item.url);
}

function safeHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const skillGroups = [
  ['python', ['python']], ['sql', ['sql', 'mysql', 'postgresql', 'oracle']],
  ['machine learning', ['machine learning', 'ml engineer', 'ml models']],
  ['deep learning', ['deep learning', 'pytorch', 'tensorflow', 'neural network']],
  ['llm / genai', ['llm', 'genai', 'generative ai', 'rag', 'prompt']],
  ['computer vision', ['computer vision', 'opencv', 'yolo', 'image processing']],
  ['java / backend', ['java', 'spring', 'backend', 'rest api']],
  ['data / analytics', ['data analyst', 'data scientist', 'analytics', 'pandas', 'data analysis']],
  ['automation / QA', ['selenium', 'automation testing', 'qa engineer', 'test automation']],
  ['graduate eligibility', ['graduate', 'b.tech', 'bachelor', 'freshers', 'fresher', 'entry level']],
  ['cloud / tools', ['google cloud', 'gcp', 'aws', 'azure', 'linux', 'git']]
];

function salaryEvidence(text, host) {
  const normalized = text.toLowerCase();
  const match = normalized.match(/(?:₹|inr\s*)\s?(\d+(?:\.\d+)?)\s*(?:-|to|–|—)\s*(?:₹|inr\s*)?\s?(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lac)?|(?:₹|inr\s*)\s?(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lac)/i);
  if (!match) return { min: null, max: null, verified: false, label: 'Undisclosed' };
  const min = Number(match[1] || match[3]);
  const max = Number(match[2] || match[3]);
  const primary = !/(linkedin|indeed|naukri|hiring\.cafe|glassdoor|firsthire|ambitionbox)/i.test(host);
  return { min, max, verified: primary, label: primary ? 'Employer listing' : 'Third-party estimate' };
}

function classifyLocation(text) {
  const t = text.toLowerCase();
  if (t.includes('hyderabad') && (t.includes('hybrid') || t.includes('onsite') || t.includes('on-site') || t.includes('office'))) {
    return { location: 'Hyderabad', workMode: /hybrid/.test(t) ? 'Hybrid' : 'Onsite', points: 15 };
  }
  if (t.includes('hyderabad')) return { location: 'Hyderabad', workMode: 'Onsite', points: 12 };
  if ((t.includes('remote') || t.includes('work from home')) && (t.includes('india') || t.includes('anywhere'))) {
    return { location: 'India Remote', workMode: 'Remote', points: 15 };
  }
  return null;
}

function inferCompany(title, host) {
  const patterns = [
    /\b(?:at|@)\s+([^|–—-]+)(?:\s*[|–—-].*)?$/i,
    /^([^|]+?)\s+(?:\||-\s*careers?\b)/i
  ];
  for (const pattern of patterns) {
    const match = title.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 100);
  }
  const firstChunk = title.split('|')[0].trim();
  if (firstChunk && firstChunk.length < 65 && /\b(?:inc|ltd|technologies|solutions|systems|labs|corp|limited|company)\b/i.test(firstChunk)) return firstChunk;
  return host.replace(/^jobs\./, '').replace(/^careers\./, '').replace(/\.(com|in|org|net|io|co)$/, '');
}

function scoreJob(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  if (!/software|engineer|developer|data analyst|data scientist|machine learning|\bai\b|\bml\b|\bgenai\b|llm|computer vision|automation test|qa engineer|python|java developer|cloud engineer|technology/.test(item.title.toLowerCase())) return null;
  const location = classifyLocation(text);
  if (!location) return null;
  if (/senior|principal|staff engineer|lead engineer|manager|director|10\+ years/.test(text)) return null;
  const matched = skillGroups.filter(([, terms]) => terms.some(term => text.includes(term))).map(([name]) => name);
  const skillPoints = Math.round(45 * Math.min(matched.length / 6, 1));
  const entryLevel = /fresher|graduate|entry.level|junior|0.?1 year|0.?2 years|new grad|campus/.test(text);
  const experiencePoints = entryLevel ? 20 : /associate|trainee|early career/.test(text) ? 14 : 6;
  const salary = salaryEvidence(`${item.title} ${item.description}`, item.sourceDomain);
  const floor = 6;
  const salaryPoints = salary.min == null ? (matched.length >= 4 ? 10 : 6)
    : salary.max < floor ? 0
      : salary.verified ? 20 : 12;
  const score = Math.min(100, skillPoints + experiencePoints + location.points + salaryPoints);
  const missing = skillGroups.filter(([name]) => !matched.includes(name)).slice(0, 4).map(([name]) => name);
  const confidence = item.description.length > 160 ? 'Medium' : 'Low — listing details are sparse';
  const salaryText = salary.min == null ? 'Salary undisclosed' : `${salary.label}: ${salary.min}${salary.max !== salary.min ? `–${salary.max}` : ''} LPA`;
  return {
    ...item, ...location, ...salary, company: inferCompany(item.title, item.sourceDomain),
    id: randomUUID(),
    score,
    matchSummary: `Estimated ${score}/100 · ${confidence}. Matched: ${matched.join(', ') || 'limited skill details'}. Check requirements: ${missing.join(', ') || 'none flagged'}. ${salaryText}.`,
    status: 'Saved',
    experienceLevel: entryLevel ? 'Fresher' : 'Graduate',
    verification: 'Search result found; open the source listing before applying.'
  };
}

async function searchJobs() {
  const c = config();
  if (!c.braveApiKey) throw Object.assign(new Error('Add a Brave Search API key in Setup to run discovery.'), { status: 412 });
  const results = await Promise.allSettled(queries.map(braveSearch));
  const failed = results.filter(x => x.status === 'rejected');
  const found = results.filter(x => x.status === 'fulfilled').flatMap(x => x.value);
  if (!found.length) throw new Error(failed[0]?.reason?.message || 'Search returned no results.');
  const unique = new Map();
  for (const job of found) {
    const key = job.url.toLowerCase().replace(/[?#].*$/, '').replace(/\/$/, '');
    if (!unique.has(key)) unique.set(key, job);
  }
  const candidates = [...unique.values()].map(scoreJob).filter(Boolean)
    .filter(job => job.score >= 45)
    .sort((a, b) => b.score - a.score || (b.published || '').localeCompare(a.published || ''))
    .slice(0, 20);
  const checked = await Promise.all(candidates.map(verifyListing));
  const jobs = checked.filter(job => !job.closed).slice(0, 10);
  return { jobs, queriesRun: queries.length, sourceFailures: failed.length, indexedCount: found.length };
}

async function verifyListing(job) {
  try {
    const response = await fetch(job.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; OrbitJobHunter/1.0; +http://127.0.0.1)',
        'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Range': 'bytes=0-12000'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000)
    });
    const finalUrl = response.url || job.url;
    const status = response.status;
    const reader = response.body?.getReader();
    let sample = '';
    if (reader) {
      const { value } = await reader.read();
      sample = new TextDecoder().decode(value || new Uint8Array()).slice(0, 12_000).toLowerCase();
      await reader.cancel().catch(() => {});
    }
    const closedText = /job (?:has been filled|is no longer available|posting has expired)|position (?:has been filled|is no longer available|has been closed)|no longer accepting applications|this role is no longer open|vacancy has been filled/.test(sample);
    const loginRedirect = /\/login|\/signin|\/auth\//i.test(new URL(finalUrl).pathname);
    if ([404, 410].includes(status) || closedText) return { ...job, closed: true, verification: 'Listing appears closed or removed.' };
    if (loginRedirect || [401, 403, 429].includes(status)) return { ...job, closed: false, verification: 'Source requires login or blocks automated checks; verify manually.' };
    if (status >= 200 && status < 400) return { ...job, closed: false, verification: `Source page reachable (HTTP ${status}); confirm the role is still open.` };
    return { ...job, closed: false, verification: `Source returned HTTP ${status}; verify the listing manually.` };
  } catch {
    return { ...job, closed: false, verification: 'Could not check source page automatically; verify the listing manually.' };
  }
}

function rich(text) { return [{ type: 'text', text: { content: String(text || '').slice(0, 1900) } }]; }

function notionProperties(job) {
  const p = {
    'Job / Company': { title: rich(`${job.title} — ${job.company || job.sourceDomain || 'Company'}`) },
    Company: { rich_text: rich(job.company || job.sourceDomain || '') },
    Role: { rich_text: rich(job.title) },
    Location: { select: { name: job.location } },
    'Work Mode': { select: { name: job.workMode } },
    'Experience Level': { select: { name: job.experienceLevel } },
    'Job URL': { url: job.url },
    Source: { rich_text: rich(`${job.sourceDomain}; ${job.sourceQuery}`) },
    Status: { select: { name: 'Saved' } },
    'Salary Verified': { checkbox: job.verified === true },
    Notes: { rich_text: rich(`${job.verification} Salary: ${job.label}. Listing date: ${job.published || 'not shown'}.`) },
    'Resume Match %': { number: job.score },
    'Match Summary': { rich_text: rich(job.matchSummary) }
  };
  if (Number.isFinite(job.min)) p['Salary Min (LPA)'] = { number: job.min };
  if (Number.isFinite(job.max)) p['Salary Max (LPA)'] = { number: job.max };
  if (job.published && /^\d{4}-\d{2}-\d{2}/.test(job.published)) p['Posted Date'] = { date: { start: job.published.slice(0, 10) } };
  return p;
}

async function notionRequest(route, options = {}) {
  const c = config();
  const response = await fetch(`https://api.notion.com/v1${route}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${c.notionToken}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(20_000)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Notion API ${response.status}: ${body.message || body.code || 'request failed'}`);
  return body;
}

async function existingJobKeys() {
  const c = config();
  const data = await notionRequest(`/data_sources/${encodeURIComponent(c.notionDataSourceId)}/query`, {
    method: 'POST', body: JSON.stringify({ page_size: 100 })
  });
  return new Set((data.results || []).map(row => {
    const p = row.properties || {};
    const url = p['Job URL']?.url || '';
    const title = (p['Job / Company']?.title || []).map(t => t.plain_text).join('').toLowerCase();
    return `${url.toLowerCase().replace(/[?#].*$/, '')}|${title}`;
  }));
}

async function saveJobsToNotion(jobs) {
  const c = config();
  if (!c.notionToken || !c.notionDataSourceId) throw Object.assign(new Error('Add a Notion integration token in Setup to sync leads.'), { status: 412 });
  const existing = await existingJobKeys();
  let saved = 0;
  let skipped = 0;
  for (const job of jobs) {
    const title = `${job.title} — ${job.company || job.sourceDomain || 'Company'}`.toLowerCase();
    const key = `${job.url.toLowerCase().replace(/[?#].*$/, '')}|${title}`;
    const hasUrl = [...existing].some(k => k.startsWith(`${job.url.toLowerCase().replace(/[?#].*$/, '')}|`));
    if (existing.has(key) || hasUrl) { skipped++; continue; }
    await notionRequest('/pages', {
      method: 'POST',
      body: JSON.stringify({
        parent: { type: 'data_source_id', data_source_id: c.notionDataSourceId },
        properties: notionProperties(job)
      })
    });
    existing.add(key);
    saved++;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return { saved, skipped };
}

async function performRun() {
  if (running) throw Object.assign(new Error('A job hunt is already running.'), { status: 409 });
  running = true;
  state.lastError = null;
  await saveState();
  try {
    const result = await searchJobs();
    state.lastRunAt = new Date().toISOString();
    state.lastRunDate = dateInZone(new Date());
    state.lastRunCount = result.jobs.length;
    state.lastJobs = result.jobs.map(job => ({ ...job, savedToNotion: false }));
    state.lastError = result.sourceFailures ? `${result.sourceFailures} search queries failed; see the result source labels.` : null;
    await saveState();
    return result;
  } catch (error) {
    state.lastError = error.message;
    await saveState();
    throw error;
  } finally {
    running = false;
  }
}

function dateInZone(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function timeInZone(date) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
}

async function schedulerTick() {
  if (!state.schedulerEnabled || running) return;
  const now = new Date();
  const today = dateInZone(now);
  if (today > '2026-12-15') {
    state.schedulerEnabled = false;
    await saveState();
    return;
  }
  if (timeInZone(now) === '09:00' && state.lastRunDate !== today) {
    state.lastRunDate = today;
    await saveState();
    try { await performRun(); }
    catch (error) { state.lastError = error.message; await saveState(); }
  }
}

async function serveStatic(req, res, pathname) {
  const normalized = pathname === '/' ? '/index.html' : pathname;
  const target = path.resolve(PUBLIC, `.${decodeURIComponent(normalized)}`);
  if (!target.startsWith(PUBLIC)) return json(res, 403, { error: 'Forbidden' });
  try {
    const file = await readFile(target);
    const type = target.endsWith('.html') ? 'text/html; charset=utf-8'
      : target.endsWith('.css') ? 'text/css; charset=utf-8'
        : target.endsWith('.js') ? 'text/javascript; charset=utf-8'
          : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(file);
  } catch { json(res, 404, { error: 'Not found' }); }
}

const server = http.createServer(async (req, res) => {
  const base = `http://${req.headers.host || `${HOST}:${PORT}`}`;
  const pathname = new URL(req.url, base).pathname;
  try {
    if (req.method === 'GET' && pathname === '/api/status') return json(res, 200, publicStatus());
    if (req.method === 'GET' && pathname === '/api/profile') return json(res, 200, profile);
    if (req.method === 'PUT' && pathname === '/api/profile') {
      const body = await readBody(req);
      profile = { ...profile, ...body };
      await writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2));
      return json(res, 200, { ok: true, profile });
    }
    if (req.method === 'PUT' && pathname === '/api/config') {
      const body = await readBody(req);
      if (typeof body.braveApiKey === 'string') localConfig.braveApiKey = body.braveApiKey.trim();
      if (typeof body.notionToken === 'string') localConfig.notionToken = body.notionToken.trim();
      if (typeof body.notionDataSourceId === 'string') localConfig.notionDataSourceId = body.notionDataSourceId.trim();
      await writeFile(CONFIG_FILE, JSON.stringify(localConfig, null, 2));
      return json(res, 200, publicStatus());
    }
    if (req.method === 'POST' && pathname === '/api/notion-check') {
      const c = config();
      if (!c.notionToken) return json(res, 412, { error: 'Add the Notion token first.' });
      const data = await notionRequest(`/data_sources/${encodeURIComponent(c.notionDataSourceId)}`);
      return json(res, 200, { ok: true, title: data.title?.map(x => x.plain_text).join('') || 'Application Pipeline' });
    }
    if (req.method === 'POST' && pathname === '/api/run') {
      const result = await performRun();
      return json(res, 200, result);
    }
    if (req.method === 'POST' && pathname === '/api/save-selected') {
      const body = await readBody(req);
      const wanted = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
      const selected = (state.lastJobs || []).filter(job => wanted.has(job.id) && !job.savedToNotion);
      if (!selected.length) return json(res, 400, { error: 'Select at least one unsaved job first.' });
      const result = await saveJobsToNotion(selected);
      const selectedIds = new Set(selected.map(job => job.id));
      state.lastJobs = state.lastJobs.map(job => selectedIds.has(job.id) ? { ...job, savedToNotion: true } : job);
      state.lastSavedCount = result.saved;
      await saveState();
      return json(res, 200, { ...result, selected: selected.length });
    }
    if (req.method === 'POST' && pathname === '/api/scheduler') {
      const body = await readBody(req);
      if (body.enabled && !config().braveApiKey) {
        return json(res, 412, { error: 'Configure web search first, then start the daily schedule. Notion sync remains manual.' });
      }
      state.schedulerEnabled = Boolean(body.enabled);
      await saveState();
      return json(res, 200, publicStatus());
    }
    if (req.method === 'GET') return serveStatic(req, res, pathname);
    return json(res, 404, { error: 'Not found' });
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Request failed' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Job Hunter is running at http://${HOST}:${PORT}`);
  setInterval(() => { schedulerTick().catch(error => console.error(error)); }, 25_000);
});
