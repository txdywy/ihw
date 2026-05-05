/**
 * Series Cars scraper module.
 * Fetches 2026 new car releases organized by series from the Wiki
 * "List of 2026 Hot Wheels" page.
 *
 * Exports:
 *   scrapeSeriesCars(wikiClient) → SeriesCarsData
 */

const { isPlaceholderImage } = require('../image-utils');

const MAX_CARS_PER_SERIES = 24;
const MAX_SERIES = 20;

/**
 * Parse the "List of {year} Hot Wheels" wikitext to extract cars with series info.
 *
 * The wiki table has 6 columns per row:
 *   Toy# | Col.# | Model Name | Series | Series # | Photo
 *
 * Cells are separated by `\n|`. Rows by `\n|-`.
 * The series cell typically contains: [[SeriesPage|<font>SeriesName</font>]]
 * The photo cell contains: [[File:filename.jpg|...]]
 *
 * @param {string} wikitext - Raw wikitext from the parsed page
 * @returns {Array<{name: string, pageName: string, series: string, imgFile: string|null}>}
 */
function parseSeriesFromWikitext(wikitext) {
  if (!wikitext) return [];

  const cars = [];
  const rows = wikitext.split('\n|-');

  for (const row of rows) {
    const cells = row.split('\n|').filter(c => c.trim());
    // Need at least 6 columns: Toy#, Col#, ModelName, Series, Series#, Photo
    if (cells.length < 6) continue;

    // Skip header rows
    if (cells.some(c => c.trim().startsWith('!'))) continue;

    // Column mapping (0-indexed): Toy#(0) Col#(1) ModelName(2) Series(3) Series#(4) Photo(5)
    const modelCell = cells[2];
    const seriesCell = cells[3];
    const photoCell = cells[5];

    // Extract model name from [[PageName|Display]] or [[PageName]]
    const modelLinkMatch = modelCell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!modelLinkMatch) continue;

    const pageName = modelLinkMatch[1].trim();
    let name = (modelLinkMatch[2] || modelLinkMatch[1]).trim();

    // Clean HTML tags from display name (e.g., <font> tags)
    name = name.replace(/<[^>]+>/g, '').trim();

    if (!name || name.length <= 1) continue;
    if (name.startsWith('!') || name.startsWith('Toy #')) continue;
    if (/^list of/i.test(name)) continue;

    // Extract series name from the series cell
    // Pattern: [[SeriesPage|<font color="...">SeriesName</font>]]
    // We want the display text inside the <font> tag, or the wiki link display text
    let series = 'Other';
    const seriesLinkMatch = seriesCell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (seriesLinkMatch) {
      let seriesDisplay = seriesLinkMatch[2] || seriesLinkMatch[1];
      // Strip HTML tags to get clean series name
      series = seriesDisplay.replace(/<[^>]+>/g, '').trim();
      // Remove any {{KR}} or other template artifacts
      series = series.replace(/\{\{[^}]*\}\}/g, '').trim();
    }

    // Extract image file from [[File:filename.jpg|...]]
    let imgFile = null;
    const fileMatch = photoCell.match(/File:([^\]|&\n]+)/i);
    if (fileMatch) imgFile = fileMatch[1].trim();

    cars.push({
      name,
      pageName,
      series: series || 'Other',
      imgFile
    });
  }

  return cars;
}

/**
 * Deduplicate cars by pageName within each series.
 * Keeps the first entry that has a valid image file.
 *
 * @param {Array} cars
 * @returns {Array}
 */
