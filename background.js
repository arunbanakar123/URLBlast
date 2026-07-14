// URLBlast Background Service Worker
// Handles keyboard shortcuts and background tasks

// Offscreen document management
let creating;
async function setupOffscreenDocument(path) {
  if (creating) { await creating; return; }

  // Check if it already exists (if API is available)
  if (chrome.runtime.getContexts) {
    const existing = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(path)]
    });
    if (existing.length > 0) return;
  }

  try {
    creating = chrome.offscreen.createDocument({
      url: path,
      reasons: ['CLIPBOARD'],
      justification: 'Global keyboard shortcuts need clipboard access'
    });
    await creating;
  } catch (err) {
    // If it already exists, Chrome throws an error we can safely ignore
    if (!err.message.includes('Only a single offscreen')) {
      console.error('[URLBlast] Failed to create offscreen doc:', err);
    }
  } finally {
    creating = null;
  }
}

// Helper to show on-page snackbar notifications
async function notifyTab(message, status = 'success', targetTabId = null) {
  try {
    let tab;
    if (targetTabId) {
      // Use the specific tab provided (avoids focus-steal from newly opened tabs)
      try { tab = await chrome.tabs.get(targetTabId); } catch { return; }
    } else {
      [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    }
    if (!tab || !tab.url || tab.url.startsWith('chrome') || tab.url.startsWith('edge') || tab.url.startsWith('moz-extension') || tab.url.startsWith('chrome-extension')) return;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (msg, stat) => {
        let snackbar = document.getElementById('urlblast-snackbar');
        if (snackbar) snackbar.remove();

        snackbar = document.createElement('div');
        snackbar.id = 'urlblast-snackbar';

        const isSuccess = stat === 'success';
        const isError = stat === 'error';

        const bgColor    = isError ? '#fef2f2' : '#f0fdf4';
        const borderClr  = isError ? '#fca5a5' : '#86efac';
        const textColor  = isError ? '#dc2626' : '#16a34a';

        Object.assign(snackbar.style, {
          position:        'fixed',
          top:             '20px',
          left:            '50%',
          transform:       'translateX(-50%) translateY(-80px)',
          backgroundColor: bgColor,
          color:           textColor,
          border:          `1.5px solid ${borderClr}`,
          padding:         '10px 20px',
          borderRadius:    '999px',
          fontSize:        '14px',
          fontFamily:      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          fontWeight:      '600',
          zIndex:          '2147483647',
          boxShadow:       '0 4px 20px rgba(0,0,0,0.12)',
          display:         'flex',
          alignItems:      'center',
          gap:             '8px',
          whiteSpace:      'nowrap',
          transition:      'transform 0.35s cubic-bezier(0.34,1.4,0.64,1), opacity 0.25s ease',
          opacity:         '0',
          pointerEvents:   'none'
        });

        const icon = isSuccess ? '✓' : (isError ? '✕' : 'ℹ');
        snackbar.innerHTML = `
          <span style="font-weight:800;font-size:15px;">${icon}</span>
          <span>${msg}</span>
        `;

        document.body.appendChild(snackbar);
        snackbar.offsetHeight; // force reflow

        snackbar.style.opacity   = '1';
        snackbar.style.transform = 'translateX(-50%) translateY(0)';

        setTimeout(() => {
          snackbar.style.opacity   = '0';
          snackbar.style.transform = 'translateX(-50%) translateY(-80px)';
          setTimeout(() => snackbar?.remove(), 350);
        }, 3500);
      },
      args: [message, status]
    });
  } catch (err) {
    console.warn('[URLBlast] On-page notification failed:', err);
  }
}

// ── In-extension notification system (replaces OS desktop notifications) ───────
const NOTIF_STORAGE_KEY = 'urlblast_notifications';

async function pushNotification({ title, message, type = 'info', actions = [] }) {
  try {
    const { [NOTIF_STORAGE_KEY]: stored = [] } = await chrome.storage.local.get(NOTIF_STORAGE_KEY);
    const notif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title,
      message,
      type,
      actions,
      timestamp: Date.now()
    };
    // Keep newest 50 notifications
    const updated = [notif, ...stored].slice(0, 50);
    await chrome.storage.local.set({ [NOTIF_STORAGE_KEY]: updated });

    // Broadcast to all open extension pages (e.g. notification.html tab).
    // chrome.runtime.sendMessage reaches extension pages; tabs.sendMessage only
    // reaches content scripts and would never hit notification.html.
    chrome.runtime.sendMessage({ type: 'NOTIFICATION_ADDED' }).catch(() => {
      // Silently ignore "no receiver" — notification.html just isn't open right now
    });
  } catch (err) {
    console.warn('[URLBlast] pushNotification failed:', err);
  }
}

