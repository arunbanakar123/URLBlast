/**
 * URLBlast - Main Popup Controller
 */

import { formatUrls, parseUrlsFromText, getDomain, truncate } from '../scripts/utils.js';
import { categorizeTabs, getAiErrorMessage } from '../scripts/ai.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allTabs = [];
let selectedIds = new Set();
let settings = {
  theme: 'dark',
  defaultFormat: 'plain',
  skipInternal: true,
  includePinned: true,
  apiKey: '',
  aiEnabled: false
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  applyTheme(settings.theme);
  syncSettingsUI();
  setupTabNav();
  setupEventListeners();
  await loadTabs();
  await loadSessions();
  checkPendingCopy();
});

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const stored = await chrome.storage.sync.get('urlblast_settings');
  if (stored.urlblast_settings) {
    settings = { ...settings, ...stored.urlblast_settings };
  }
  // Apply default format to selector
  const fs = document.getElementById('format-select');
  if (fs) fs.value = settings.defaultFormat;
}

async function saveSettings() {
  settings.theme = document.getElementById('setting-theme').value;
  settings.defaultFormat = document.getElementById('setting-default-format').value;
  settings.skipInternal = document.getElementById('setting-skip-internal').checked;
  settings.includePinned = document.getElementById('setting-include-pinned').checked;
  settings.apiKey = document.getElementById('setting-api-key').value.trim();
  settings.aiEnabled = document.getElementById('setting-ai-enabled').checked;

  await chrome.storage.sync.set({ urlblast_settings: settings });
  applyTheme(settings.theme);
  document.getElementById('format-select').value = settings.defaultFormat;
  showToast('Settings saved!', 'success');
}

function syncSettingsUI() {
  document.getElementById('setting-theme').value = settings.theme;
  document.getElementById('setting-default-format').value = settings.defaultFormat;
  document.getElementById('setting-skip-internal').checked = settings.skipInternal;
  document.getElementById('setting-include-pinned').checked = settings.includePinned;
  document.getElementById('setting-api-key').value = settings.apiKey;
  document.getElementById('setting-ai-enabled').checked = settings.aiEnabled;
}

function applyTheme(theme) {
  let resolved = theme;
  if (theme === 'system') {
    resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = resolved;
  const moon = document.getElementById('icon-moon');
  const sun = document.getElementById('icon-sun');
  if (resolved === 'dark') { moon.style.display = ''; sun.style.display = 'none'; }
  else { moon.style.display = 'none'; sun.style.display = ''; }
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
function setupTabNav() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      document.getElementById(`panel-${btn.dataset.tab}`).classList.add('active');
    });
  });
}

// ── Load Tabs ─────────────────────────────────────────────────────────────────
async function loadTabs() {
  const query = { currentWindow: true };
  if (!settings.includePinned) query.pinned = false;
  const tabs = await chrome.tabs.query(query);

  allTabs = tabs.filter(t => {
    if (!t.url) return false;
    if (settings.skipInternal) {
      const internal = ['chrome://', 'edge://', 'about:', 'chrome-extension://', 'moz-extension://'];
      return !internal.some(p => t.url.startsWith(p));
    }
    return true;
  });

  selectedIds = new Set(allTabs.map(t => t.id));
  renderTabList(allTabs);
  updateStats();
  document.getElementById('count-current').textContent = allTabs.length;
}

function renderTabList(tabs) {
  const list = document.getElementById('tab-list');
  if (tabs.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>
      <p>No tabs found matching your search.</p>
    </div>`;
    return;
  }

  list.innerHTML = '';
  tabs.forEach((tab, idx) => {
    const item = document.createElement('div');
    item.className = `tab-item${selectedIds.has(tab.id) ? ' selected' : ''}`;
    item.dataset.id = tab.id;
    item.style.animationDelay = `${idx * 20}ms`;
    item.setAttribute('role', 'listitem');

    const faviconHtml = tab.favIconUrl
      ? `<img class="tab-favicon" src="${escHtml(tab.favIconUrl)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="tab-favicon-placeholder" style="display:none">🌐</div>`
      : `<div class="tab-favicon-placeholder">🌐</div>`;

    item.innerHTML = `
      <div class="tab-check">
        <svg class="tab-check-svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>
      </div>
      ${faviconHtml}
      <div class="tab-info">
        <div class="tab-title" title="${escHtml(tab.title || tab.url)}">${escHtml(truncate(tab.title || 'Untitled', 55))}</div>
        <div class="tab-url" title="${escHtml(tab.url)}">${escHtml(getDomain(tab.url))}</div>
      </div>
      <div class="tab-actions">
        <button class="icon-btn btn-goto" title="Switch to this tab" data-id="${tab.id}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
        <button class="icon-btn btn-copy-one" title="Copy this URL" data-url="${escHtml(tab.url)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
    `;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.tab-actions')) return;
      toggleSelect(tab.id, item);
    });
    item.querySelector('.btn-goto').addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });
    item.querySelector('.btn-copy-one').addEventListener('click', async (e) => {
      e.stopPropagation();
      await copyToClipboard(tab.url);
      showToast('URL copied!', 'success');
    });

    list.appendChild(item);
  });
}

