/**
 * Treasure Hunts & Elite 64 scraper module.
 * Fetches 2026 Treasure Hunts, Super Treasure Hunts from the Wiki,
 * and Elite 64 series cars from the Wiki category.
 *
 * Exports:
 *   scrapeSuperTreasureHunts(wikiClient) → STH[]
 *   scrapeRegularTreasureHunts(wikiClient) → TH[]
 *   scrapeElite64(wikiClient) → Elite64[]
 *   scrapeRLCReleases(wikiClient) → RLC[]
 */

const { isPlaceholderImage, getBestImage } = require('../image-utils');

const WIKI_BASE = 'https://hotwheels.fandom.com/wiki/';

/**
 * Parse a wikitable from wikitext. Returns an array of row objects,
 * each mapping header name → cell content.
 *
 * @param {string} wikitext - Full page wikitext
 * @param {string} sectionHeader - The == header text before the table
 * @returns {Array<Object>}
 */
function parseWikiTable(wikitext, sectionHeader) {
  // Find the section
  const sectionIdx = wikitext.indexOf(sectionHeader);
  if (sectionIdx === -1) return [];

  // Find the table start after the section header
  const afterHeader = wikitext.substring(sectionIdx);
  const tableStart = afterHeader.indexOf('{|');
  if (tableStart === -1) return [];

  // Find the table end
  const tableText = afterHeader.substring(tableStart);
  const tableEnd = tableText.indexOf('\n|}');
  const table = tableEnd > 0 ? tableText.substring(0, tableEnd) : tableText;

  const rows = table.split('\n|-');
  if (rows.length < 2) return [];

  // Parse header row
  const headerRow = rows[0];
  const headers = [];
  const headerRegex = /!.*?'''([^']+)'''/g;
  let hm;
  while ((hm = headerRegex.exec(headerRow)) !== null) {
    headers.push(hm[1].replace(/<br\s*\/?>/gi, ' ').trim());
  }

  if (headers.length === 0) return [];

  // Parse data rows
  const results = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].split('\n|').filter(c => c.trim());
    if (cells.length < 2) continue;

    const row = {};
    for (let j = 0; j < Math.min(headers.length, cells.length); j++) {
      row[headers[j]] = cells[j].trim();
    }
    results.push(row);
  }

  return results;
}

/**
 * Extract car name and page name from a model name cell.
 * Handles [[Page|Display]] links and plain text.
 */
function extractCarInfo(cell) {
  if (!cell) return { name: null, pageName: null };

  const linkMatch = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (linkMatch) {
    return {
      pageName: linkMatch[1].trim(),
      name: (linkMatch[2] || linkMatch[1]).replace(/<[^>]+>/g, '').trim()
    };
  }

  const name = cell.replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
  return { name: name || null, pageName: name || null };
}

/**
 * Extract image filename from a photo cell.
 * Handles [[File:filename|...]] patterns.
 */
function extractImageFile(cell) {
  if (!cell) return null;
  const m = cell.match(/File:([^\]|&\n]+)/i);
  return m ? m[1].trim() : null;
}

/**
 * Extract series name from a series cell.
 * Handles [[SeriesPage|Display]] with optional HTML.
 */
function extractSeriesName(cell) {
  if (!cell) return null;
  const linkMatch = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (linkMatch) {
    return (linkMatch[2] || linkMatch[1]).replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim();
  }
  return cell.replace(/<[^>]+>/g, '').replace(/\{\{[^}]*\}\}/g, '').trim() || null;
}

/**
 * Build a wiki URL for a page name.
 */
function wikiUrl(pageName) {
  return `${WIKI_BASE}${encodeURIComponent(pageName.replace(/\s+/g, '_'))}`;
}

/**
 * Resolve image via wikiClient.imageInfo, filtering placeholders.
 */
async function resolveImage(wikiClient, imgFile) {
  if (!imgFile || isPlaceholderImage(imgFile)) return null;
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
 * Scrape 2026 Super Treasure Hunts from the Wiki.
 *
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<Array>}
 */
