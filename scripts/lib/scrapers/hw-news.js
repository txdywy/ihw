/**
 * HWheadline.com news scraper module.
 * Fetches latest Hot Wheels product news from hwheadline.com.
 * Covers: mainline cases, Premium/Car Culture, RLC, STH, Monster Trucks, exclusives, etc.
 */

const { parse: htmlParse } = require('node-html-parser');

const HW_HEADLINE_URL = 'https://hwheadline.com/';

/**
 * Fetch and parse the hwheadline.com homepage for latest news articles.
 * 
 * @param {Function} httpGet - HTTP GET function (from wiki-client or standalone)
 * @returns {Promise<Array<{id: string, title: string, summary: string, category: string, date: string, url: string, image: string|null, source: string}>>}
 */
async function scrapeHWHeadline(httpGet) {
  console.log('\n📰 Fetching HWheadline news...');
  const articles = [];

  try {
    const { status, body } = await httpGet(HW_HEADLINE_URL);
    if (status !== 200) {
      console.log(`  ⚠ HWheadline returned HTTP ${status}`);
      return articles;
    }

    const root = htmlParse(body);

    // Find article entries - hwheadline uses article/post cards
    // Based on the fetched HTML structure, articles have category, title, and summary
    const postElements = root.querySelectorAll('article, .post-card, .entry, [class*="post"]');
    
    // Fallback: parse from the text structure we observed
    // The site has a pattern of: category -> title -> summary for each article
    const links = root.querySelectorAll('a[href*="hwheadline.com/"]');
    const seen = new Set();

    for (const link of links) {
      const href = link.getAttribute('href');
      if (!href || seen.has(href)) continue;
      if (href === HW_HEADLINE_URL || href.endsWith('/about/') || href.endsWith('/faq/')) continue;
      if (href.includes('/tag/') || href.includes('/category/') || href.includes('/page/')) continue;

      // Get the article title from the link text or nearby heading
      const titleEl = link.querySelector('h2, h3, h4') || link;
      const title = titleEl.textContent?.trim();
      if (!title || title.length < 5) continue;

      seen.add(href);

      // Try to find category from parent or sibling elements
      let category = '';
      const parent = link.parentNode;
      if (parent) {
        const catEl = parent.querySelector('[class*="category"], [class*="tag"], span');
        if (catEl) category = catEl.textContent?.trim() || '';
      }

      // Try to find summary/excerpt
      let summary = '';
      const descEl = parent?.querySelector('p, [class*="excerpt"], [class*="summary"]');
      if (descEl) summary = descEl.textContent?.trim() || '';

      // Try to find image
      let image = null;
      const imgEl = parent?.querySelector('img') || link.querySelector('img');
      if (imgEl) {
        image = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || null;
      }

      // Determine category from URL path or content
      if (!category) {
        if (href.includes('treasure-hunt') || href.includes('t-hunt')) category = 'Treasure Hunts';
        else if (href.includes('red-line-club') || href.includes('rlc')) category = 'Red Line Club';
        else if (href.includes('premium') || href.includes('car-culture')) category = 'Premium';
        else if (href.includes('mainline') || href.includes('case-')) category = 'Mainlines';
        else if (href.includes('monster-truck')) category = 'Monster Trucks';
        else if (href.includes('exclusive')) category = 'Exclusives';
        else category = 'Hot Wheels News';
      }

      articles.push({
        id: `hw_${Buffer.from(href).toString('base64url').slice(0, 16)}`,
        title,
        summary: summary || title,
        category,
        date: new Date().toISOString().split('T')[0],
        url: href,
        image,
        source: 'HWheadline'
      });

      if (articles.length >= 20) break;
    }

    console.log(`  ✅ HWheadline: ${articles.length} articles`);
  } catch (err) {
    console.error(`  ⚠ HWheadline scrape failed: ${err.message}`);
  }

  return articles;
}

module.exports = { scrapeHWHeadline };
