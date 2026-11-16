const $ = (id) => document.getElementById(id);
const dialog = $('setup-dialog');
let profile = null;
let lastJobs = [];
let selectedIds = new Set();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function showMessage(message, isError = false) {
  const el = $('run-message');
  el.textContent = message;
  el.classList.toggle('error', isError);
  el.classList.remove('hidden');
}

function setBusy(busy) {
  for (const id of ['run-now', 'run-empty']) {
    const button = $(id);
    if (button) { button.disabled = busy; if (busy) button.dataset.original = button.innerHTML; button.innerHTML = busy ? 'Searching the web…' : (button.dataset.original || '✳ Run job search <span class="arrow">↗</span>'); }
  }
}

function renderJobs(jobs) {
  lastJobs = jobs || [];
  $('result-count').textContent = String(lastJobs.length);
  $('nav-count').textContent = String(lastJobs.length);
  $('stat-matches').textContent = String(lastJobs.length);
  $('stat-fit').innerHTML = lastJobs.length ? `${Math.max(...lastJobs.map(j => j.score))}<small>%</small>` : '—<small>%</small>';
  $('stat-fit-label').textContent = lastJobs.length ? `${lastJobs.filter(j => j.score >= 70).length} strong matches` : 'Run a search to rank jobs';
  const host = $('job-list');
  if (!lastJobs.length) {
    host.innerHTML = `<div class="empty-state"><div class="empty-icon">⌕</div><h3>No qualifying jobs found</h3><p>Try again later. The job hunter only keeps roles that match your location and early-career criteria.</p></div>`;
    return;
  }
  host.innerHTML = lastJobs.map((job, index) => {
    const company = job.company || job.sourceDomain || 'Company details on listing';
    const title = job.title || 'Technology role';
    return `<article class="job-card">
      <div><div class="job-head"><div class="company-avatar">${escapeHtml(company.slice(0, 1).toUpperCase())}</div><div><h3 class="job-title">${escapeHtml(title)}</h3><div class="company-name">${escapeHtml(company)}</div></div></div>
      <div class="job-meta"><span class="meta-pill">${escapeHtml(job.location)} · ${escapeHtml(job.workMode)}</span><span class="meta-pill">${escapeHtml(job.experienceLevel || 'Entry-level')}</span><span class="meta-pill salary">${escapeHtml(job.label || 'Salary undisclosed')}</span></div>
      <p class="job-summary">${escapeHtml(job.matchSummary || 'Match details need review.')}</p>
      <div class="job-source"><span>Source: ${escapeHtml(job.sourceDomain || 'Web search')}</span><span>·</span><a href="${escapeHtml(job.url)}" target="_blank" rel="noreferrer">Open listing ↗</a><span>· ${escapeHtml(job.verification || 'Review listing')}</span></div></div>
      <div class="score-box"><div class="score-ring">${Number(job.score) || 0}</div><span class="score-label">MATCH</span><div class="confidence">#${index + 1} RANK</div>${job.savedToNotion ? '<span class="saved-badge">IN NOTION</span>' : `<label class="save-choice"><input type="checkbox" data-job-id="${escapeHtml(job.id)}" ${selectedIds.has(job.id) ? 'checked' : ''}/> Select</label>`}</div>
    </article>`;
  }).join('');
  updateSelectionBar();
}

function updateSelectionBar() {
  const count = selectedIds.size;
  $('selection-count').textContent = count ? `${count} job${count === 1 ? '' : 's'} selected for Notion.` : 'Select jobs you want in Notion.';
  $('save-selected').classList.toggle('hidden', count === 0);
  $('save-selected').disabled = count === 0;
}

function updateSchedule(status) {
  $('scheduler-toggle').setAttribute('aria-checked', String(status.schedulerEnabled));
  $('scheduler-indicator').textContent = status.schedulerEnabled ? 'ACTIVE' : 'PAUSED';
  $('scheduler-indicator').className = `status-pill ${status.schedulerEnabled ? 'on' : 'off'}`;
  $('stat-notion').textContent = String(status.lastSavedCount || 0);
  if (status.lastJobs?.length && !lastJobs.length) renderJobs(status.lastJobs);
}

async function loadStatus() {
  const status = await api('/api/status');
  updateSchedule(status);
  $('search-dot').classList.toggle('ready', status.searchConfigured);
  $('notion-dot').classList.toggle('ready', status.notionConfigured);
  if (status.lastRunAt) {
    const date = new Date(status.lastRunAt);
    $('today-label').textContent = `Last run ${new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(date)}`;
  }
  if (status.lastError) showMessage(`Last run note: ${status.lastError}`, true);
  if (status.latestJobs?.length) renderJobs(status.latestJobs);
}