async function scrapeSuperTreasureHunts(wikiClient) {
  const year = new Date().getFullYear();
  console.log(`\n💎 Fetching ${year} Super Treasure Hunts from Wiki...`);
  const results = [];

  try {
    const parsed = await wikiClient.parsePage(`${year} Treasure Hunts Series`);
    if (!parsed) {
      console.log(`  ⚠ Page not found: ${year} Treasure Hunts Series`);
      return results;
    }

    const wt = parsed.wikitext?.['*'] || '';

    // Find the STH section (after "==2026 Super Treasure Hunts==")
    const sthHeader = 'Super Treasure Hunts==';
    const sthIdx = wt.indexOf(sthHeader);
    if (sthIdx === -1) {
      console.log('  ⚠ STH section not found');
      return results;
    }

    const sthWikitext = wt.substring(sthIdx);
    const rows = sthWikitext.split('\n|-');

    // Parse headers from first row
    const headerRow = rows[0];
    const headers = [];
    const headerRegex = /!.*?'''([^']+)'''/g;
    let hm;
    while ((hm = headerRegex.exec(headerRow)) !== null) {
      headers.push(hm[1].replace(/<br\s*\/?>/gi, ' ').trim());
    }

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].split('\n|').filter(c => c.trim());
      if (cells.length < 4) continue;

      const row = {};
      for (let j = 0; j < Math.min(headers.length, cells.length); j++) {
        row[headers[j]] = cells[j].trim();
      }

      const modelName = row['Model Name'] || '';
      const { name, pageName } = extractCarInfo(modelName);
      if (!name) continue;

      const imgFile = extractImageFile(row['Photo']);
      const seriesName = extractSeriesName(row['Series']);
      const bodyColor = (row['Body Color'] || '').replace(/\[\[|\]\]/g, '').replace(/<[^>]+>/g, '').trim();

      const image = await resolveImage(wikiClient, imgFile);

      results.push({
        id: `sth_${year}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        name,
        year,
        mix: seriesName || null,
        toyNumber: (row['Toy #'] || '').trim() || null,
        description: bodyColor ? `${name} — Spectraflame ${bodyColor}` : `${name} — ${year} Super Treasure Hunt`,
        image,
        url: pageName ? wikiUrl(pageName) : `${WIKI_BASE}${year}_Treasure_Hunts_Series`,
        type: 'super'
      });
    }

    console.log(`  ✅ Super Treasure Hunts: ${results.length} (${results.filter(r => r.image).length} with images)`);
  } catch (err) {
    console.error(`  ⚠ STH scrape failed: ${err.message}`);
  }

  return results;
}

/**
 * Scrape 2026 regular Treasure Hunts from the Wiki.
 *
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<Array>}
 */
async function scrapeRegularTreasureHunts(wikiClient) {
  const year = new Date().getFullYear();
  console.log(`\n🔥 Fetching ${year} Treasure Hunts from Wiki...`);
  const results = [];

  try {
    const parsed = await wikiClient.parsePage(`${year} Treasure Hunts Series`);
    if (!parsed) {
      console.log(`  ⚠ Page not found: ${year} Treasure Hunts Series`);
      return results;
    }

    const wt = parsed.wikitext?.['*'] || '';

    // The regular TH table is BEFORE the STH section
    const sthIdx = wt.indexOf('Super Treasure Hunts==');
    const thWikitext = sthIdx > 0 ? wt.substring(0, sthIdx) : wt;

    const rows = thWikitext.split('\n|-');

    // Parse headers
    const headerRow = rows[0];
    const headers = [];
    const headerRegex = /!.*?'''([^']+)'''/g;
    let hm;
    while ((hm = headerRegex.exec(headerRow)) !== null) {
      headers.push(hm[1].replace(/<br\s*\/?>/gi, ' ').trim());
    }

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i].split('\n|').filter(c => c.trim());
      if (cells.length < 4) continue;

      const row = {};
      for (let j = 0; j < Math.min(headers.length, cells.length); j++) {
        row[headers[j]] = cells[j].trim();
      }

      const modelName = row['Model Name'] || '';
      const { name, pageName } = extractCarInfo(modelName);
      if (!name) continue;

      const imgFile = extractImageFile(row['Photo']);
      const seriesName = extractSeriesName(row['Series']);
      const bodyColor = (row['Body Color'] || '').replace(/\[\[|\]\]/g, '').replace(/<[^>]+>/g, '').trim();

      const image = await resolveImage(wikiClient, imgFile);

      results.push({
        id: `th_${year}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        name,
        year,
        series: seriesName || null,
        toyNumber: (row['Toy #'] || '').trim() || null,
        description: bodyColor ? `${name} — ${bodyColor}` : `${name} — ${year} Treasure Hunt`,
        image,
        url: pageName ? wikiUrl(pageName) : `${WIKI_BASE}${year}_Treasure_Hunts_Series`,
        type: 'regular'
      });
    }

    console.log(`  ✅ Regular Treasure Hunts: ${results.length} (${results.filter(r => r.image).length} with images)`);
  } catch (err) {
    console.error(`  ⚠ TH scrape failed: ${err.message}`);
  }

  return results;
}

/**
 * Scrape RLC releases from Fandom Wiki with image resolution.
 *
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<Array>}
 */
