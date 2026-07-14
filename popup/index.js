/**
 * URLBlast - Main Popup Controller
 */

import { formatUrls, parseUrlsFromText, getDomain, truncate } from '../scripts/utils.js';
import { categorizeTabs, getAiErrorMessage } from '../scripts/ai.js';

// ── State ─────────────────────────────────────────────────────────────────────
let allTabs = [];
let selectedIds = new Set();
let focusedIndex = -1;
let currentTabList = [];
let settings = {
  theme: 'system',
  defaultFormat: 'plain',
  skipInternal: true,
  includePinned: true,
  apiKey: '',
  aiEnabled: false,
  disableDonationPrompt: false,
  googleSearchBulkAlert: true
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
  settings.disableDonationPrompt = document.getElementById('setting-disable-donation-prompt').checked;
  settings.googleSearchBulkAlert = document.getElementById('setting-google-search-bulk-alert').checked;

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
  document.getElementById('setting-disable-donation-prompt').checked = settings.disableDonationPrompt;
  document.getElementById('setting-google-search-bulk-alert').checked = settings.googleSearchBulkAlert !== false;
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
  currentTabList = allTabs;
  focusedIndex = -1;
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
    item.className = `tab-item${selectedIds.has(tab.id) ? ' selected' : ''}${idx === focusedIndex ? ' focused' : ''}`;
    item.dataset.id = tab.id;
    item.dataset.index = idx;
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
    currentTabList = filtered;
    focusedIndex = -1;
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

  // Notifications bell
  document.getElementById('btn-notifications').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup/notification.html') });
  });

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
      const rawUrls = text.split(/\r?\n/).map(u => u.trim()).filter(u => u);
      if (rawUrls.length === 0) { showToast('No URLs found in clipboard', 'error'); return; }

      const processedUrls = rawUrls.map(u => {
        if (isValidUrl(u)) return u;

        // More restrictive regex for "likely URL" to avoid catching plain text search terms
        // Requires at least one dot and no spaces
        const isLikelyUrl = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6}(:[0-9]{1,5})?(\/.*)?$/i.test(u);
        
        if (isLikelyUrl) {
          return u.startsWith('http') ? u : 'https://' + u;
        }
        
        // If it doesn't look like a URL with a domain, it's a search query
        return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
      });

      const googleSearchCount = processedUrls.filter(u => u.startsWith('https://www.google.com/search?q=')).length;
      
      // Stop and Warn logic
      if (settings.googleSearchBulkAlert && googleSearchCount > 4) {
        const { lastBulkWarningTime = 0 } = await chrome.storage.session.get('lastBulkWarningTime');
        const now = Date.now();
        
        // If they haven't been warned in the last 30 seconds, stop and warn
        if (now - lastBulkWarningTime > 30000) {
          await chrome.storage.session.set({ lastBulkWarningTime: now });
          alert(`⚠️ Bulk Search Warning: You are about to open ${googleSearchCount} Google search queries.\n\nOpening too many simultaneously may cause Google to block your IP address.\n\nIf you are sure you want to do this, please click "Paste & Open" again to proceed.`);
          return;
        }
        // If they click again within 30 seconds, we let it pass through
        await chrome.storage.session.remove('lastBulkWarningTime');
      }

      for (const url of processedUrls) await chrome.tabs.create({ url, active: false });
      showToast(`Opened ${processedUrls.length} item${processedUrls.length !== 1 ? 's' : ''}!`, 'success');
      await loadTabs();
    } catch (err) {
      console.error(err);
      showToast('Could not read clipboard or open URLs.', 'error');
    }
  });

  // Save session
  document.getElementById('btn-save-session').addEventListener('click', async () => {
    const selected = allTabs.filter(t => selectedIds.has(t.id));
    if (selected.length === 0) { showToast('No checked tabs to save', 'error'); return; }
    
    // Open naming modal
    const modal = document.getElementById('modal-session');
    const input = document.getElementById('input-session-name');
    const title = document.getElementById('modal-session-title');
    
    title.textContent = 'Save Session';
    input.value = `Session ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`;
    modal.style.display = 'flex';
    input.focus();
    input.select();

    // Store temporary data for the modal save button
    modal.dataset.mode = 'save';
    modal.dataset.tabs = JSON.stringify(selected.map(t => ({ title: t.title, url: t.url, favIconUrl: t.favIconUrl })));
  });

  // Modal Cancel
  document.getElementById('btn-modal-cancel').addEventListener('click', () => {
    document.getElementById('modal-session').style.display = 'none';
  });

  // Modal Save
  document.getElementById('btn-modal-save').addEventListener('click', async () => {
    const modal = document.getElementById('modal-session');
    const input = document.getElementById('input-session-name');
    const name = input.value.trim() || 'Untitled Session';
    const mode = modal.dataset.mode;

    if (mode === 'save') {
      const tabs = JSON.parse(modal.dataset.tabs);
      await saveSession(tabs, name);
      showToast('Session saved!', 'success');
    } else if (mode === 'rename') {
      const id = parseInt(modal.dataset.sessionId);
      await renameSession(id, name);
      showToast('Session renamed', 'success');
    }

    modal.style.display = 'none';
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

  // Configure shortcuts
  const btnConfig = document.getElementById('btn-configure-shortcuts');
  if (btnConfig) {
    btnConfig.addEventListener('click', () => {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    });
  }
}

// ── Sessions ──────────────────────────────────────────────────────────────────
async function saveSession(tabs, name) {
  const { urlblast_sessions = [] } = await chrome.storage.local.get('urlblast_sessions');
  urlblast_sessions.unshift({
    id: Date.now(),
    name,
    tabs,
    createdAt: Date.now()
  });
  // Keep max 20 sessions
  await chrome.storage.local.set({ urlblast_sessions: urlblast_sessions.slice(0, 20) });
}

async function renameSession(id, newName) {
  const { urlblast_sessions = [] } = await chrome.storage.local.get('urlblast_sessions');
  const index = urlblast_sessions.findIndex(s => s.id === id);
  if (index !== -1) {
    urlblast_sessions[index].name = newName;
    await chrome.storage.local.set({ urlblast_sessions });
  }
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
        <div style="cursor:pointer" data-id="${session.id}" data-action="rename-prompt">
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
      if (action === 'rename-prompt') {
        const modal = document.getElementById('modal-session');
        const input = document.getElementById('input-session-name');
        const title = document.getElementById('modal-session-title');
        title.textContent = 'Rename Session';
        input.value = session.name;
        modal.dataset.mode = 'rename';
        modal.dataset.sessionId = session.id;
        modal.style.display = 'flex';
        input.focus();
        input.select();
      }
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
    if (!tabs || tabs.length === 0) continue;
    const cat = document.createElement('div');
    cat.className = 'ai-category';
    const items = tabs.map(t => `<div class="ai-cat-item">${escHtml(truncate(t.title || t.url, 50))}</div>`).join('');
    cat.innerHTML = `
      <div class="ai-category-header">
        <span>${escHtml(name)} <span style="color:var(--text-muted);font-weight:400">(${tabs.length})</span></span>
        <div style="display:flex;gap:4px">
          <button class="btn btn-ghost btn-sm ai-cat-group" title="Create Tab Group">Group</button>
          <button class="btn btn-ghost btn-sm ai-cat-copy" title="Copy URLs">Copy</button>
        </div>
      </div>
      <div class="ai-category-items">${items}</div>
    `;
    cat.querySelector('.ai-cat-copy').addEventListener('click', async () => {
      const text = tabs.map(t => t.url).join('\n');
      await copyToClipboard(text);
      showToast(`${tabs.length} URLs copied!`, 'success');
    });
    cat.querySelector('.ai-cat-group').addEventListener('click', async () => {
      try {
        const tabIds = tabs.map(t => t.id).filter(id => id !== undefined);
        if (tabIds.length === 0) return;
        const groupId = await chrome.tabs.group({ tabIds });
        await chrome.tabGroups.update(groupId, { title: name, color: getRandomColor() });
        showToast(`Grouped into "${name}"`, 'success');
      } catch (err) {
        showToast('Error grouping tabs', 'error');
      }
    });
    container.appendChild(cat);
  }
}

