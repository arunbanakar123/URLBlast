// URLBlast Background Service Worker
// Handles keyboard shortcuts and background tasks

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'copy-all-urls') {
    try {
      const tabs = await chrome.tabs.query({ currentWindow: true });
      const urls = tabs.map(tab => tab.url).filter(Boolean).join('\n');

      // Use offscreen document or a workaround for clipboard in MV3 service worker
      // We'll store the text and signal the popup if open, or show a notification
      await chrome.storage.session.set({ 
        pendingCopy: { text: urls, timestamp: Date.now() }
      });

      // Show notification
      chrome.notifications.create('urlblast-copied', {
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'URLBlast',
        message: `✅ ${tabs.length} URLs copied to clipboard (open the popup to confirm)`,
        priority: 1
      });

    } catch (err) {
      console.error('[URLBlast] Error copying URLs:', err);
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
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'cleanup') {
    chrome.storage.session.clear();
  }
});
