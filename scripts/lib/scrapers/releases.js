/**
 * Releases scraper module.
 * Merges the original scrapeNewReleases() and scrapeReleases() logic.
 *
 * Key improvements over the original:
 *   - Each year's list page is parsed ONLY ONCE (eliminates duplicate scrapeYearList calls)
 *   - Deduplicates by pageName — keeps first entry with a valid (non-placeholder) image
 *   - Uses the modular WikiClient, text-cleaner, and image-utils
 *
 * Exports:
 *   scrapeReleases(wikiClient) → { releases: ReleaseGroup[], newReleases: CarData[] }
 */

const { isPlaceholderImage } = require('../image-utils');

const MAX_NEW_RELEASES = 50;
const MAX_CARS_PER_GROUP = 12;

/**
 * Parse a "List of {year} Hot Wheels" page and extract car entries from
 * wikitext table rows.
 *
 * Each entry has: { title, pageName, imgFile }
 *   - title: display name (from [[Page|Display]] or [[Page]])
 *   - pageName: the wiki page name (link target)
 *   - imgFile: filename from File: reference, or null
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {number} year
 * @returns {Promise<Array<{title: string, pageName: string, imgFile: string|null}>>}
 */
async function parseYearList(wikiClient, year) {
  console.log(`\n📅 Parsing List of ${year} Hot Wheels...`);
  const parsed = await wikiClient.parsePage(`List of ${year} Hot Wheels`);
  if (!parsed) {
    console.log(`  ⚠ List page not found for ${year}`);
    return [];
  }

  const wt = parsed.wikitext?.['*'] || '';
  const cars = [];

  // Parse wikitext table rows: split on row separators
  const rows = wt.split('\n|-');
  for (const row of rows) {
    const cells = row.split('\n|').filter(c => c.trim());
    if (cells.length < 3) continue;

    // Find a cell with a [[PageName|Display]] link that isn't a File: reference
    const nameCell = cells.find(c => c.includes('[[') && !c.includes('File:'));
    const fileCell = cells.find(c => c.includes('File:'));

    if (!nameCell) continue;

    const linkMatch = nameCell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    const title = linkMatch ? (linkMatch[2] || linkMatch[1]).trim() : null;
    const pageName = linkMatch ? linkMatch[1].trim() : null;

    if (!title || !pageName) continue;
    if (title.length <= 1 || title.startsWith('!') || title.startsWith('Toy #')) continue;

    let imgFile = null;
    if (fileCell) {
      const fm = fileCell.match(/File:([^\]|&\n]+)/i);
      if (fm) imgFile = fm[1].trim();
    }

    cars.push({ title, pageName, imgFile });
  }

  console.log(`  Found ${cars.length} cars for ${year}`);
  return cars;
}

/**
 * Deduplicate a list of car entries by pageName.
 *
 * For each unique pageName, keeps the first entry that has a valid
 * (non-placeholder) image. If no entry for that pageName has a valid image,
 * keeps the first entry.
 *
 * @param {Array<{title: string, pageName: string, imgFile: string|null}>} cars
 * @returns {Array<{title: string, pageName: string, imgFile: string|null}>}
 */
function deduplicateByPageName(cars) {
  // Group entries by pageName
  const groups = new Map();
  for (const car of cars) {
    if (!groups.has(car.pageName)) {
      groups.set(car.pageName, []);
    }
    groups.get(car.pageName).push(car);
  }

  const result = [];
  for (const [, entries] of groups) {
    // Prefer the first entry with a valid (non-placeholder) image file
    const withValidImage = entries.find(
      e => e.imgFile && !isPlaceholderImage(e.imgFile)
    );
    result.push(withValidImage || entries[0]);
  }

  return result;
}

/**
 * Resolve the image URL for a car entry.
 * Returns the thumburl from wikiClient.imageInfo(), or null if the image
 * is a placeholder or unavailable.
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {string|null} imgFile
 * @returns {Promise<{thumbUrl: string|null, fullUrl: string|null}>}
 */