function deduplicateCars(cars) {
  const groups = new Map();
  for (const car of cars) {
    const key = `${car.series}::${car.pageName}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(car);
  }

  const result = [];
  for (const [, entries] of groups) {
    const withImage = entries.find(e => e.imgFile && !isPlaceholderImage(e.imgFile));
    result.push(withImage || entries[0]);
  }
  return result;
}

/**
 * Resolve image URL for a car entry.
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {string|null} imgFile
 * @returns {Promise<string|null>}
 */
async function resolveImage(wikiClient, imgFile) {
  if (!imgFile) return null;

  try {
    const info = await wikiClient.imageInfo(imgFile);
    if (!info) return null;

    const url = info.thumburl || info.url || null;
    if (isPlaceholderImage(url)) return null;

    return url;
  } catch {
    return null;
  }
}

/**
 * Build a wiki URL for a page name.
 */
function wikiUrl(pageName) {
  return `https://hotwheels.fandom.com/wiki/${encodeURIComponent(pageName.replace(/\s+/g, '_'))}`;
}

/**
 * Scrape 2026 series cars from the Hot Wheels Wiki.
 *
 * Logic:
 *   1. Parse "List of 2026 Hot Wheels" page
 *   2. Extract car entries with series info from wikitext table
 *   3. Deduplicate by pageName within each series
 *   4. Resolve images for each car
 *   5. Group by series and return structured data
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {string|null} [preParsedWikitext] - Pre-parsed wikitext from releases scraper (avoids re-fetching)
 * @returns {Promise<{seriesList: Array<{seriesId: string, seriesName: string, year: number, carCount: number, cars: Array<{name: string, image: string|null, url: string}>}>, totalCount: number}>}
 */
async function scrapeSeriesCars(wikiClient, preParsedWikitext) {
  const year = 2026;
  console.log(`\n🏎️ Fetching ${year} cars by series...`);

  let wikitext = preParsedWikitext || null;

  // If no pre-parsed wikitext, fetch from wiki
  if (!wikitext) {
    let parsed = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        parsed = await wikiClient.parsePage(`List of ${year} Hot Wheels`);
        if (parsed) break;
      } catch (err) {
        console.log(`  ⚠ Parse attempt ${attempt + 1} error: ${err.message}`);
      }
      if (attempt < 2) {
        const waitMs = (attempt + 1) * 3000;
        console.log(`  ⚠ Retry ${attempt + 1}/3, waiting ${waitMs}ms...`);
        await new Promise(r => setTimeout(r, waitMs));
      }
    }
    if (!parsed) {
      console.log(`  ⚠ List page not found for ${year} after retries`);
      return { seriesList: [], totalCount: 0 };
    }
    wikitext = parsed.wikitext?.['*'] || '';
  } else {
    console.log(`  ♻️ Using pre-parsed wikitext from releases scraper`);
  }

  // Extract raw car entries with series info
  let rawCars = parseSeriesFromWikitext(wikitext);
  console.log(`  Found ${rawCars.length} raw car entries`);

  // If wikitext parsing didn't extract series well, fall back to page-based approach
  if (rawCars.length < 10 || rawCars.filter(c => c.series !== 'Other').length < 3) {
    console.log('  ⚠ Series extraction from wikitext insufficient, trying HTML parse...');
    rawCars = await parseFromHtmlFallback(wikiClient, parsed, year);
    console.log(`  HTML fallback found ${rawCars.length} entries`);
  }

  // Deduplicate
  const uniqueCars = deduplicateCars(rawCars);
  console.log(`  After dedup: ${uniqueCars.length} unique cars`);

  // Group by series
  const seriesMap = new Map();
  for (const car of uniqueCars) {
    const series = car.series || 'Other';
    if (!seriesMap.has(series)) {
      seriesMap.set(series, []);
    }
    seriesMap.get(series).push(car);
  }

  // Sort series by car count (descending), limit
  const sortedSeries = [...seriesMap.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MAX_SERIES);

  // Resolve images and build output
  const seriesList = [];
  let totalCount = 0;

  for (const [seriesName, cars] of sortedSeries) {
    const resolvedCars = [];
    let processed = 0;

    for (const car of cars) {
      if (processed >= MAX_CARS_PER_SERIES) break;

      const image = await resolveImage(wikiClient, car.imgFile);
      resolvedCars.push({
        name: car.name,
        image,
        url: wikiUrl(car.pageName)
      });
      processed++;
    }

    // Only include series with at least 2 cars
    if (resolvedCars.length < 2) continue;

    // Skip generic/uninformative series names
    const skipPatterns = /^(\d|Hot Wheels|other|misc)/i;
    if (skipPatterns.test(seriesName) && resolvedCars.length < 5) continue;

    const seriesId = seriesName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');

    seriesList.push({
      seriesId: seriesId || 'other',
      seriesName,
      year,
      carCount: resolvedCars.length,
      cars: resolvedCars
    });

    totalCount += resolvedCars.length;
    console.log(`  📦 ${seriesName}: ${resolvedCars.length} cars`);
  }

  console.log(`  🏁 ${seriesList.length} series, ${totalCount} total cars`);
  return { seriesList, totalCount };
}