async function scrapeRLCReleases(wikiClient) {
  const currentYear = new Date().getFullYear();
  console.log(`\n🏆 Fetching ${currentYear} RLC releases...`);
  const results = [];

  try {
    const parsed = await wikiClient.parsePage(`${currentYear} HWC/RLC Releases`);
    if (!parsed) {
      console.log(`  ⚠ RLC releases page not found for ${currentYear}`);
      return results;
    }

    const wt = parsed.wikitext?.['*'] || '';
    const pageImages = parsed.images || [];

    // Parse the table rows for RLC releases
    const rows = wt.split('\n|-');

    for (const row of rows) {
      const cells = row.split('\n|').filter(c => c.trim());
      if (cells.length < 4) continue;

      let castingName = null;
      let color = null;
      let saleDate = null;
      let toyNumber = null;
      let imgFile = null;

      for (const cell of cells) {
        // Casting name - wiki link
        if (!castingName && cell.includes('[[') && !cell.includes('File:')) {
          const linkMatch = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
          if (linkMatch) {
            castingName = (linkMatch[2] || linkMatch[1]).replace(/<[^>]+>/g, '').trim();
          }
        }
        // Color - contains "Spectraflame" or color keywords
        if (!color && /spectraflame|pearl|gloss/i.test(cell)) {
          color = cell.trim().replace(/^\|\s*/, '').replace(/<[^>]+>/g, '').replace(/\[\[|\]\]/g, '').trim();
        }
        // Sale date
        if (!saleDate) {
          const dateMatch = cell.match(/(\d{1,2}\s+\w+\s+\d{4})/);
          if (dateMatch) saleDate = dateMatch[1];
        }
        // Toy number
        if (!toyNumber) {
          const toyMatch = cell.match(/([A-Z]{2,3}\d{2,3})/);
          if (toyMatch && !castingName) toyNumber = toyMatch[1];
        }
        // Image file
        if (!imgFile && cell.includes('File:')) {
          const fm = cell.match(/File:([^\]|&\n]+)/i);
          if (fm) imgFile = fm[1].trim();
        }
      }

      if (!castingName) continue;
      if (castingName.includes('Series') || castingName.includes('Membership')) continue;

      // If no image file found in row, try to match from page images
      if (!imgFile) {
        const normalizedName = castingName.toLowerCase().replace(/[^a-z0-9]/g, '');
        imgFile = pageImages.find(img => {
          const normalizedImg = img.toLowerCase().replace(/[^a-z0-9]/g, '');
          return normalizedImg.includes(normalizedName.substring(0, 10));
        }) || null;
      }

      const image = await resolveImage(wikiClient, imgFile);

      results.push({
        id: `rlc_${currentYear}_${castingName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        name: castingName,
        year: currentYear,
        color: color || null,
        saleDate: saleDate || null,
        image,
        url: `${WIKI_BASE}${currentYear}_HWC/RLC_Releases`
      });
    }

    console.log(`  ✅ RLC releases: ${results.length} (${results.filter(r => r.image).length} with images)`);
  } catch (err) {
    console.error(`  ⚠ RLC scrape failed: ${err.message}`);
  }

  return results;
}

/**
 * Scrape Elite 64 series cars from the Wiki category.
 *
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<Array>}
 */
async function scrapeElite64(wikiClient) {
  console.log('\n🏅 Fetching Elite 64 series...');
  const results = [];

  try {
    const members = await wikiClient.categoryMembers('Elite_64', 40);
    console.log(`  Found ${members.length} category members`);

    for (const member of members) {
      // Skip the category page itself
      if (member.title === 'Elite 64') continue;

      try {
        const parsed = await wikiClient.parsePage(member.pageid || member.title);
        if (!parsed) continue;

        // Get best image
        const imageResult = await getBestImage(parsed, wikiClient);
        const image = imageResult?.thumbUrl || null;

        // Extract year from page content
        const wt = parsed.wikitext?.['*'] || '';
        const yearMatch = wt.match(/year[s]?\s*=\s*(\d{4})/i) || wt.match(/firstyear\s*=\s*(\d{4})/i);
        const year = yearMatch ? parseInt(yearMatch[1]) : null;

        // Extract color from infobox
        const colorMatch = wt.match(/\|\s*(?:color|base_color|body_color)\s*=\s*(.+)/i);
        const color = colorMatch ? colorMatch[1].trim().replace(/\[\[|\]\]/g, '').replace(/<[^>]+>/g, '') : null;

        results.push({
          id: `e64_${member.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
          name: member.title,
          year,
          color: color || null,
          image,
          url: wikiUrl(member.title)
        });

        console.log(`  ✅ ${member.title}${image ? ' (with image)' : ''}`);
      } catch (err) {
        console.log(`  ⚠ Error: ${member.title}: ${err.message}`);
      }
    }

    console.log(`  🏁 Elite 64: ${results.length} (${results.filter(r => r.image).length} with images)`);
  } catch (err) {
    console.error(`  ⚠ Elite 64 scrape failed: ${err.message}`);
  }

  return results;
}

module.exports = {
  scrapeSuperTreasureHunts,
  scrapeRegularTreasureHunts,
  scrapeRLCReleases,
  scrapeElite64
};
