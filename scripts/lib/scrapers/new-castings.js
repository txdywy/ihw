/**
 * New Castings scraper module.
 * Fetches new casting data from the annual "List of {year} Hot Wheels new castings" pages.
 *
 * Exports:
 *   scrapeNewCastings(wikiClient) → CastingData[]
 */

const { isPlaceholderImage } = require('../image-utils');

const MAX_CASTINGS = 60;

/**
 * Build a wiki URL for a page name.
 *
 * @param {string} pageName
 * @returns {string}
 */
function wikiUrl(pageName) {
  return `https://hotwheels.fandom.com/wiki/${encodeURIComponent(pageName.replace(/\s+/g, '_'))}`;
}

/**
 * Parse car entries from wikitext table rows of a new castings page.
 *
 * Looks for:
 *   - [[PageName|Display]] links for car names
 *   - File: references for images
 *   - Designer info in table cells (if present)
 *
 * @param {string} wikitext - Raw wikitext content
 * @param {number} year - The year for these castings
 * @returns {Array<{name: string, pageName: string, imgFile: string|null, designer: string|null, firstSeries: string|null}>}
 */
function parseNewCastingsTable(wikitext, year) {
  if (!wikitext) return [];

  const entries = [];
  const rows = wikitext.split('\n|-');

  for (const row of rows) {
    const cells = row.split('\n|').filter(c => c.trim());
    if (cells.length < 2) continue;

    // Find a cell with a [[PageName|Display]] link that isn't a File: reference
    const nameCell = cells.find(c => c.includes('[[') && !c.includes('File:') && !c.includes('Category:'));
    if (!nameCell) continue;

    const linkMatch = nameCell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!linkMatch) continue;

    const pageName = linkMatch[1].trim();
    const name = (linkMatch[2] || linkMatch[1]).trim();

    // Skip invalid entries
    if (!name || name.length <= 1) continue;
    if (name.startsWith('!') || name.startsWith('Toy #')) continue;
    if (/^list of/i.test(name)) continue;

    // Look for File: reference
    let imgFile = null;
    const fileCell = cells.find(c => c.includes('File:'));
    if (fileCell) {
      const fm = fileCell.match(/File:([^\]|&\n]+)/i);
      if (fm) imgFile = fm[1].trim();
    }

    // Look for designer info - typically in a cell after the name
    let designer = null;
    for (const cell of cells) {
      if (cell === nameCell || cell === fileCell) continue;
      // Designer cells often contain just a name (no wiki links, no File:)
      const trimmed = cell.trim();
      if (
        trimmed &&
        !trimmed.includes('[[') &&
        !trimmed.includes('File:') &&
        !trimmed.includes('{|') &&
        !trimmed.startsWith('!') &&
        trimmed.length > 2 &&
        trimmed.length < 60 &&
        !/^\d+$/.test(trimmed) &&
        !/^#/.test(trimmed)
      ) {
        // Heuristic: designer names are typically short text without special chars
        if (/^[A-Za-z\s.\-']+$/.test(trimmed)) {
          designer = trimmed;
          break;
        }
      }
    }

    // Look for series info in cells with wiki links (after the name cell)
    let firstSeries = null;
    for (const cell of cells) {
      if (cell === nameCell || cell === fileCell) continue;
      const seriesMatch = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      if (seriesMatch) {
        const seriesName = (seriesMatch[2] || seriesMatch[1]).trim();
        if (seriesName !== name && seriesName.length > 1 && !/^list of/i.test(seriesName)) {
          firstSeries = seriesName;
          break;
        }
      }
    }

    entries.push({ name, pageName, imgFile, designer, firstSeries });
  }

  return entries;
}

/**
 * Resolve image URL for a casting entry.
 * Returns thumbUrl and fullUrl, or nulls if placeholder or unavailable.
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {string|null} imgFile
 * @returns {Promise<{image: string|null, fullImage: string|null}>}
 */
async function resolveImage(wikiClient, imgFile) {
  if (!imgFile) return { image: null, fullImage: null };

  try {
    const info = await wikiClient.imageInfo(imgFile);
    if (!info) return { image: null, fullImage: null };

    const thumbUrl = info.thumburl || info.url || null;
    const fullUrl = info.url || null;

    if (isPlaceholderImage(thumbUrl) || isPlaceholderImage(fullUrl)) {
      return { image: null, fullImage: null };
    }

    return { image: thumbUrl, fullImage: fullUrl };
  } catch {
    return { image: null, fullImage: null };
  }
}

/**
 * Scrape new castings data from the Hot Wheels Wiki.
 *
 * Logic:
 *   1. Parse "List of {currentYear} Hot Wheels new castings" page
 *   2. Also try previous year: "List of {currentYear-1} Hot Wheels new castings"
 *   3. Extract car entries from wikitext table rows
 *   4. For each entry, resolve image via wikiClient.imageInfo() + placeholder filter
 *   5. Build CastingData objects
 *   6. Return array of CastingData (max 60 total)
 *
 * @param {import('../wiki-client')} wikiClient - Wiki API client instance
 * @returns {Promise<Array<{id: string, name: string, year: number, designer: string|null, firstSeries: string|null, image: string|null, fullImage: string|null, url: string}>>}
 */
async function scrapeNewCastings(wikiClient) {
  console.log('\n🆕 Fetching new castings...');
  const results = [];

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];

  for (const year of years) {
    if (results.length >= MAX_CASTINGS) break;

    const pageTitle = `List of ${year} Hot Wheels new castings`;
    console.log(`  📅 Parsing ${pageTitle}...`);

    try {
      const parsed = await wikiClient.parsePage(pageTitle);
      if (!parsed) {
        console.log(`  ⚠ Page not found: ${pageTitle}`);
        continue;
      }

      const wikitext = parsed.wikitext?.['*'] || '';
      const entries = parseNewCastingsTable(wikitext, year);
      console.log(`  Found ${entries.length} entries for ${year}`);

      for (const entry of entries) {
        if (results.length >= MAX_CASTINGS) break;

        const { image, fullImage } = await resolveImage(wikiClient, entry.imgFile);

        results.push({
          id: entry.pageName.replace(/\s+/g, '_').toLowerCase(),
          name: entry.name,
          year,
          designer: entry.designer,
          firstSeries: entry.firstSeries,
          image,
          fullImage,
          url: wikiUrl(entry.pageName)
        });
      }

      console.log(`  ✅ ${year}: processed ${entries.length} castings`);
    } catch (err) {
      console.error(`  ⚠ Error scraping ${pageTitle}: ${err.message}`);
    }
  }

  console.log(`  🏁 New castings: ${results.length}`);
  return results;
}

module.exports = { scrapeNewCastings, parseNewCastingsTable };
