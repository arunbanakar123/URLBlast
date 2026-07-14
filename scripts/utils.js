/**
 * URLBlast - URL Formatting Utilities
 * Provides multiple export formats for tab URLs
 */

/**
 * Format a list of tabs into the specified format
 * @param {Array} tabs - Chrome tab objects [{title, url}]
 * @param {string} format - 'plain' | 'markdown' | 'html' | 'json' | 'csv'
 * @param {boolean} includeTitle - Whether to include page titles
 * @returns {string}
 */
export function formatUrls(tabs, format = 'plain', includeTitle = true) {
  const validTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));

  switch (format) {
    case 'plain':
      return validTabs.map(t => includeTitle ? `${t.title}\n${t.url}` : t.url).join('\n');

    case 'plain-url-only':
      return validTabs.map(t => t.url).join('\n');

    case 'markdown':
      return validTabs.map(t => `- [${escapeMarkdown(t.title || t.url)}](${t.url})`).join('\n');

    case 'html':
      const listItems = validTabs.map(t =>
        `  <li><a href="${escapeHtml(t.url)}">${escapeHtml(t.title || t.url)}</a></li>`
      ).join('\n');
      return `<ul>\n${listItems}\n</ul>`;

    case 'json':
      return JSON.stringify(
        validTabs.map(t => ({ title: t.title, url: t.url, favIconUrl: t.favIconUrl || '' })),
        null, 2
      );

    case 'csv':
      const header = 'Title,URL';
      const rows = validTabs.map(t => `"${escapeCsv(t.title || '')}","${escapeCsv(t.url)}"`);
      return [header, ...rows].join('\n');

    case 'orgmode':
      return validTabs.map(t => `- [[${t.url}][${t.title || t.url}]]`).join('\n');

    default:
      return validTabs.map(t => t.url).join('\n');
  }
}

/**
 * Parse URLs from a block of text (for the "open from clipboard" feature)
 * @param {string} text
 * @returns {string[]} Array of valid URLs
 */
export function parseUrlsFromText(text) {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s<>"'{}|\\^`\[\]]+/gi;
  const matches = text.match(urlRegex) || [];
  // Deduplicate
  return [...new Set(matches)];
}

/**
 * Validate if a string is a valid URL
 */
export function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Get domain from URL
 */
export function getDomain(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

/**
 * Truncate text to a max length
 */
export function truncate(text, maxLength = 60) {
  if (!text) return '';
  return text.length > maxLength ? text.substring(0, maxLength) + '…' : text;
}

// --- Escape helpers ---

function escapeMarkdown(text) {
  return (text || '').replace(/([[\]()])/g, '\\$1');
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeCsv(text) {
  return (text || '').replace(/"/g, '""');
}
