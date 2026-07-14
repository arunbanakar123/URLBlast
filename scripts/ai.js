/**
 * URLBlast - AI Integration Module
 * Uses Google Gemini API (free tier) for smart tab categorization
 */

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent';

/**
 * Categorize tabs using Gemini AI
 * @param {Array} tabs - [{title, url}]
 * @param {string} apiKey - User's Gemini API key
 * @returns {Promise<Object>} - { categories: { [name]: [{title, url}] } }
 */
export async function categorizeTabs(tabs, apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new Error('NO_API_KEY');
  }

  const tabList = tabs
    .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'))
    .map((t, i) => `${i + 1}. Title: "${t.title || 'Untitled'}" | URL: ${t.url}`)
    .join('\n');

  const prompt = `You are a smart browser tab organizer. Analyze the following list of open browser tabs and group them into logical categories (e.g., "Work", "Shopping", "News", "Social Media", "Research", "Entertainment", "Development", "Finance", etc.).

Rules:
- Create between 2 and 8 categories
- Every tab must be assigned to exactly one category
- Category names should be short (1-3 words)
- Return ONLY valid JSON, no markdown, no explanation
- JSON format: { "categories": { "Category Name": [tab_numbers_array] } }

Tabs:
${tabList}`;

  const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    if (response.status === 400) throw new Error('INVALID_API_KEY');
    if (response.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(err?.error?.message || `API_ERROR_${response.status}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) throw new Error('EMPTY_RESPONSE');

  // Parse and reconstruct categorized tabs
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // Try to extract JSON from response
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    else throw new Error('PARSE_ERROR');
  }

  const validTabs = tabs.filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://'));
  const result = {};

  for (const [category, indices] of Object.entries(parsed.categories || {})) {
    result[category] = indices
      .map(i => validTabs[i - 1])
      .filter(Boolean);
  }

  return { categories: result };
}

/**
 * Generate a summary/label for a group of URLs
 * @param {Array} tabs - [{title, url}]
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function summarizeTabs(tabs, apiKey) {
  if (!apiKey?.trim()) throw new Error('NO_API_KEY');

  const titles = tabs.map(t => t.title || t.url).join(', ');
  const prompt = `Given these browser tab titles: ${titles}
  
Write a single short sentence (max 15 words) summarizing what the user is working on. Be concise and direct. Return ONLY the summary sentence.`;

  const response = await fetch(`${GEMINI_API_BASE}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
    })
  });

  if (!response.ok) throw new Error(`API_ERROR_${response.status}`);

  const data = await response.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Mixed browsing session';
}

/**
 * Get user-friendly error messages
 */
export function getAiErrorMessage(errorCode) {
  const messages = {
    NO_API_KEY: 'Please add your free Gemini API key in Settings.',
    INVALID_API_KEY: 'Invalid API key. Please check your Gemini API key in Settings.',
    RATE_LIMIT: 'Rate limit reached. Please wait a moment and try again.',
    PARSE_ERROR: 'AI response was unexpected. Please try again.',
    EMPTY_RESPONSE: 'AI returned an empty response. Please try again.',
    NETWORK_ERROR: 'Network error. Please check your internet connection.'
  };
  return messages[errorCode] || `AI Error: ${errorCode}`;
}
