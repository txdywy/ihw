#!/usr/bin/env node
/**
 * Hot Wheels Data Scraper
 * Fetches data from Hot Wheels Fandom Wiki API and web sources
 * Outputs JSON files to _data/ for the static site
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { parse: htmlParse } = require('node-html-parser');

const DATA_DIR = path.join(__dirname, '..', '_data');
const IMAGES_DIR = path.join(__dirname, '..', 'images');
const MAX_RETRIES = 3;
const DELAY_MS = 1500;
const userAgent = 'Mozilla/5.0 (compatible; HotWheelsHub/1.0; +https://github.com/txdywy/ihw)';

// ── Helpers ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function httpGet(url, retries = MAX_RETRIES) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { headers: { 'User-Agent': userAgent }, timeout: 20000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location, retries).then(resolve, reject);
      }
      if (res.statusCode === 429 && retries > 0) {
        const wait = parseInt(res.headers['retry-after'] || '5', 10) * 1000;
        console.warn(`  ⏳ Rate limited, waiting ${wait}ms...`);
        return sleep(wait).then(() => httpGet(url, retries - 1).then(resolve, reject));
      }
      if (res.statusCode >= 500 && retries > 0) {
        return sleep(3000).then(() => httpGet(url, retries - 1).then(resolve, reject));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf-8') }));
      res.on('error', reject);
    });
    req.on('error', err => retries > 0 ? sleep(2000).then(() => httpGet(url, retries - 1).then(resolve, reject)) : reject(err));
    req.on('timeout', () => { req.destroy(); retries > 0 ? sleep(2000).then(() => httpGet(url, retries - 1).then(resolve, reject)) : reject(new Error('timeout')); });
  });
}

async function fetchJSON(url) {
  const { status, body } = await httpGet(url);
  if (status !== 200) throw new Error(`HTTP ${status}: ${url.substring(0, 80)}`);
  return JSON.parse(body);
}

function stripHtml(str) {
  return str.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
}

function truncate(str, max = 300) {
  if (!str || str.length <= max) return str || '';
  return str.substring(0, max).replace(/\s+\S*$/, '') + '...';
}

function esc(str) { return str || ''; }

// ── Wiki API ────────────────────────────────────────────────────────────────

const WIKI_API = 'https://hotwheels.fandom.com/api.php';

function wikiUrl(params) {
  const sp = new URLSearchParams({ format: 'json', ...params });
  return `${WIKI_API}?${sp.toString()}`;
}

async function wikiQuery(params) {
  const items = [];
  let cont = {};
  let safety = 0;
  do {
    const url = wikiUrl({ action: 'query', ...params, ...cont });
    const data = await fetchJSON(url);
    await sleep(DELAY_MS);
    const result = data.query || {};
    for (const key of Object.keys(result)) {
      if (Array.isArray(result[key])) items.push(...result[key]);
    }
    cont = data.continue || {};
    safety++;
  } while (Object.keys(cont).length > 0 && safety < 20);
  return items;
}

async function wikiCategoryMembers(category, limit = 50) {
  return wikiQuery({
    list: 'categorymembers', cmtitle: `Category:${category}`,
    cmlimit: String(limit), cmtype: 'page', cmsort: 'timestamp', cmdir: 'desc'
  });
}

async function wikiParsePage(pageIdOrTitle) {
  try {
    const param = typeof pageIdOrTitle === 'number'
      ? { pageid: String(pageIdOrTitle) }
      : { page: pageIdOrTitle };
    const data = await fetchJSON(wikiUrl({ action: 'parse', ...param, prop: 'wikitext|text|images|categories' }));
    await sleep(DELAY_MS);
    return data.parse || null;
  } catch { return null; }
}

async function wikiSearch(query, limit = 10) {
  try {
    const data = await fetchJSON(wikiUrl({ action: 'query', list: 'search', srsearch: query, srlimit: String(limit), srnamespace: '0' }));
    await sleep(DELAY_MS);
    return data.query?.search || [];
  } catch { return []; }
}

async function wikiImageInfo(filename) {
  try {
    const data = await fetchJSON(wikiUrl({ action: 'query', titles: `File:${filename}`, prop: 'imageinfo', iiprop: 'url|size', iiurlwidth: '600' }));
    await sleep(DELAY_MS);
    const pages = Object.values(data.query?.pages || {});
    return pages[0]?.imageinfo?.[0] || null;
  } catch { return null; }
}

// ── Featured Cars ───────────────────────────────────────────────────────────

const FEATURED_CASTINGS = [
  'Twin Mill', 'Bone Shaker', 'Deora II', 'Rodger Dodger',
  'Custom Barracuda', 'Red Baron', 'Splittin Image', 'Rigor Motor',
  'Sharkruiser', 'Bad to the Blade', 'Fast Fish', 'Bump Around',
  'Phantom Racer', 'Power Rocket', 'Nerve Hammer', 'Vairy 8',
  'Mach Speeder', 'Veloci-Racer', 'Turbo Flame', 'Ardent'
];

// ── Data Extraction ─────────────────────────────────────────────────────────

function extractInfobox(wikitext) {
  const info = {};
  if (!wikitext) return info;
  // Hot Wheels wiki uses {{casting|...}} or {{Infobox_Car|...}} or {{Casting|...}}
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

function extractFirstImage(wikitext) {
  const m = wikitext?.match(/\[\[(File|Image):([^\]|]+)/i);
  return m ? m[2].trim() : null;
}

function extractDescription(wikitext) {
  if (!wikitext) return '';
  // Get text after the infobox, before the first section
  let body = wikitext.replace(/\{\{[^}]*(\{\{[^}]*\})*[^}]*\}\}/g, '');
  body = body.replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2');
  body = body.replace(/'{2,}/g, '').replace(/<ref[^>]*>.*?<\/ref>/gi, '').replace(/<ref[^\/]*\/>/gi, '');
  body = body.replace(/\s+/g, ' ').trim();
  const sentences = body.split(/[.!?]+/).filter(s => s.trim().length > 15);
  return truncate(sentences.slice(0, 3).join('. ').trim(), 400);
}

function extractYear(info, wikitext, title) {
  const fields = ['year', 'years', 'firstyear', 'yearreleased', 'released'];
  for (const f of fields) {
    if (info[f]) { const m = info[f].match(/(\d{4})/); if (m) return parseInt(m[1]); }
  }
  const m = title?.match(/(\d{4})/);
  return m ? parseInt(m[1]) : null;
}

function extractSeries(info, categories) {
  const s = info.series || info.segment || info['sub-series'] || info.collection;
  if (s) return s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/\{\{[^}]*\}\}/g, '').replace(/'{2,}/g, '').trim();
  for (const cat of (categories || [])) {
    const catName = cat['*'] || cat.title || (typeof cat === 'string' ? cat : '');
    if (!catName) continue;
    const m = catName.match(/^Category:(.+?)(?:\s+\d{4})?$/i) || [null, catName];
    const name = m[1]?.trim();
    if (name && !/^hot\s*wheels$/i.test(name)) return name.replace(/_/g, ' ');
  }
  return null;
}

async function fetchCarData(pageId, pageTitle) {
  const parsed = await wikiParsePage(pageId);
  if (!parsed) return null;
  try {
    const wt = parsed.wikitext?.['*'] || '';
    const html = parsed.text?.['*'] || '';
    const info = extractInfobox(wt);
    const imgFile = info.image || extractFirstImage(wt) || parsed.images?.[0] || '';
    let imageUrl = null, thumbUrl = null;
    if (imgFile) {
      const imgInfo = await wikiImageInfo(imgFile);
      if (imgInfo) { imageUrl = imgInfo.url; thumbUrl = imgInfo.thumburl || imgInfo.url; }
    }
    if (!imageUrl && html) {
      const root = htmlParse(html);
      const img = root.querySelector('img[src*="static.wikia"], img[src*="nocookie"]');
      if (img) {
        const src = img.getAttribute('src');
        imageUrl = src?.split('/revision/')[0] || src;
        thumbUrl = src;
      }
    }
    const year = extractYear(info, wt, pageTitle);
    const series = extractSeries(info, parsed.categories);
    const description = extractDescription(wt) || stripHtml(html).substring(0, 400);
    return {
      id: pageTitle.replace(/\s+/g, '_').toLowerCase(),
      name: pageTitle, year, series,
      number: info.number || info.collector_number || null,
      color: info.color || info.base_color || null,
      image: thumbUrl || imageUrl,
      fullImage: imageUrl,
      description: truncate(description, 400),
      url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(pageTitle.replace(/\s+/g, '_'))}`
    };
  } catch (err) {
    console.error(`  ⚠ Error parsing ${pageTitle}: ${err.message}`);
    return null;
  }
}

// ── Scrapers ────────────────────────────────────────────────────────────────

async function scrapeFeaturedCars() {
  console.log('\n🏎  Fetching featured cars...');
  const results = [];
  for (const name of FEATURED_CASTINGS) {
    // Try direct page lookup first (most reliable for original castings)
    let candidate = null;
    try {
      const data = await fetchJSON(wikiUrl({ action: 'query', titles: name, prop: 'info', redirects: '1' }));
      await sleep(DELAY_MS);
      const pages = Object.values(data.query?.pages || {});
      const page = pages[0];
      if (page && !page.missing) {
        candidate = { pageid: page.pageid, title: page.title };
      }
    } catch {}
    // Fallback to search
    if (!candidate) {
      const search = await wikiSearch(name, 5);
      candidate = search.find(r => r.title.toLowerCase().startsWith(name.toLowerCase()) && !r.title.includes('(')) || search[0];
    }
    if (candidate) {
      console.log(`  📌 ${candidate.title}`);
      const car = await fetchCarData(candidate.pageid, candidate.title);
      if (car?.image) { results.push(car); }
      else { console.log(`    ⚠ No image`); }
    } else {
      console.log(`  ⚠ Not found: ${name}`);
    }
    if (results.length >= 12) break;
  }
  return results;
}

async function scrapeYearList(year) {
  // Parse "List of 2025 Hot Wheels" table for car names and image filenames
  console.log(`\n📅 Parsing List of ${year} Hot Wheels...`);
  const parsed = await wikiParsePage(`List of ${year} Hot Wheels`);
  if (!parsed) { console.log(`  ⚠ List page not found for ${year}`); return []; }
  const wt = parsed.wikitext?.['*'] || '';
  const cars = [];
  // Parse wikitext table rows: |col#|name|series|image
  const rows = wt.split('\n|-');
  for (const row of rows) {
    const cells = row.split('\n|').filter(c => c.trim());
    if (cells.length < 3) continue;
    // Find [[PageName|Display]] links
    const nameMatch = cells.find(c => c.includes('[[') && !c.includes('File:'));
    const fileMatch = cells.find(c => c.includes('File:'));
    if (nameMatch) {
      const linkMatch = nameMatch.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
      const title = linkMatch ? (linkMatch[2] || linkMatch[1]).trim() : stripHtml(nameMatch).trim();
      const pageName = linkMatch ? linkMatch[1].trim() : title;
      let imgFile = null;
      if (fileMatch) {
        const fm = fileMatch.match(/File:([^\]|&\n]+)/i);
        if (fm) imgFile = fm[1].trim();
      }
      if (title && title.length > 1 && !title.startsWith('!') && !title.startsWith('Toy #')) {
        cars.push({ title, pageName, imgFile });
      }
    }
  }
  console.log(`  Found ${cars.length} cars for ${year}`);
  return cars;
}

async function scrapeNewReleases() {
  console.log('\n🆕 Fetching new releases...');
  const currentYear = new Date().getFullYear();
  const allCars = [];
  for (const year of [currentYear, currentYear - 1]) {
    const listCars = await scrapeYearList(year);
    // Process first 30 unique cars per year
    const seen = new Set();
    for (const lc of listCars) {
      if (seen.has(lc.pageName) || allCars.length >= 50) continue;
      seen.add(lc.pageName);
      let imageUrl = null;
      if (lc.imgFile) {
        const imgInfo = await wikiImageInfo(lc.imgFile);
        if (imgInfo) imageUrl = imgInfo.thumburl || imgInfo.url;
      }
      if (!imageUrl) {
        // Try to find the page and get image
        const search = await wikiSearch(lc.pageName, 1);
        if (search[0]) {
          const car = await fetchCarData(search[0].pageid, search[0].title);
          if (car?.image) { imageUrl = car.image; }
        }
      }
      if (imageUrl) {
        allCars.push({
          id: lc.pageName.replace(/\s+/g, '_').toLowerCase(),
          name: lc.title, year,
          series: null, image: imageUrl, fullImage: imageUrl,
          description: `${lc.title} - ${year} Hot Wheels release`,
          url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(lc.pageName.replace(/\s+/g, '_'))}`
        });
      }
    }
  }
  return allCars;
}

async function scrapeSeries() {
  console.log('\n📦 Fetching series...');
  const series = [];
  const predefined = [
    { name: 'Mainline', id: 'mainline', desc: '风火轮核心产品线，价格亲民、广泛发售的基础车型系列' },
    { name: 'Premium', id: 'premium', desc: '高端系列，采用金属底盘、仿真轮胎和精美涂装，收藏价值更高' },
    { name: 'Car Culture', id: 'car_culture', desc: '主题化的高端系列，致敬汽车文化和车迷最爱的经典车型' },
    { name: 'Super Treasure Hunt', id: 'super_treasure_hunt', desc: '极其稀有的特别版，采用光谱漆面和仿真轮胎，是收藏者的终极目标' },
    { name: 'Monster Trucks', id: 'monster_trucks', desc: '超大尺寸的怪物卡车系列，配备巨大的轮胎，带来极致的玩耍体验' },
    { name: 'Fast & Furious', id: 'fast_furious', desc: '灵感源自《速度与激情》系列电影的经典车型' },
    { name: 'Batman', id: 'batman', desc: '蝙蝠侠主题系列，包含标志性的蝙蝠车和反派车辆' },
    { name: 'HW Art Cars', id: 'hw_art_cars', desc: '独特艺术涂装系列，在经典车型上展现创意设计' },
    { name: 'Team Transport', id: 'team_transport', desc: '大型车辆搭配配套运输拖车的组合套装系列' },
    { name: 'RLC (Red Line Club)', id: 'rlc', desc: '限量版俱乐部专属系列，拥有最高品质的细节和包装' },
    { name: 'Legends Tour', id: 'legends_tour', desc: '与年度风火轮传奇之旅活动相关的特别版系列' },
    { name: 'Ultra Hots', id: 'ultra_hots', desc: '复古主题系列，致敬风火轮黄金时代的经典设计' },
    { name: 'Boulevard', id: 'boulevard', desc: '精选高端系列，以精美涂装和仿真配件呈现经典车型' },
    { name: 'HW Screen Time', id: 'hw_screen_time', desc: '影视联名系列，收录电影、电视和游戏中的经典车辆' },
    { name: 'HW Dream Garage', id: 'hw_dream_garage', desc: '梦想车库系列，汇聚每个车迷心中的梦想之车' }
  ];
  for (const p of predefined) {
    series.push({
      id: p.id, name: p.name,
      url: `https://hotwheels.fandom.com/wiki/Hot_Wheels`,
      description: p.desc, image: null, carCount: null
    });
  }
  return series;
}

async function scrapeNews() {
  console.log('\n📰 Fetching news...');
  const articles = [];
  const today = new Date().toISOString().split('T')[0];
  const seen = new Set();

  // Source 1: Recent wiki changes
  try {
    const data = await fetchJSON(wikiUrl({
      action: 'query', list: 'recentchanges', rcnamespace: '0', rclimit: '30',
      rcprop: 'title|timestamp|comment', rctype: 'edit|new'
    }));
    await sleep(DELAY_MS);
    for (const rc of (data.query?.recentchanges || [])) {
      const t = rc.title.toLowerCase();
      if (seen.has(t)) continue;
      if (/hot\s*wheels|hw\s|casting|treasure\s*hunt/i.test(rc.title) || /car|vehicle|series|release|casting/i.test(rc.comment || '')) {
        seen.add(t);
        articles.push({
          id: `rc_${rc.revid}`, title: rc.title,
          summary: rc.comment ? stripHtml(rc.comment) : `Wiki page "${rc.title}" was recently updated`,
          date: rc.timestamp?.split('T')[0] || today,
          source: 'Hot Wheels Wiki',
          url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(rc.title.replace(/\s+/g, '_'))}`,
          image: null
        });
      }
    }
  } catch (e) { console.error('  ⚠ Recent changes:', e.message); }

  // Source 2: Search for year-specific pages
  const currentYear = new Date().getFullYear();
  const searchQueries = [
    `List of ${currentYear} Hot Wheels`,
    `${currentYear} Hot Wheels Treasure Hunts`,
    `${currentYear} Hot Wheels Boulevard`,
    `${currentYear} Hot Wheels new series`
  ];
  for (const q of searchQueries) {
    try {
      const results = await wikiSearch(q, 5);
      for (const r of results) {
        if (seen.has(r.title.toLowerCase())) continue;
        seen.add(r.title.toLowerCase());
        articles.push({
          id: `search_${r.pageid}`, title: r.title,
          summary: truncate(stripHtml(r.snippet || ''), 300) || `Latest Hot Wheels information: ${r.title}`,
          date: (r.timestamp || today).split('T')[0],
          source: 'Hot Wheels Wiki',
          url: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(r.title.replace(/\s+/g, '_'))}`,
          image: null
        });
      }
    } catch {}
  }

  // Enrich first 12 articles with images
  for (const article of articles.slice(0, 12)) {
    try {
      const results = await wikiSearch(article.title.replace(/^Updated:\s*/, ''), 1);
      if (results[0]) {
        const parsed = await wikiParsePage(results[0].pageid);
        if (parsed) {
          const wt = parsed.wikitext?.['*'] || '';
          const info = extractInfobox(wt);
          const imgFile = info.image || extractFirstImage(wt) || parsed.images?.[0];
          if (imgFile) {
            const imgInfo = await wikiImageInfo(imgFile);
            if (imgInfo) article.image = imgInfo.thumburl || imgInfo.url;
          }
        }
      }
    } catch {}
  }

  return articles;
}