/**
 * HTML-based fallback parser when wikitext series extraction fails.
 * Uses the rendered HTML from parsePage to find series groupings.
 *
 * @param {import('../wiki-client')} wikiClient
 * @param {Object} parsed - Parsed page data
 * @param {number} year
 * @returns {Promise<Array>}
 */
async function parseFromHtmlFallback(wikiClient, parsed, year) {
  const { parse: htmlParse } = require('node-html-parser');
  const html = parsed.text?.['*'] || '';
  const wikitext = parsed.wikitext?.['*'] || '';
  const cars = [];

  // Try to extract from rendered HTML tables
  try {
    const root = htmlParse(html);
    const tables = root.querySelectorAll('table.wikitable, table.sortable, table');

    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      if (rows.length < 3) continue;

      // Try to determine column indices from header row
      const headerRow = rows[0];
      const headers = headerRow.querySelectorAll('th');
      let seriesCol = -1;
      let nameCol = -1;
      let imgCol = -1;

      for (let i = 0; i < headers.length; i++) {
        const text = headers[i].textContent?.toLowerCase().trim() || '';
        if (text.includes('series') || text === 'series') seriesCol = i;
        if (text.includes('casting') || text.includes('model') || text.includes('name')) nameCol = i;
        if (text.includes('photo') || text.includes('image') || text.includes('picture')) imgCol = i;
      }

      // Default column order: Toy#, Series, Casting, ..., Photo
      if (seriesCol === -1) seriesCol = 1;
      if (nameCol === -1) nameCol = 2;
      if (imgCol === -1) imgCol = headers.length - 1;

      for (let r = 1; r < rows.length; r++) {
        const tds = rows[r].querySelectorAll('td');
        if (tds.length < 3) continue;

        // Extract series
        let series = tds[seriesCol]?.textContent?.trim() || 'Other';
        // Clean wiki markup from series
        series = series.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').trim();

        // Extract car name from link
        const nameCell = tds[nameCol] || tds[2];
        const linkEl = nameCell?.querySelector('a');
        let name = linkEl?.textContent?.trim() || nameCell?.textContent?.trim() || '';
        let pageName = linkEl?.getAttribute('href')?.replace('/wiki/', '') || '';

        if (!name || name.length <= 1) continue;
        if (name.startsWith('!') || name.startsWith('Toy')) continue;

        // URL-decode the page name
        try { pageName = decodeURIComponent(pageName); } catch {}

        // Extract image from File: references in wikitext for this row
        let imgFile = null;
        if (imgCol >= 0 && imgCol < tds.length) {
          const imgEl = tds[imgCol]?.querySelector('img');
          // We'll resolve via wikitext File: refs instead
        }

        // Find image file from wikitext by searching near the car name
        const namePattern = pageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const rowPattern = new RegExp(`${namePattern}[\\s\\S]{0,500}?File:([^\\]|&\\n]+)`, 'i');
        const fileMatch = wikitext.match(rowPattern);
        if (fileMatch) imgFile = fileMatch[1].trim();

        if (!pageName) pageName = name;

        cars.push({ name, pageName, series, imgFile });
      }
    }
  } catch (err) {
    console.log(`  ⚠ HTML fallback parse error: ${err.message}`);
  }

  return cars;
}

module.exports = { scrapeSeriesCars, parseSeriesFromWikitext };