function toggleSelect(id, el) {
  if (selectedIds.has(id)) { selectedIds.delete(id); el.classList.remove('selected'); }
  else { selectedIds.add(id); el.classList.add('selected'); }
  updateStats();
}

function updateStats() {
  document.getElementById('stats-text').textContent = `${allTabs.length} tab${allTabs.length !== 1 ? 's' : ''}`;
  const selEl = document.getElementById('selected-text');
  if (selectedIds.size > 0 && selectedIds.size < allTabs.length) {
    selEl.textContent = `${selectedIds.size} selected`;
    selEl.style.display = '';
  } else {
    selEl.style.display = 'none';
  }
}

// ── Search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input');
  const clearBtn = document.getElementById('btn-clear-search');

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    clearBtn.style.display = q ? '' : 'none';
    const filtered = q
      ? allTabs.filter(t => (t.title || '').toLowerCase().includes(q) || (t.url || '').toLowerCase().includes(q))
      : allTabs;
    renderTabList(filtered);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    clearBtn.style.display = 'none';
    renderTabList(allTabs);
    input.focus();
  });
}

// ── Event Listeners ───────────────────────────────────────────────────────────
function setupEventListeners() {
  setupSearch();

  // Theme toggle (header button)
  document.getElementById('btn-theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    const next = current === 'dark' ? 'light' : 'dark';
    settings.theme = next;
    applyTheme(next);
    chrome.storage.sync.set({ urlblast_settings: settings });
    document.getElementById('setting-theme').value = next;
  });

  // Select all toggle
  document.getElementById('btn-select-all').addEventListener('click', () => {
    const visibleIds = getVisibleTabIds();
    const allSelected = visibleIds.every(id => selectedIds.has(id));
    if (allSelected) { visibleIds.forEach(id => selectedIds.delete(id)); }
    else { visibleIds.forEach(id => selectedIds.add(id)); }
    document.querySelectorAll('.tab-item').forEach(el => {
      const id = parseInt(el.dataset.id);
      if (selectedIds.has(id)) el.classList.add('selected');
      else el.classList.remove('selected');
    });
    updateStats();
  });

  // Refresh
  document.getElementById('btn-refresh').addEventListener('click', async () => {
    await loadTabs();
    showToast('Tab list refreshed', 'success');
  });

  // Copy selected
  document.getElementById('btn-copy-selected').addEventListener('click', async () => {
    const format = document.getElementById('format-select').value;
    const selected = allTabs.filter(t => selectedIds.has(t.id));
    if (selected.length === 0) { showToast('No tabs selected', 'error'); return; }
    const text = formatUrls(selected, format);
    await copyToClipboard(text);
    showToast(`${selected.length} URL${selected.length !== 1 ? 's' : ''} copied!`, 'success');
  });

  // Copy all
  document.getElementById('btn-copy-all').addEventListener('click', async () => {
    const format = document.getElementById('format-select').value;
    if (allTabs.length === 0) { showToast('No tabs to copy', 'error'); return; }
    const text = formatUrls(allTabs, format);
    await copyToClipboard(text);
    showToast(`All ${allTabs.length} URLs copied!`, 'success');
  });

  // Paste & open
  document.getElementById('btn-paste-open').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      const urls = parseUrlsFromText(text);
      if (urls.length === 0) { showToast('No URLs found in clipboard', 'error'); return; }
      for (const url of urls) await chrome.tabs.create({ url, active: false });
      showToast(`Opened ${urls.length} URL${urls.length !== 1 ? 's' : ''}!`, 'success');
      await loadTabs();
    } catch {
      showToast('Could not read clipboard. Check permissions.', 'error');
    }
  });

  // Save session
  document.getElementById('btn-save-session').addEventListener('click', async () => {
    if (allTabs.length === 0) { showToast('No tabs to save', 'error'); return; }
    await saveSession(allTabs);
    showToast('Session saved!', 'success');
    await loadSessions();
  });

  // AI Categorize
  document.getElementById('btn-ai-categorize').addEventListener('click', aiCategorize);

  // AI close
  document.getElementById('btn-ai-close').addEventListener('click', () => {
    document.getElementById('ai-panel').style.display = 'none';
  });

  // Settings save
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);

  // API key toggle visibility
  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('setting-api-key');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Clear all sessions
  document.getElementById('btn-clear-sessions').addEventListener('click', async () => {
    if (!confirm('Clear all saved sessions?')) return;
    await chrome.storage.local.remove('urlblast_sessions');
    await loadSessions();
    showToast('Sessions cleared', 'success');
  });
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function saveSession(tabs) {
  const { urlblast_sessions = [] } = await chrome.storage.local.get('urlblast_sessions');
  const name = `Session ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`;
  urlblast_sessions.unshift({
    id: Date.now(),
    name,
    tabs: tabs.map(t => ({ title: t.title, url: t.url, favIconUrl: t.favIconUrl })),
    createdAt: Date.now()
  });
  // Keep max 20 sessions
  await chrome.storage.local.set({ urlblast_sessions: urlblast_sessions.slice(0, 20) });
}

