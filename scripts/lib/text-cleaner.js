/**
 * Wiki text cleaning module.
 * All functions are pure — no side effects, no external dependencies.
 */

/**
 * Remove nested Wiki templates {{...}} using iterative innermost-first approach.
 * Each iteration removes the innermost {{[^{}]*}}, up to 10 iterations.
 * After 10 iterations, force-remove all remaining {{ and }}.
 *
 * Handles pipe | in template parameters correctly.
 *
 * @param {string} text
 * @returns {string}
 */
function removeTemplates(text) {
  if (!text) return '';
  const innermost = /\{\{[^{}]*\}\}/g;
  let result = text;
  for (let i = 0; i < 10; i++) {
    const next = result.replace(innermost, '');
    if (next === result) break;
    result = next;
  }
  // Force-remove any remaining {{ or }}
  result = result.replace(/\{\{/g, '').replace(/\}\}/g, '');
  return result;
}

/**
 * Convert Wiki internal links to plain text.
 * [[Page|Display]] → Display
 * [[Page]] → Page
 *
 * @param {string} text
 * @returns {string}
 */
function convertWikiLinks(text) {
  if (!text) return '';
  // Handle [[Page|Display]] → Display
  // Handle [[Page]] → Page
  return text.replace(/\[\[([^\]]*?)\|([^\]]*?)\]\]/g, '$2')
             .replace(/\[\[([^\]]*?)\]\]/g, '$1');
}

/**
 * Remove external link markup, keeping display text.
 * [http://url display text] → display text
 * [https://url display text] → display text
 * [http://url] → (removed, no display text)
 *
 * @param {string} text
 * @returns {string}
 */
function removeExternalLinks(text) {
  if (!text) return '';
  // [http(s)://... display text] → display text
  return text.replace(/\[https?:\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1')
             .replace(/\[https?:\/\/[^\]]+\]/g, '');
}

/**
 * Remove Wiki heading markers (all levels: == through ======).
 * ==Title== → (empty)
 *
 * @param {string} text
 * @returns {string}
 */
function removeHeadings(text) {
  if (!text) return '';
  return text.replace(/^={2,6}\s*[^=\n]+?\s*={2,6}\s*$/gm, '');
}

/**
 * Remove HTML tags and Wiki formatting markup.
 * - <ref>...</ref> and self-closing <ref ... />
 * - <br/>, <br>, and other HTML tags
 * - '''bold''' and ''italic'' Wiki formatting
 *
 * @param {string} text
 * @returns {string}
 */
function removeHtmlAndFormatting(text) {
  if (!text) return '';
  // Remove <ref>...</ref> (including multiline)
  let result = text.replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '');
  // Remove self-closing <ref ... />
  result = result.replace(/<ref[^/]*\/>/gi, '');
  // Remove all remaining HTML tags
  result = result.replace(/<[^>]+>/g, '');
  // Remove Wiki bold/italic: '''bold''' before ''italic'' (order matters)
  result = result.replace(/'{3}(.*?)'{3}/g, '$1');
  result = result.replace(/'{2}(.*?)'{2}/g, '$1');
  return result;
}

/**
 * Remove Wiki table markup.
 * Lines starting with {|, |-, |}, and || cell content.
 *
 * @param {string} text
 * @returns {string}
 */
function removeTables(text) {
  if (!text) return '';
  return text.replace(/^\{\|.*$/gm, '')
             .replace(/^\|\-.*$/gm, '')
             .replace(/^\|\}.*$/gm, '')
             .replace(/^\|.*$/gm, '')
             .replace(/^!.*$/gm, '');
}

/**
 * Execute all cleaning steps in order, then truncate at sentence boundary.
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function cleanWikiText(text, maxLength = 400) {
  if (!text) return '';

  let result = text;
  result = removeTemplates(result);
  result = convertWikiLinks(result);
  result = removeExternalLinks(result);
  result = removeHeadings(result);
  result = removeHtmlAndFormatting(result);
  result = removeTables(result);

  // Collapse whitespace
  result = result.replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim();

  return truncate(result, maxLength);
}

/**
 * Truncate text at a sentence boundary.
 * - If text.length <= maxLength, return as-is.
 * - Otherwise find last sentence boundary (. ! ?) before maxLength, truncate there + "..."
 * - If no sentence boundary, truncate at last space before maxLength + "..."
 *
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
function truncate(text, maxLength = 400) {
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const slice = text.slice(0, maxLength);

  // Find last sentence-ending punctuation
  const sentenceEnd = Math.max(
    slice.lastIndexOf('.'),
    slice.lastIndexOf('!'),
    slice.lastIndexOf('?')
  );

  if (sentenceEnd > 0) {
    return text.slice(0, sentenceEnd + 1) + '...';
  }

  // Fall back to last space
  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > 0) {
    return text.slice(0, lastSpace) + '...';
  }

  // No good break point — hard truncate
  return slice + '...';
}

/**
 * Extract a clean description from raw wikitext.
 * Skips the infobox, extracts the first few sentences of body text.
 *
 * @param {string} wikitext
 * @param {number} maxLength
 * @returns {string}
 */
function extractDescription(wikitext, maxLength = 400) {
  if (!wikitext) return '';

  // Remove infobox / leading templates (everything before the first real paragraph)
  let body = wikitext;

  // Strip leading templates (infobox etc.) by removing templates first
  body = removeTemplates(body);

  // Take text before the first section heading
  const sectionMatch = body.search(/^==[^=]/m);
  if (sectionMatch > 0) {
    body = body.slice(0, sectionMatch);
  }

  // Now clean the remaining wiki markup
  body = convertWikiLinks(body);
  body = removeExternalLinks(body);
  body = removeHtmlAndFormatting(body);
  body = removeTables(body);
  body = removeHeadings(body);

  // Collapse whitespace
  body = body.replace(/\n{2,}/g, '\n').replace(/[ \t]+/g, ' ').trim();

  // Extract first few sentences
  const sentences = body.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 10);
  const joined = sentences.slice(0, 3).join(' ').trim();

  return truncate(joined, maxLength);
}

module.exports = {
  removeTemplates,
  convertWikiLinks,
  removeExternalLinks,
  removeHeadings,
  removeHtmlAndFormatting,
  removeTables,
  cleanWikiText,
  extractDescription,
  truncate,
};