async function scrapeReleases() {
  console.log('\n📋 Fetching release lists...');
  const currentYear = new Date().getFullYear();
  const releases = [];
  for (const year of [currentYear, currentYear - 1]) {
    try {
      const listCars = await scrapeYearList(year);
      // Group by series (extract from page if possible)
      const seriesGroups = {};
      // For now group as "Mainline YYYY"
      for (const car of listCars.slice(0, 50)) {
        const series = 'Mainline';
        if (!seriesGroups[series]) seriesGroups[series] = [];
        let imageUrl = null;
        if (car.imgFile) {
          const imgInfo = await wikiImageInfo(car.imgFile);
          if (imgInfo) imageUrl = imgInfo.thumburl || imgInfo.url;
        }
        seriesGroups[series].push({ name: car.title, image: imageUrl });
      }
      for (const [series, cars] of Object.entries(seriesGroups)) {
        releases.push({
          year, series,
          id: `${year}_${series.replace(/\s+/g, '_').toLowerCase()}`,
          description: `${year}年 ${series} 系列新车`,
          cars: cars.slice(0, 12),
          url: `https://hotwheels.fandom.com/wiki/List_of_${year}_Hot_Wheels`
        });
      }
    } catch (e) { console.error(`  ⚠ Releases ${year}:`, e.message); }
  }
  return releases;
}

