/**
 * Image utility module.
 * Handles placeholder detection, best-image selection, and CDN URL normalization.
 */

const { parse: htmlParse } = require('node-html-parser');

/**
 * Check whether a URL points to a placeholder image.
 * Returns true if the URL contains "Image_Not_Available" (case-insensitive).
 * Returns false for null, undefined, or empty strings.
 *
 * @param {string|null|undefined} url
 * @returns {boolean}
 */
function isPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return false;
  return /image_not_available/i.test(url);
}

/**
 * Extract the image filename from an infobox in raw wikitext.
 * Looks for `| image = filename` pattern.
 *
 * @param {string} wikitext
 * @returns {string|null}
 */
function extractInfoboxImage(wikitext) {
  if (!wikitext) return null;
  const match = wikitext.match(/\|\s*image\s*=\s*(.+)/i);
  if (!match) return null;
  let filename = match[1].trim();
  // Remove any trailing wiki markup or whitespace
  filename = filename.replace(/\s*\|.*$/, '').replace(/\s*\}\}.*$/, '').trim();
  if (!filename || filename === '') return null;
  return filename;
}

/**
 * Extract the first image filename from wikitext.
 * Looks for [[File:name or [[Image:name patterns.
 *
 * @param {string} wikitext
 * @returns {string|null}
 */
function extractFirstImage(wikitext) {
  if (!wikitext) return null;
  const match = wikitext.match(/\[\[(File|Image):([^\]|]+)/i);
  return match ? match[2].trim() : null;
}

/**
 * Extract image URL from rendered HTML by looking for img tags
 * with src containing "static.wikia" or "nocookie".
 *
 * @param {string} html
 * @returns {{ thumbUrl: string, fullUrl: string }|null}
 */
function extractImageFromHtml(html) {
  if (!html) return null;
  try {
    const root = htmlParse(html);
    const img = root.querySelector('img[src*="static.wikia"], img[src*="nocookie"]');
    if (!img) return null;
    const src = img.getAttribute('src');
    if (!src) return null;
    const fullUrl = src.split('/revision/')[0] || src;
    return { thumbUrl: src, fullUrl };
  } catch {
    return null;
  }
}

/**
 * Get the best available non-placeholder image from parsed page data.
 *
 * Priority:
 *   1. Infobox image field
 *   2. First [[File:...]] or [[Image:...]] in wikitext
 *   3. parsed.images array entries
 *   4. HTML fallback (img tags with static.wikia / nocookie src)
 *
 * For each candidate, calls wikiClient.imageInfo(filename) to resolve URLs.
 * Skips any that are placeholder images.
 *
 * @param {Object} parsed - Result from wikiClient.parsePage()
 * @param {Object} wikiClient - Wiki API client with imageInfo(filename) method
 * @returns {Promise<{ thumbUrl: string, fullUrl: string }|null>}
 */
async function getBestImage(parsed, wikiClient) {
  if (!parsed) return null;

  const wikitext = parsed.wikitext?.['*'] || '';
  const html = parsed.text?.['*'] || '';
  const imagesList = parsed.images || [];

  // Build ordered list of candidate filenames (no duplicates)
  const candidates = [];
  const seen = new Set();

  function addCandidate(filename) {
    if (!filename || typeof filename !== 'string') return;
    const trimmed = filename.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(trimmed);
  }

  // 1. Infobox image
  addCandidate(extractInfoboxImage(wikitext));

  // 2. First image from wikitext
  addCandidate(extractFirstImage(wikitext));

  // 3. Images from parsed.images array
  for (const img of imagesList) {
    addCandidate(img);
  }

  // Try each candidate via wikiClient.imageInfo
  for (const filename of candidates) {
    try {
      const info = await wikiClient.imageInfo(filename);
      if (!info) continue;

      const thumbUrl = info.thumburl || info.url || null;
      const fullUrl = info.url || null;

      // Skip placeholders
      if (isPlaceholderImage(thumbUrl) || isPlaceholderImage(fullUrl)) continue;

      if (thumbUrl && fullUrl) {
        return { thumbUrl, fullUrl };
      }
    } catch {
      // Skip this candidate on error
    }
  }

  // 4. HTML fallback
  const htmlResult = extractImageFromHtml(html);
  if (htmlResult && !isPlaceholderImage(htmlResult.thumbUrl) && !isPlaceholderImage(htmlResult.fullUrl)) {
    return htmlResult;
  }

  return null;
}

/**
 * Normalize a Vignette CDN URL to request a specific width.
 *
 * For URLs containing `/revision/`:
 *   - If URL has `scale-to-width-down/XXX`, replace XXX with the desired width
 *   - If URL has no width parameter, append `/scale-to-width-down/{width}` before `?cb=`
 *
 * Non-Vignette URLs are returned unchanged.
 *
 * @param {string} url
 * @param {number} width
 * @returns {string}
 */
function normalizeImageUrl(url, width = 1200) {
  if (!url || typeof url !== 'string') return url;

  // Only process Vignette CDN URLs (contain /revision/)
  if (!url.includes('/revision/')) return url;

  // Replace existing scale-to-width-down/XXX
  if (/scale-to-width-down\/\d+/.test(url)) {
    return url.replace(/scale-to-width-down\/\d+/, `scale-to-width-down/${width}`);
  }

  // Append scale-to-width-down before ?cb= query parameter
  const cbIndex = url.indexOf('?cb=');
  if (cbIndex !== -1) {
    const before = url.substring(0, cbIndex);
    const after = url.substring(cbIndex);
    // Ensure no trailing slash before appending
    const base = before.endsWith('/') ? before.slice(0, -1) : before;
    return `${base}/scale-to-width-down/${width}${after}`;
  }

  // No ?cb= query — just append
  const base = url.endsWith('/') ? url.slice(0, -1) : url;
  return `${base}/scale-to-width-down/${width}`;
}

module.exports = {
  isPlaceholderImage,
  getBestImage,
  normalizeImageUrl,
};
