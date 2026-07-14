chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return false;

  if (msg.type === 'copy') {
    try {
      const el = document.createElement('textarea');
      el.value = msg.text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
      sendResponse(true);
    } catch (err) {
      console.error('Offscreen copy failed', err);
      sendResponse(false);
    }
    return false;
  } else if (msg.type === 'paste') {
    try {
      const el = document.createElement('textarea');
      document.body.appendChild(el);
      el.select();
      document.execCommand('paste');
      const text = el.value;
      el.remove();
      sendResponse({ text });
    } catch (err) {
      console.error('Offscreen paste failed', err);
      sendResponse({ text: '' });
    }
    return false; // Sync response
  }
  
  return false;
});