chrome.commands.onCommand.addListener(async (command) => {
  // ── Alt+K : Copy all tab URLs (Global) ─────────────────────────────────────
  if (command === 'copy-all-urls') {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const urls = tabs.map(tab => tab.url).filter(Boolean).join('\n');

      await setupOffscreenDocument('offscreen.html');
      await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'copy',
        text: urls
      });

      const msg = `✅ ${tabs.length} URLs copied!`;
      await notifyTab(msg, 'success');
      await pushNotification({ title: 'URLs Copied', message: `${tabs.length} tab URL${tabs.length !== 1 ? 's' : ''} copied to clipboard.`, type: 'success' });

    } catch (err) {
      console.error('[URLBlast] Error copying URLs:', err);
    }
  }

  // ── Alt+V : Open URLs from clipboard (Global) ──────────────────────────────
  if (command === 'open-urls-clipboard') {
    try {
      await setupOffscreenDocument('offscreen.html');
      const response = await chrome.runtime.sendMessage({
        target: 'offscreen',
        type: 'paste'
      });

      const text = response?.text || '';
      const rawLines = text.split(/\r?\n/).map(u => u.trim()).filter(u => u);

      if (rawLines.length === 0) {
        await notifyTab('❌ Clipboard is empty.', 'error');
        await pushNotification({ title: 'Clipboard Empty', message: 'No URLs found in clipboard to open.', type: 'error' });
        return;
      }

      // Detection logic
      const processedItems = rawLines.map(u => {
        // Basic URL validation
        try {
          const url = new URL(u);
          if (url.protocol === 'http:' || url.protocol === 'https:') return u;
        } catch {}

        // More restrictive regex for "likely URL" to avoid catching plain text search terms
        // Requires at least one dot and no spaces
        const isLikelyUrl = /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,6}(:[0-9]{1,5})?(\/.*)?$/i.test(u);
        if (isLikelyUrl) {
          return u.startsWith('http') ? u : 'https://' + u;
        }

        // Otherwise, it's a search query
        return `https://www.google.com/search?q=${encodeURIComponent(u)}`;
      });

      // Settings for bulk alert
      const { urlblast_settings = {} } = await chrome.storage.sync.get('urlblast_settings');
      const googleSearchCount = processedItems.filter(u => u.startsWith('https://www.google.com/search?q=')).length;
      
      if (urlblast_settings.googleSearchBulkAlert !== false && googleSearchCount > 4) {
        const { lastBulkWarningTimeShortcut = 0 } = await chrome.storage.session.get('lastBulkWarningTimeShortcut');
        const now = Date.now();

        if (now - lastBulkWarningTimeShortcut > 30000) {
          await chrome.storage.session.set({ lastBulkWarningTimeShortcut: now });
          await pushNotification({
            title: 'Bulk Search Warning',
            message: `⚠️ Opening ${googleSearchCount} searches may lead to IP block. Trigger the shortcut again if you're sure.`,
            type: 'warning'
          });
          return;
        }
        await chrome.storage.session.remove('lastBulkWarningTimeShortcut');
      }

      // ── Snapshot original tab BEFORE opening new tabs ──────────────────────
      // The last tab opens with active:true, stealing focus. If we query the
      // active tab AFTER the loop, we get the newly opened tab (still loading),
      // so executeScript fails. Capture the original tab ID first.
      const [originalTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const originalTabId = originalTab?.id ?? null;

      for (let i = 0; i < processedItems.length; i++) {
        const isLast = i === processedItems.length - 1;
        await chrome.tabs.create({ url: processedItems[i], active: isLast });
      }

      const msg = `🚀 Opened ${processedItems.length} item${processedItems.length !== 1 ? 's' : ''} from clipboard!`;
      await notifyTab(msg, 'success', originalTabId); // inject into original tab, not the new one
      await pushNotification({ title: 'Tabs Opened', message: `${processedItems.length} item${processedItems.length !== 1 ? 's' : ''} opened from clipboard.`, type: 'success' });

    } catch (err) {
      console.error('[URLBlast] Error opening URLs:', err);
    }
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_VERSION') {
    sendResponse({ version: chrome.runtime.getManifest().version });
  }
  return true;
});

// Clean up old session data periodically
chrome.alarms.create('cleanup', { periodInMinutes: 60 });
chrome.alarms.create('daily-check', { periodInMinutes: 1440 }); // Every 24 hours

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    chrome.storage.session.clear();
  }
  if (alarm.name === 'daily-check') {
    checkDonationPrompt();
  }
});

async function checkDonationPrompt() {
  const { urlblast_settings = {} } = await chrome.storage.sync.get('urlblast_settings');
  // Skip if user checked the box
  if (urlblast_settings.disableDonationPrompt) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  const date = now.getDate();
  const day = now.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

  // Calculate target date (10th, or next weekday if 10th is weekend)
  let targetDate = 10;
  const tenthDate = new Date(year, month, 10);
  if (tenthDate.getDay() === 6) targetDate = 12; // If Saturday -> move to Monday 12th
  if (tenthDate.getDay() === 0) targetDate = 11; // If Sunday -> move to Monday 11th

  // If today is the target support day
  if (date === targetDate && day >= 1 && day <= 5) {
    const monthKey = `${year}-${month}`;
    const { lastDonationPrompt } = await chrome.storage.sync.get('lastDonationPrompt');
    
    // Make sure we only show it once per month
    if (lastDonationPrompt !== monthKey) {
      await chrome.storage.sync.set({ lastDonationPrompt: monthKey });
      
      // Push to in-extension notification page instead of OS notification
      await pushNotification({
        title: 'Support URLBlast ☕',
        message: 'URLBlast is free! If it saves you time, consider supporting with a small donation. Every contribution helps!',
        type: 'donation',
        actions: [
          { label: 'Support URLBlast', url: chrome.runtime.getURL('popup/support.html') },
          { label: "Don't show again", disableDonation: true }
        ]
      });

      // Open notification page in a new tab so user sees it
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/notification.html'), active: false });
    }
  }
}

// Check on browser startup / extension load
chrome.runtime.onStartup.addListener(checkDonationPrompt);
chrome.runtime.onInstalled.addListener(checkDonationPrompt);
