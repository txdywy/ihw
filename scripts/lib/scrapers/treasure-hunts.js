/**
 * Treasure Hunts scraper module.
 * Fetches Super Treasure Hunt (STH) data from hwtreasure.com and Fandom Wiki.
 */

const { parse: htmlParse } = require('node-html-parser');

const STH_URL = 'https://www.hwtreasure.com/2026-super/';
const TH_URL = 'https://www.hwtreasure.com/2026-2/';

/**
 * Parse the hwtreasure.com Super Treasure Hunt list page.
 * 
 * @param {Function} httpGet - HTTP GET function
 * @param {number} year - Year to scrape (used for URL construction)
 * @returns {Promise<Array<{id: string, name: string, year: number, mix: string|null, toyNumber: string|null, description: string, image: string|null, url: string, type: 'super'|'regular'}>>}
 */
async function scrapeSuperTreasureHunts(httpGet, year) {
  const currentYear = year || new Date().getFullYear();
  const url = `https://www.hwtreasure.com/${currentYear}-super/`;
  
  console.log(`\n💎 Fetching ${currentYear} Super Treasure Hunts...`);
  const results = [];

  try {
    const { status, body } = await httpGet(url);
    if (status !== 200) {
      console.log(`  ⚠ hwtreasure.com returned HTTP ${status}`);
      return results;
    }

    const root = htmlParse(body);

    // The page has article/entry blocks with car name, mix, description, and image
    // Structure observed: heading with car name (Mix X), paragraph with description, image
    const articles = root.querySelectorAll('article, .entry-content > div, .wp-block-group');
    
    // Fallback: parse from text patterns we observed
    // Pattern: "Car Name (Mix X)\nJJMxx is .../250 in the mainline set..."
    const headings = root.querySelectorAll('h2, h3, .entry-title');
    const links = root.querySelectorAll('a[href*="hwtreasure.com/' + currentYear + '-super/"]');

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || href === url) continue;

      const titleText = link.textContent?.trim();
      if (!titleText || titleText.length < 3) continue;

      // Parse "Car Name (Mix X)" pattern
      const mixMatch = titleText.match(/\(Mix\s+([A-Z])\)/i);
      const mix = mixMatch ? mixMatch[1] : null;
      const name = titleText.replace(/\s*\(Mix\s+[A-Z]\)\s*/i, '').trim();

      if (!name) continue;

      // Try to find description from sibling/parent
      let description = '';
      const parent = link.closest('div, article, section');
      if (parent) {
        const pEl = parent.querySelector('p');
        if (pEl) description = pEl.textContent?.trim() || '';
      }

      // Try to find image
      let image = null;
      if (parent) {
        const imgEl = parent.querySelector('img');
        if (imgEl) {
          image = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || null;
        }
      }

      // Extract toy number from description
      const toyMatch = description.match(/(JJM\d+)/i);
      const toyNumber = toyMatch ? toyMatch[1] : null;

      results.push({
        id: `sth_${currentYear}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        name,
        year: currentYear,
        mix: mix ? `Mix ${mix}` : null,
        toyNumber,
        description: description || `${name} - ${currentYear} Super Treasure Hunt`,
        image,
        url: href,
        type: 'super'
      });
    }

    // If link-based parsing didn't work well, try text-based parsing
    if (results.length === 0) {
      const bodyText = root.textContent || '';
      const entries = bodyText.split(/(?=\w[^(]*\(Mix [A-Z]\))/);
      
      for (const entry of entries) {
        const match = entry.match(/^(.+?)\s*\(Mix\s+([A-Z])\)\s*(.*)/s);
        if (!match) continue;
        
        const name = match[1].trim();
        const mix = match[2];
        const desc = match[3]?.split('\n')[0]?.trim() || '';
        
        if (name.length < 3 || name.length > 60) continue;

        const toyMatch = desc.match(/(JJM\d+)/i);

        results.push({
          id: `sth_${currentYear}_${name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
          name,
          year: currentYear,
          mix: `Mix ${mix}`,
          toyNumber: toyMatch ? toyMatch[1] : null,
          description: desc || `${name} - ${currentYear} Super Treasure Hunt`,
          image: null,
          url: `${url}${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-+$/, '')}/`,
          type: 'super'
        });
      }
    }

    console.log(`  ✅ Super Treasure Hunts: ${results.length}`);
  } catch (err) {
    console.error(`  ⚠ STH scrape failed: ${err.message}`);
  }

  return results;
}

/**
 * Scrape RLC releases from Fandom Wiki.
 * 
 * @param {import('../wiki-client')} wikiClient
 * @returns {Promise<Array<{id: string, name: string, year: number, color: string|null, saleDate: string|null, image: string|null, url: string}>>}
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
    
    // Parse the table rows for RLC releases
    // Format: | ToyNumber | Series | Casting | Color | Tampo | Wheel | Date | Qty | Photo
    const rows = wt.split('\n|-');
    
    for (const row of rows) {
      const cells = row.split('\n|').filter(c => c.trim());
      if (cells.length < 4) continue;

      // Look for casting name (usually has a wiki link)
      let castingName = null;
      let color = null;
      let saleDate = null;
      let toyNumber = null;

      for (const cell of cells) {
        // Casting name - wiki link
        if (!castingName && cell.includes('[[') && !cell.includes('File:')) {
          const linkMatch = cell.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
          if (linkMatch) {
            castingName = (linkMatch[2] || linkMatch[1]).trim();
          }
        }
        // Color - contains "Spectraflame" or color keywords
        if (!color && /spectraflame|pearl|gloss/i.test(cell)) {
          color = cell.trim().replace(/^\|\s*/, '');
        }
        // Sale date - matches date pattern
        if (!saleDate) {
          const dateMatch = cell.match(/(\d{1,2}\s+\w+\s+\d{4})/);
          if (dateMatch) saleDate = dateMatch[1];
        }
        // Toy number
        if (!toyNumber) {
          const toyMatch = cell.match(/([A-Z]{2,3}\d{2,3})/);
          if (toyMatch && !castingName) toyNumber = toyMatch[1];
        }
      }

      if (!castingName) continue;
      if (castingName.includes('Series') || castingName.includes('Membership')) continue;

      results.push({
        id: `rlc_${currentYear}_${castingName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
        name: castingName,
        year: currentYear,
        color: color || null,
        saleDate: saleDate || null,
        image: null, // Will be enriched later if needed
        url: `https://hotwheels.fandom.com/wiki/${currentYear}_HWC/RLC_Releases`
      });
    }

    console.log(`  ✅ RLC releases: ${results.length}`);
  } catch (err) {
    console.error(`  ⚠ RLC scrape failed: ${err.message}`);
  }

  return results;
}

module.exports = { scrapeSuperTreasureHunts, scrapeRLCReleases };
