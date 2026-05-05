/**
 * Featured cars scraper module.
 * Fetches data for a curated list of iconic Hot Wheels castings from the Wiki.
 */

const { extractDescription, cleanWikiText } = require('../text-cleaner');
const { getBestImage, isPlaceholderImage } = require('../image-utils');

// Curated list of iconic Hot Wheels castings to feature
const FEATURED_CASTINGS = [
  'Twin Mill', 'Bone Shaker', 'Deora II', 'Rodger Dodger',
  'Custom Barracuda', 'Red Baron', 'Splittin Image', 'Rigor Motor',
  'Sharkruiser', 'Bad to the Blade', 'Fast Fish', 'Bump Around',
  'Phantom Racer', 'Power Rocket', 'Nerve Hammer', 'Vairy 8',
  'Mach Speeder', 'Veloci-Racer', 'Turbo Flame', 'Ardent'
];

const MAX_FEATURED = 12;

/**
 * Extract structured data from a Wiki infobox in raw wikitext.
 * Looks for {{casting|...}}, {{Infobox_Car|...}}, or {{Infobox|...}} templates
 * and parses `| key = value` lines within them.
 *
 * @param {string} wikitext
 * @returns {Object} key-value pairs from the infobox (keys lowercased)
 */
function extractInfobox(wikitext) {
  const info = {};
  if (!wikitext) return info;

  const patterns = [
    /\{\{\s*(?:casting|infobox\s*car|infobox)[^}]*\}\}/i,
    /\{\{\s*casting\s*\|([\s\S]*?)\}\}/i
  ];

  let content = '';
  for (const pat of patterns) {
    const m = wikitext.match(pat);
    if (m) { content = m[0]; break; }
  }
  if (!content) return info;

  for (const line of content.split('\n')) {
    const m = line.match(/\|\s*(\w+)\s*=\s*(.+)/);
    if (m) info[m[1].toLowerCase().trim()] = m[2].trim();
  }
  return info;
}

/**
 * Extract the release year from infobox fields, wikitext, or page title.
 *
 * @param {Object} info - Parsed infobox key-value pairs
 * @param {string} wikitext - Raw wikitext
 * @param {string} title - Page title
 * @returns {number|null}
 */
function extractYear(info, wikitext, title) {
  const fields = ['year', 'years', 'firstyear', 'yearreleased', 'released'];
  for (const f of fields) {
    if (info[f]) {
      const m = info[f].match(/(\d{4})/);
      if (m) return parseInt(m[1]);
    }
  }
  const m = title?.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

/**
 * Extract the series name from infobox fields or page categories.
 *
 * @param {Object} info - Parsed infobox key-value pairs
 * @param {Array} categories - Page categories from parsed data
 * @returns {string|null}
 */
function extractSeries(info, categories) {
  const s = info.series || info.segment || info['sub-series'] || info.collection;
  if (s) {
    return s
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/'{2,}/g, '')
      .trim();
  }

  for (const cat of (categories || [])) {
    const catName = cat['*'] || cat.title || (typeof cat === 'string' ? cat : '');
    if (!catName) continue;
    const m = catName.match(/^Category:(.+?)(?:\s+\d{4})?$/i) || [null, catName];
    const name = m[1]?.trim();
    if (name && !/^hot\s*wheels$/i.test(name)) return name.replace(/_/g, ' ');
  }

  return null;
}

/**
 * Scrape featured cars from the Hot Wheels Wiki.
 *
 * For each casting in FEATURED_CASTINGS:
 *   1. Try direct page lookup via wikiClient.query() with titles + redirects
 *   2. Fallback to wikiClient.search() if not found
 *   3. Parse the page with wikiClient.parsePage()
 *   4. Extract infobox data, best image, and clean description
 *   5. Build a CarData object
 *
 * Stops after collecting MAX_FEATURED (12) cars with images.
 *
 * @param {import('../wiki-client')} wikiClient - Wiki API client instance
 * @returns {Promise<Array<{id: string, name: string, year: number|null, series: string|null, number: string|null, color: string|null, image: string|null, fullImage: string|null, description: string, url: string}>>}
 */
async function scrapeFeatured(wikiClient) {
  console.log('\n🏎  Fetching featured cars...');
  const results = [];

  for (const name of FEATURED_CASTINGS) {
    if (results.length >= MAX_FEATURED) break;

    let candidate = null;

    // 1. Try direct page lookup (most reliable for original castings)
    try {
      const data = await wikiClient.query({
        titles: name,
        prop: 'info',
        redirects: '1'
      });

      // wikiClient.query() returns an array; for title-based queries the
      // result comes back under data.query.pages, but our WikiClient
      // normalises everything into arrays. We need to inspect the raw
      // response. However, WikiClient.query() pushes array values from
      // data.query — for a `titles` query the pages come as an object,
      // not an array. So we fall back to a lower-level approach: use the
      // search as primary and direct lookup via parsePage.
    } catch {
      // ignore — will fall through to search
    }

    // Try parsing the page directly by title first
    try {
      const parsed = await wikiClient.parsePage(name);
      if (parsed && parsed.title) {
        candidate = { title: parsed.title, parsed };
      }
    } catch {
      // ignore
    }

    // 2. Fallback to search if direct parse didn't work
    if (!candidate) {
      try {
        const searchResults = await wikiClient.search(name, 5);
        const best = searchResults.find(
          r => r.title.toLowerCase().startsWith(name.toLowerCase()) && !r.title.includes('(')
        ) || searchResults[0];

        if (best) {
          const parsed = await wikiClient.parsePage(best.pageid || best.title);
          if (parsed) {
            candidate = { title: best.title, parsed };
          }
        }
      } catch {
        // ignore
      }
    }

    if (!candidate) {
      console.log(`  ⚠ Not found: ${name}`);
      continue;
    }

    console.log(`  📌 ${candidate.title}`);

    try {
      const parsed = candidate.parsed;
      const wt = parsed.wikitext?.['*'] || '';
      const info = extractInfobox(wt);

      // Get best image via image-utils (filters placeholders automatically)
      const imageResult = await getBestImage(parsed, wikiClient);

      if (!imageResult) {
        console.log(`    ⚠ No image`);
        continue;
      }

      // Validate final image URLs aren't placeholders
      if (isPlaceholderImage(imageResult.thumbUrl) || isPlaceholderImage(imageResult.fullUrl)) {
        console.log(`    ⚠ Only placeholder image available`);
        continue;
      }

      const year = extractYear(info, wt, candidate.title);
      const series = extractSeries(info, parsed.categories);

      // Clean description via text-cleaner
      let description = extractDescription(wt);
      if (!description) {
        // Fallback: clean the HTML text
        const htmlText = parsed.text?.['*'] || '';
        const stripped = htmlText.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        description = cleanWikiText(stripped.substring(0, 500));
      }

      const pageTitle = candidate.title;
      const car = {
        id: pageTitle.replace(/\s+/g, '_').toLowerCase(),
        name: pageTitle,
        year,
        series,
        number: info.number || info.collector_number || null,
        color: info.color || info.base_color || null,
        image: imageResult.thumbUrl,
        fullImage: imageResult.fullUrl,
        description,
        url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`
      };

      results.push(car);
      console.log(`    ✅ Added (${results.length}/${MAX_FEATURED})`);
    } catch (err) {
      console.error(`  ⚠ Error parsing ${candidate.title}: ${err.message}`);
    }
  }

  console.log(`  🏁 Featured cars: ${results.length}`);
  return results;
}

module.exports = { scrapeFeatured, FEATURED_CASTINGS };