function getRandomColor() {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  return colors[Math.floor(Math.random() * colors.length)];
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
  const { pendingCopy, pendingOpen } = await chrome.storage.session.get(['pendingCopy', 'pendingOpen']);

  // Ctrl+Shift+C was pressed — finish the copy
  if (pendingCopy && (Date.now() - pendingCopy.timestamp) < 8000) {
    await copyToClipboard(pendingCopy.text);
    await chrome.storage.session.remove('pendingCopy');
    showToast('All URLs copied! (Alt+K)', 'success');
  }

  // Ctrl+Shift+V was pressed — auto-trigger paste & open
  if (pendingOpen && (Date.now() - pendingOpen.timestamp) < 8000) {
    await chrome.storage.session.remove('pendingOpen');
    // Small delay so popup renders first
    setTimeout(() => {
      document.getElementById('btn-paste-open').click();
    }, 150);
  }
}

// In-popup keyboard shortcuts (when popup window is focused)
document.addEventListener('keydown', async (e) => {
  // Arrow Key Navigation
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (currentTabList.length === 0) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') focusedIndex = (focusedIndex + 1) % currentTabList.length;
    else focusedIndex = (focusedIndex - 1 + currentTabList.length) % currentTabList.length;
    
    renderTabList(currentTabList);
    // Scroll into view
    const focusedEl = document.querySelector('.tab-item.focused');
    if (focusedEl) focusedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return;
  }

  // Toggle selection with Space
  if (e.key === ' ' && focusedIndex >= 0) {
    e.preventDefault();
    const tab = currentTabList[focusedIndex];
    const el = document.querySelector(`.tab-item[data-id="${tab.id}"]`);
    if (el) toggleSelect(tab.id, el);
    return;
  }

  // Open with Enter
  if (e.key === 'Enter' && focusedIndex >= 0) {
    e.preventDefault();
    const tab = currentTabList[focusedIndex];
    chrome.tabs.update(tab.id, { active: true });
    chrome.windows.update(tab.windowId, { focused: true });
    return;
  }

  if (e.altKey && !e.ctrlKey) {
    // Alt+K — copy all URLs in current format
    if ((e.key === 'K' || e.key === 'k') && !e.shiftKey) {
      e.preventDefault();
      const format = document.getElementById('format-select').value;
      if (allTabs.length === 0) { showToast('No tabs to copy', 'error'); return; }
      const text = formatUrls(allTabs, format);
      await copyToClipboard(text);
      showToast(`All ${allTabs.length} URLs copied!`, 'success');
    }
    // Alt+V — paste & open URLs
    if ((e.key === 'V' || e.key === 'v') && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('btn-paste-open').click();
    }
  }
});