async function resolveImage(wikiClient, imgFile) {
  if (!imgFile) return { thumbUrl: null, fullUrl: null };

  try {
    const imgInfo = await wikiClient.imageInfo(imgFile);
    if (!imgInfo) return { thumbUrl: null, fullUrl: null };

    const thumbUrl = imgInfo.thumburl || imgInfo.url || null;
    const fullUrl = imgInfo.url || null;

    // Filter out placeholder images
    if (isPlaceholderImage(thumbUrl) || isPlaceholderImage(fullUrl)) {
      return { thumbUrl: null, fullUrl: null };
    }

    return { thumbUrl, fullUrl };
  } catch {
    return { thumbUrl: null, fullUrl: null };
  }
}

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
 * Scrape releases data from the Hot Wheels Wiki.
 *
 * For the current year and previous year:
 *   1. Parse the year list page ONCE via parseYearList()
 *   2. Deduplicate by pageName (keep first entry with valid image)
 *   3. Resolve images via wikiClient.imageInfo()
 *   4. Build newReleases (CarData format, max 50 total) and
 *      releases (ReleaseGroup format, grouped by year+series, max 12 cars per group)
 *
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<{releases: Array, newReleases: Array}>}
 */
async function scrapeReleases(wikiClient) {
  console.log('\n🆕 Fetching releases...');

  const currentYear = new Date().getFullYear();
  const years = [currentYear, currentYear - 1];

  const newReleases = [];
  const releases = [];

  for (const year of years) {
    try {
      // 1. Parse year list ONCE
      const rawCars = await parseYearList(wikiClient, year);

      // 2. Deduplicate by pageName
      const uniqueCars = deduplicateByPageName(rawCars);
      console.log(`  📊 ${year}: ${rawCars.length} raw → ${uniqueCars.length} unique cars`);

      // 3. Resolve images and build data structures
      const seriesGroups = {};
      let processedForYear = 0;

      for (const car of uniqueCars) {
        // Resolve image
        const { thumbUrl, fullUrl } = await resolveImage(wikiClient, car.imgFile);

        // Build newReleases entry (only if we have an image and haven't hit the cap)
        if (thumbUrl && newReleases.length < MAX_NEW_RELEASES) {
          newReleases.push({
            id: car.pageName.replace(/\s+/g, '_').toLowerCase(),
            name: car.title,
            year,
            series: null,
            image: thumbUrl,
            fullImage: fullUrl,
            description: `${car.title} - ${year} Hot Wheels release`,
            url: wikiUrl(car.pageName)
          });
        }

        // Build release group entries (limit per-year processing for groups)
        if (processedForYear < MAX_CARS_PER_GROUP * 4) {
          const series = 'Mainline';
          if (!seriesGroups[series]) seriesGroups[series] = [];
          seriesGroups[series].push({
            name: car.title,
            image: thumbUrl
          });
          processedForYear++;
        }
      }

      // 4. Build ReleaseGroup entries from series groups
      for (const [series, cars] of Object.entries(seriesGroups)) {
        releases.push({
          year,
          series,
          id: `${year}_${series.replace(/\s+/g, '_').toLowerCase()}`,
          description: `${year}年 ${series} 系列新车`,
          cars: cars.slice(0, MAX_CARS_PER_GROUP),
          url: `https://hotwheels.fandom.com/wiki/List_of_${year}_Hot_Wheels`
        });
      }

      console.log(`  ✅ ${year}: ${Object.keys(seriesGroups).length} series group(s)`);
    } catch (err) {
      console.error(`  ⚠ Releases ${year}: ${err.message}`);
    }
  }

  console.log(`  🏁 New releases: ${newReleases.length}, Release groups: ${releases.length}`);
  return { releases, newReleases };
}

module.exports = { scrapeReleases, parseYearList, deduplicateByPageName };
