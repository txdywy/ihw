/**
 * News scraper module.
 * Fetches recent Hot Wheels-related news from Wiki recent changes and year-specific searches.
 *
 * Key fixes over the original code:
 * 1. Include `ids` in `rcprop` to get `revid` field
 * 2. Generate unique IDs: `rc_{revid}` or fallback `rc_{encodedTitle}_{timestamp}`
 * 3. Filter out empty/bot comments
 * 4. Filter out `List of YYYY Hot Wheels` title pattern
 * 5. Prioritize meaningful summaries (page first paragraph, not edit comments)
 * 6. Use text-cleaner for summary cleaning
 */

const { extractDescription, cleanWikiText } = require('../text-cleaner');
const { getBestImage } = require('../image-utils');

// Bot patterns to filter out
const BOT_PATTERNS = /^(Bot:|Automated|robot|auto-?gen)/i;

// Title pattern for year list pages (data source pages, not news)
const YEAR_LIST_PATTERN = /^List of \d{4} Hot Wheels$/i;

// Hot Wheels-related keywords for title matching
const TITLE_KEYWORDS = /hot\s*wheels|hw\s|casting|treasure\s*hunt/i;

// Comment keywords for relevance matching
const COMMENT_KEYWORDS = /car|vehicle|series|release|casting/i;

/**
 * Generate a unique news ID from revid, title, and timestamp.
 *
 * - If `revid` exists: `rc_{revid}`
 * - Fallback: `rc_{encodeURIComponent(title.replace(/\s+/g, '_'))}_{timestamp.replace(/[^0-9]/g, '')}`
 *
 * @param {number|undefined} revid
 * @param {string} title
 * @param {string} timestamp
 * @returns {string}
 */
function generateNewsId(revid, title, timestamp) {
  if (revid) {
    return `rc_${revid}`;
  }
  const encodedTitle = encodeURIComponent((title || '').replace(/\s+/g, '_'));
  const cleanTimestamp = (timestamp || '').replace(/[^0-9]/g, '');
  return `rc_${encodedTitle}_${cleanTimestamp}`;
}

/**
 * Check if a news item is valid (should be kept).
 *
 * Filters out:
 * - Empty or bot comments
 * - Titles matching `List of YYYY Hot Wheels` pattern
 *
 * @param {string} title
 * @param {string} comment
 * @returns {boolean} true if the item is valid and should be kept
 */
function isValidNewsItem(title, comment) {
  // Filter out empty comments
  if (!comment || comment.trim() === '') return false;

  // Filter out bot comments
  if (BOT_PATTERNS.test(comment.trim())) return false;

  // Filter out year list pages
  if (YEAR_LIST_PATTERN.test(title)) return false;

  return true;
}

/**
 * Check if a news item is relevant to Hot Wheels content.
 *
 * @param {string} title
 * @param {string} comment
 * @returns {boolean}
 */
function isRelevantNews(title, comment) {
  if (TITLE_KEYWORDS.test(title)) return true;
  if (COMMENT_KEYWORDS.test(comment || '')) return true;
  return false;
}

/**
 * Ensure all IDs in the articles array are unique.
 * Appends a counter suffix if duplicates are found.
 *
 * @param {Array<{id: string}>} articles
 */
function ensureUniqueIds(articles) {
  const seen = new Map();
  for (const article of articles) {
    if (seen.has(article.id)) {
      const count = seen.get(article.id) + 1;
      seen.set(article.id, count);
      article.id = `${article.id}_${count}`;
    } else {
      seen.set(article.id, 1);
    }
  }
}

/**
 * Scrape news from the Hot Wheels Wiki.
 *
 * Sources:
 * 1. Recent changes — filtered for quality and relevance
 * 2. Year-specific searches — current year topics
 *
 * For the first 12 articles, enriches with page summaries and images.
 *
 * @param {import('../wiki-client')} wikiClient - Wiki API client instance
 * @returns {Promise<Array<{id: string, title: string, summary: string, date: string, source: string, url: string, image: string|null}>>}
 */