async function loadSessions() {
  const { urlblast_sessions = [] } = await chrome.storage.local.get('urlblast_sessions');
  const list = document.getElementById('sessions-list');
  const empty = document.getElementById('sessions-empty');
  document.getElementById('count-sessions').textContent = urlblast_sessions.length;

  if (urlblast_sessions.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  list.innerHTML = '';
  urlblast_sessions.forEach(session => {
    const card = document.createElement('div');
    card.className = 'session-card';
    const date = new Date(session.createdAt).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
    const previewUrls = session.tabs.slice(0, 3).map(t => `<div class="ai-cat-item">${escHtml(truncate(t.title || t.url, 50))}</div>`).join('');
    const more = session.tabs.length > 3 ? `<div class="ai-cat-item">+${session.tabs.length - 3} more…</div>` : '';

    card.innerHTML = `
      <div class="session-card-header">
        <div>
          <div class="session-name">${escHtml(session.name)}</div>
          <div class="session-meta">${date} · ${session.tabs.length} tab${session.tabs.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="session-actions">
          <button class="btn btn-ghost btn-sm" data-id="${session.id}" data-action="restore">Restore</button>
          <button class="icon-btn" data-id="${session.id}" data-action="copy-session" title="Copy URLs">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="icon-btn" data-id="${session.id}" data-action="delete-session" title="Delete">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
        </div>
      </div>
      <div class="session-urls">${previewUrls}${more}</div>
    `;

    card.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      const id = parseInt(btn.dataset.id);
      if (action === 'restore') await restoreSession(session);
      if (action === 'copy-session') await copySessionUrls(session);
      if (action === 'delete-session') await deleteSession(id);
    });

    list.appendChild(card);
  });
}

async function restoreSession(session) {
  for (const tab of session.tabs) await chrome.tabs.create({ url: tab.url, active: false });
  showToast(`Restored ${session.tabs.length} tabs!`, 'success');
  await loadTabs();
  document.getElementById('tab-current').click();
}

async function copySessionUrls(session) {
  const text = session.tabs.map(t => t.url).join('\n');
  await copyToClipboard(text);
  showToast('Session URLs copied!', 'success');
}

async function deleteSession(id) {
  const { urlblast_sessions = [] } = await chrome.storage.local.get('urlblast_sessions');
  await chrome.storage.local.set({ urlblast_sessions: urlblast_sessions.filter(s => s.id !== id) });
  await loadSessions();
  showToast('Session deleted', 'success');
}

// ── AI Categorize ─────────────────────────────────────────────────────────────
async function aiCategorize() {
  if (!settings.apiKey) {
    showToast('Add your Gemini API key in Settings first.', 'error');
    document.getElementById('tab-settings').click();
    return;
  }
  if (allTabs.length === 0) { showToast('No tabs to categorize', 'error'); return; }

  const btn = document.getElementById('btn-ai-categorize');
  const origHtml = btn.innerHTML;
  btn.innerHTML = `<span class="spinner"></span> Categorizing…`;
  btn.disabled = true;

  try {
    const result = await categorizeTabs(allTabs, settings.apiKey);
    renderAiCategories(result.categories);
    document.getElementById('ai-panel').style.display = '';
  } catch (err) {
    showToast(getAiErrorMessage(err.message), 'error');
  } finally {
    btn.innerHTML = origHtml;
    btn.disabled = false;
  }
}

function renderAiCategories(categories) {
  const container = document.getElementById('ai-categories-list');
  container.innerHTML = '';
  for (const [name, tabs] of Object.entries(categories)) {
    if (!tabs.length) continue;
    const cat = document.createElement('div');
    cat.className = 'ai-category';
    const items = tabs.map(t => `<div class="ai-cat-item">${escHtml(truncate(t.title || t.url, 50))}</div>`).join('');
    cat.innerHTML = `
      <div class="ai-category-header">
        <span>${escHtml(name)} <span style="color:var(--text-muted);font-weight:400">(${tabs.length})</span></span>
        <button class="btn btn-ghost btn-sm ai-cat-copy" title="Copy these URLs">Copy</button>
      </div>
      <div class="ai-category-items">${items}</div>
    `;
    cat.querySelector('.ai-cat-copy').addEventListener('click', async () => {
      const text = tabs.map(t => t.url).join('\n');
      await copyToClipboard(text);
      showToast(`${tabs.length} URLs copied!`, 'success');
    });
    container.appendChild(cat);
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────
async function copyToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast${type ? ' ' + type : ''} show`;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function getVisibleTabIds() {
  return [...document.querySelectorAll('.tab-item')].map(el => parseInt(el.dataset.id));
}

function escHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function checkPendingCopy() {
  const { pendingCopy } = await chrome.storage.session.get('pendingCopy');
  if (pendingCopy && (Date.now() - pendingCopy.timestamp) < 5000) {
    await copyToClipboard(pendingCopy.text);
    await chrome.storage.session.remove('pendingCopy');
    showToast('URLs copied via shortcut!', 'success');
  }
}