async function startSearch() {
  setBusy(true);
  selectedIds = new Set();
  showMessage('Searching job boards and career pages, filtering for your locations and experience level, then ranking against your resume…');
  try {
    const result = await api('/api/run', { method: 'POST', body: '{}' });
    renderJobs(result.jobs);
    showMessage(`${result.jobs.length} qualifying matches ranked from ${result.indexedCount} search results. Nothing was added to Notion; select the jobs you want to save.${result.sourceFailures ? ` ${result.sourceFailures} search sources had errors.` : ''}`);
    $('today-label').textContent = `Updated ${new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date())}`;
  } catch (error) {
    showMessage(error.message, true);
    if (/API key|Notion token/i.test(error.message)) dialog.showModal();
  } finally { setBusy(false); }
}

function openSetup() {
  api('/api/status').then(status => {
    $('search-dot').classList.toggle('ready', status.searchConfigured);
    $('notion-dot').classList.toggle('ready', status.notionConfigured);
  }).catch(() => {});
  dialog.showModal();
}

async function saveSettings() {
  const data = {
    braveApiKey: $('brave-key').value,
    notionToken: $('notion-key').value,
    notionDataSourceId: $('notion-source').value
  };
  try {
    const status = await api('/api/config', { method: 'PUT', body: JSON.stringify(data) });
    $('brave-key').value = '';
    $('notion-key').value = '';
    $('setup-message').textContent = 'Saved locally on this computer.';
    updateSchedule(status);
    $('search-dot').classList.toggle('ready', status.searchConfigured);
    $('notion-dot').classList.toggle('ready', status.notionConfigured);
  } catch (error) { $('setup-message').textContent = error.message; }
}

async function testNotion() {
  $('setup-message').textContent = 'Testing Notion connection…';
  try {
    const result = await api('/api/notion-check', { method: 'POST', body: '{}' });
    $('setup-message').textContent = `Connected to ${result.title}.`;
  } catch (error) { $('setup-message').textContent = error.message; }
}

async function toggleScheduler() {
  const enabled = $('scheduler-toggle').getAttribute('aria-checked') !== 'true';
  try {
    const status = await api('/api/scheduler', { method: 'POST', body: JSON.stringify({ enabled }) });
    updateSchedule(status);
    showMessage(enabled ? 'Daily job search is active at 9:00 AM IST while this local app is running. Results stay in Orbit until you select them for Notion.' : 'Daily job hunter paused.');
  } catch (error) {
    showMessage(error.message, true);
    openSetup();
  }
}

async function saveSelected() {
  if (!selectedIds.size) return;
  $('save-selected').disabled = true;
  $('save-selected').textContent = 'Saving selected jobs…';
  try {
    const result = await api('/api/save-selected', { method: 'POST', body: JSON.stringify({ ids: [...selectedIds] }) });
    selectedIds = new Set();
    $('stat-notion').textContent = String(result.saved || 0);
    await loadStatus();
    showMessage(`${result.saved} new job${result.saved === 1 ? '' : 's'} added to Notion${result.skipped ? `; ${result.skipped} duplicate${result.skipped === 1 ? '' : 's'} already existed` : ''}. Other matches remain in Orbit.`);
  } catch (error) {
    showMessage(error.message, true);
    if (/Notion token/i.test(error.message)) openSetup();
  } finally {
    $('save-selected').innerHTML = 'Add selected to Notion <span class="arrow">↗</span>';
    $('save-selected').disabled = false;
    updateSelectionBar();
  }
}

async function initProfile() {
  profile = await api('/api/profile');
  $('profile-skills').value = [...(profile.skills || []), ...(profile.projects || [])].join(', ');
}

async function saveProfile() {
  const terms = $('profile-skills').value.split(/,|\n/).map(s => s.trim()).filter(Boolean);
  profile.skills = terms;
  const result = await api('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
  profile = result.profile;
  $('profile-save-msg').textContent = 'Saved';
  setTimeout(() => $('profile-save-msg').textContent = '', 1800);
}

$('run-now').addEventListener('click', startSearch);
$('run-empty').addEventListener('click', startSearch);
$('scroll-matches').addEventListener('click', () => $('matches').scrollIntoView({ behavior: 'smooth' }));
$('settings-open').addEventListener('click', openSetup);
$('settings-open-top').addEventListener('click', openSetup);
$('settings-save').addEventListener('click', saveSettings);
$('notion-test').addEventListener('click', testNotion);
$('scheduler-toggle').addEventListener('click', toggleScheduler);
$('profile-toggle').addEventListener('click', () => $('profile-editor').classList.toggle('hidden'));
$('profile-save').addEventListener('click', saveProfile);
$('save-selected').addEventListener('click', saveSelected);
$('job-list').addEventListener('change', event => {
  const input = event.target.closest('input[data-job-id]');
  if (!input) return;
  if (input.checked) selectedIds.add(input.dataset.jobId);
  else selectedIds.delete(input.dataset.jobId);
  updateSelectionBar();
});

$('today-label').textContent = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date());
loadStatus().catch(error => showMessage(error.message, true));
initProfile().catch(error => console.error(error));