async function scrapeNews(wikiClient) {
  console.log('\n📰 Fetching news...');
  const articles = [];
  const today = new Date().toISOString().split('T')[0];
  const seen = new Set();

  // Source 1: Recent wiki changes
  try {
    const recentChanges = await wikiClient.query({
      list: 'recentchanges',
      rcnamespace: '0',
      rclimit: '30',
      rcprop: 'title|timestamp|comment|ids',
      rctype: 'edit|new'
    });

    for (const rc of recentChanges) {
      const titleLower = rc.title.toLowerCase();
      if (seen.has(titleLower)) continue;

      // Apply quality filters
      if (!isValidNewsItem(rc.title, rc.comment)) continue;

      // Apply relevance filter
      if (!isRelevantNews(rc.title, rc.comment)) continue;

      seen.add(titleLower);

      const id = generateNewsId(rc.revid, rc.title, rc.timestamp);
      const date = rc.timestamp?.split('T')[0] || today;

      articles.push({
        id,
        title: rc.title,
        summary: rc.comment ? cleanWikiText(rc.comment) : `Wiki page "${rc.title}" was recently updated`,
        date,
        source: 'Hot Wheels Wiki',
        url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(rc.title.replace(/\s+/g, '_'))}`,
        image: null
      });
    }

    console.log(`  📋 Recent changes: ${articles.length} relevant items`);
  } catch (e) {
    console.error('  ⚠ Recent changes:', e.message);
  }

  // Source 2: Year-specific searches
  const currentYear = new Date().getFullYear();
  const searchQueries = [
    `${currentYear} Hot Wheels Treasure Hunts`,
    `${currentYear} Hot Wheels new series`,
    `${currentYear} Car Culture`,
    `${currentYear} Hot Wheels Boulevard`
  ];

  for (const q of searchQueries) {
    try {
      const results = await wikiClient.search(q, 5);
      for (const r of results) {
        const titleLower = r.title.toLowerCase();
        if (seen.has(titleLower)) continue;

        // Skip year list pages from search results too
        if (YEAR_LIST_PATTERN.test(r.title)) continue;

        seen.add(titleLower);

        articles.push({
          id: `search_${r.pageid}`,
          title: r.title,
          summary: r.snippet
            ? cleanWikiText(r.snippet.replace(/<[^>]*>/g, ''))
            : `Latest Hot Wheels information: ${r.title}`,
          date: (r.timestamp || today).split('T')[0],
          source: 'Hot Wheels Wiki',
          url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(r.title.replace(/\s+/g, '_'))}`,
          image: null
        });
      }
    } catch {
      // Skip failed searches silently
    }
  }

  console.log(`  📰 Total news items: ${articles.length}`);

  // Ensure unique IDs across the batch
  ensureUniqueIds(articles);

  // Enrich first 12 articles with summaries and images
  const enrichCount = Math.min(articles.length, 12);
  console.log(`  🔍 Enriching first ${enrichCount} articles...`);

  for (let i = 0; i < enrichCount; i++) {
    const article = articles[i];
    try {
      // Try to parse the page for a better summary and image
      const parsed = await wikiClient.parsePage(article.title);
      if (parsed) {
        // Summary enrichment: prioritize page first paragraph
        const wikitext = parsed.wikitext?.['*'] || '';
        const pageDescription = extractDescription(wikitext);

        if (pageDescription && pageDescription.length > 20) {
          article.summary = pageDescription;
        } else if (
          article.summary.startsWith('Wiki page "') &&
          article.summary.endsWith('" was recently updated')
        ) {
          // Try harder: use cleanWikiText on the raw wikitext intro
          const fallback = cleanWikiText(wikitext.substring(0, 1000));
          if (fallback && fallback.length > 20) {
            article.summary = fallback;
          }
        }

        // Image enrichment
        const imageResult = await getBestImage(parsed, wikiClient);
        if (imageResult) {
          article.image = imageResult.thumbUrl;
        }
      }
    } catch {
      // Skip enrichment errors silently
    }
  }

  console.log(`  ✅ News scraping complete: ${articles.length} items`);
  return articles;
}

module.exports = { scrapeNews, generateNewsId, isValidNewsItem };