async function scrapeGallery() {
  console.log('\n🖼  Fetching gallery images...');
  const images = [];
  const seen = new Set();

  // Get cars from category
  const members = await wikiCategoryMembers('Hot_Wheels_Original_Designs', 50);
  console.log(`  📁 Original Designs: ${members.length} pages`);

  for (const m of members.slice(0, 35)) {
    if (seen.has(m.pageid)) continue;
    seen.add(m.pageid);
    try {
      const parsed = await wikiParsePage(m.pageid);
      if (!parsed) continue;
      const wt = parsed.wikitext?.['*'] || '';
      const info = extractInfobox(wt);
      const imgFile = info.image || extractFirstImage(wt) || parsed.images?.[0] || '';
      if (imgFile) {
        const imgInfo = await wikiImageInfo(imgFile);
        if (imgInfo) {
          images.push({
            id: `img_${m.pageid}`, title: m.title,
            url: imgInfo.thumburl || imgInfo.url,
            fullUrl: imgInfo.url,
            width: imgInfo.thumbwidth || imgInfo.width,
            height: imgInfo.thumbheight || imgInfo.height,
            source: 'Hot Wheels Wiki',
            carUrl: `https://hotwheels.fandom.com/wiki/${encodeURIComponent(m.title.replace(/\s+/g, '_'))}`
          });
        }
      }
    } catch {}
  }
  return images;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🔥 Hot Wheels Data Scraper Starting...');
  console.log(`   Time: ${new Date().toISOString()}\n`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(IMAGES_DIR, { recursive: true });

  let featured = [], series = [], news = [], releases = [], gallery = [];

  try { featured = await scrapeFeaturedCars(); } catch (e) { console.error('Featured failed:', e.message); }
  try { series = await scrapeSeries(); } catch (e) { console.error('Series failed:', e.message); }
  try { news = await scrapeNews(); } catch (e) { console.error('News failed:', e.message); }
  try { releases = await scrapeReleases(); } catch (e) { console.error('Releases failed:', e.message); }
  try { gallery = await scrapeGallery(); } catch (e) { console.error('Gallery failed:', e.message); }

  // Merge featured into gallery for extra images
  for (const car of featured) {
    if (car.image && !gallery.find(g => g.title === car.name)) {
      gallery.push({
        id: `feat_${car.id}`, title: car.name,
        url: car.image, fullUrl: car.fullImage || car.image,
        width: 600, height: 400, source: 'Hot Wheels Wiki', carUrl: car.url
      });
    }
  }

  const metadata = {
    lastUpdated: new Date().toISOString(),
    sources: [
      { name: 'Hot Wheels Fandom Wiki', url: 'https://hotwheels.fandom.com', type: 'wiki' },
    ],
    stats: {
      totalFeatured: featured.length, totalSeries: series.length,
      totalNews: news.length, totalGallery: gallery.length,
      lastUpdated: new Date().toISOString()
    }
  };

  const files = {
    'featured.json': featured, 'series.json': series, 'news.json': news,
    'releases.json': releases, 'gallery.json': gallery, 'metadata.json': metadata
  };

  for (const [name, data] of Object.entries(files)) {
    fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(data, null, 2), 'utf-8');
    console.log(`  ✅ ${name}: ${Array.isArray(data) ? data.length : Object.keys(data).length} items`);
  }

  console.log(`\n✨ Done! Featured: ${featured.length} | Series: ${series.length} | News: ${news.length} | Releases: ${releases.length} | Gallery: ${gallery.length}`);
}

main().catch(err => { console.error('💥 Fatal:', err); process.exit(1); });
