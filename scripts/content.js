/**
 * URLBlast Content Script
 * Handles on-page notifications (Toasts)
 */

(function() {
  if (window.urlBlastInitialized) return;
  window.urlBlastInitialized = true;

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'SHOW_NOTIFICATION') {
      showToast(msg.text, msg.status);
    }
  });

  function showToast(message, status = 'success') {
    let container = document.getElementById('urlblast-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'urlblast-toast-container';
      Object.assign(container.style, {
        position: 'fixed',
        top: '20px',
        right: '20px',
        zIndex: '2147483647',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        pointerEvents: 'none',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
      });
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    const color = status === 'success' ? '#10b981' : (status === 'error' ? '#ef4444' : '#3b82f6');
    const icon = status === 'success' ? '✓' : (status === 'error' ? '✕' : 'ℹ');

    Object.assign(toast.style, {
      minWidth: '240px',
      maxWidth: '320px',
      padding: '12px 16px',
      background: '#ffffff',
      color: '#1f2937',
      borderRadius: '8px',
      boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
      borderLeft: `4px solid ${color}`,
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      fontSize: '14px',
      fontWeight: '500',
      opacity: '0',
      transform: 'translateX(50px)',
      transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
      pointerEvents: 'auto'
    });

    toast.innerHTML = `
      <div style="background:${color}; color:#fff; width:24px; height:24px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0;">${icon}</div>
      <div style="flex:1;">${message}</div>
      <div style="cursor:pointer; color:#9ca3af; font-size:16px; margin-left:8px;" onclick="this.parentElement.remove()">×</div>
    `;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    });

    // Auto remove
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      setTimeout(() => toast.remove(), 400);
    }, 4000);
  }
})();
