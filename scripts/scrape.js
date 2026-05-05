#!/usr/bin/env node
/**
 * Hot Wheels Data Scraper — Orchestration Entry Point
 *
 * Creates a shared WikiClient, calls each scraper module in sequence,
 * merges featured cars into gallery, and writes all JSON output files.
 */

const fs = require('fs');
const path = require('path');

const WikiClient = require('./lib/wiki-client');
const { safeWriteJSON } = require('./lib/safe-writer');
const { scrapeFeatured } = require('./lib/scrapers/featured');
const { scrapeReleases } = require('./lib/scrapers/releases');
const { scrapeSeries } = require('./lib/scrapers/series');
const { scrapeNews } = require('./lib/scrapers/news');
const { scrapeGallery } = require('./lib/scrapers/gallery');
const { scrapeNewCastings } = require('./lib/scrapers/new-castings');
const { scrapeHWHeadline } = require('./lib/scrapers/hw-news');
const { scrapeSuperTreasureHunts, scrapeRegularTreasureHunts, scrapeRLCReleases, scrapeElite64 } = require('./lib/scrapers/treasure-hunts');
const { scrapeSeriesCars } = require('./lib/scrapers/series-cars');

const DATA_DIR = path.join(__dirname, '..', '_data');

async function main() {
  const startTime = Date.now();
  console.log('🔥 Hot Wheels Data Scraper Starting...');
  console.log(`   Time: ${new Date().toISOString()}\n`);

  fs.mkdirSync(DATA_DIR, { recursive: true });

  const wikiClient = new WikiClient();

  // Run each scraper in sequence
  let featured = [];
  let releases = [];
  let newReleases = [];
  let series = [];
  let news = [];
  let gallery = [];
  let newCastings = [];
  let hwNews = [];
  let treasureHunts = [];
  let regularTH = [];
  let rlcReleases = [];
  let elite64 = [];
  let seriesCars = { seriesList: [], totalCount: 0 };

  try { featured = await scrapeFeatured(wikiClient); } catch (e) { console.error('Featured failed:', e.message); }
  let parsed2026Wikitext = null;
  try {
    const result = await scrapeReleases(wikiClient);
    releases = result.releases;
    newReleases = result.newReleases;
    parsed2026Wikitext = result.parsed2026Wikitext || null;
  } catch (e) { console.error('Releases failed:', e.message); }
  try { series = await scrapeSeries(wikiClient); } catch (e) { console.error('Series failed:', e.message); }
  try { news = await scrapeNews(wikiClient); } catch (e) { console.error('News failed:', e.message); }
  try { gallery = await scrapeGallery(wikiClient); } catch (e) { console.error('Gallery failed:', e.message); }
  try { newCastings = await scrapeNewCastings(wikiClient); } catch (e) { console.error('New Castings failed:', e.message); }
  
  // New sources: HWheadline news and Treasure Hunts
  try { hwNews = await scrapeHWHeadline(wikiClient._httpGet.bind(wikiClient)); } catch (e) { console.error('HW News failed:', e.message); }
  try { treasureHunts = await scrapeSuperTreasureHunts(wikiClient); } catch (e) { console.error('Treasure Hunts failed:', e.message); }
  try { rlcReleases = await scrapeRLCReleases(wikiClient); } catch (e) { console.error('RLC Releases failed:', e.message); }
  try { regularTH = await scrapeRegularTreasureHunts(wikiClient); } catch (e) { console.error('Regular TH failed:', e.message); }
  try { elite64 = await scrapeElite64(wikiClient); } catch (e) { console.error('Elite 64 failed:', e.message); }

  // Series cars: per-series 2026 new releases (reuse pre-parsed wikitext from releases)
  try { seriesCars = await scrapeSeriesCars(wikiClient, parsed2026Wikitext); } catch (e) { console.error('Series Cars failed:', e.message); }

  // Merge regular TH into treasureHunts
  treasureHunts = [...treasureHunts, ...regularTH];

  // Fatal failure: all categories returned empty
  if (
    featured.length === 0 &&
    releases.length === 0 &&
    series.length === 0 &&
    news.length === 0 &&
    gallery.length === 0 &&
    newCastings.length === 0
  ) {
    console.error('💥 Fatal: all categories returned empty arrays');
    process.exit(1);
  }

  // Merge featured cars into gallery (add featured cars not already in gallery)
  for (const car of featured) {
    if (car.image && !gallery.find(g => g.title === car.name)) {
      gallery.push({
        id: `feat_${car.id}`,
        title: car.name,
        url: car.image,
        fullUrl: car.fullImage || car.image,
        width: 600,
        height: 400,
        source: 'Hot Wheels Wiki',
        carUrl: car.url
      });
    }
  }

  // Build metadata
  const runTimeMs = Date.now() - startTime;
  const stats = wikiClient.getStats();

  const metadata = {
    lastUpdated: new Date().toISOString(),
    sources: [
      { name: 'Hot Wheels Fandom Wiki', url: 'https://hotwheels.fandom.com', type: 'wiki' },
      { name: 'HWheadline', url: 'https://hwheadline.com', type: 'news' },
      { name: 'HW Treasure', url: 'https://www.hwtreasure.com', type: 'reference' }
    ],
    stats: {
      totalFeatured: featured.length,
      totalSeries: series.length,
      totalNews: news.length + hwNews.length,
      totalGallery: gallery.length,
      totalNewCastings: newCastings.length,
      totalTreasureHunts: treasureHunts.length,
      totalRLC: rlcReleases.length,
      totalElite64: elite64.length,
      totalSeriesCars: seriesCars.totalCount,
      totalSeriesWithCars: seriesCars.seriesList.length,
      lastUpdated: new Date().toISOString(),
      totalRequests: stats.totalRequests,
      runTimeMs
    }
  };

  // Write all JSON files using safe writer
  safeWriteJSON(path.join(DATA_DIR, 'featured.json'), featured, 'featured');
  safeWriteJSON(path.join(DATA_DIR, 'releases.json'), releases, 'releases');
  safeWriteJSON(path.join(DATA_DIR, 'series.json'), series, 'series');
  safeWriteJSON(path.join(DATA_DIR, 'news.json'), news, 'news');
  safeWriteJSON(path.join(DATA_DIR, 'gallery.json'), gallery, 'gallery');
  safeWriteJSON(path.join(DATA_DIR, 'new-castings.json'), newCastings, 'new-castings');
  safeWriteJSON(path.join(DATA_DIR, 'hw-news.json'), hwNews, 'hw-news');
  safeWriteJSON(path.join(DATA_DIR, 'treasure-hunts.json'), treasureHunts, 'treasure-hunts');
  safeWriteJSON(path.join(DATA_DIR, 'rlc-releases.json'), rlcReleases, 'rlc-releases');
  safeWriteJSON(path.join(DATA_DIR, 'elite64.json'), elite64, 'elite64');
  safeWriteJSON(path.join(DATA_DIR, 'series-cars.json'), seriesCars.seriesList, 'series-cars');

  // Metadata is always written (it's an object, not an array)
  fs.writeFileSync(path.join(DATA_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  // Log summary
  console.log(`\n✨ Done!`);
  console.log(`   Featured: ${featured.length} | Series: ${series.length} | News: ${news.length}`);
  console.log(`   Releases: ${releases.length} | Gallery: ${gallery.length} | New Castings: ${newCastings.length}`);
  console.log(`   HW News: ${hwNews.length} | Treasure Hunts: ${treasureHunts.length} | RLC: ${rlcReleases.length} | Elite 64: ${elite64.length}`);
  console.log(`   Series Cars: ${seriesCars.totalCount} across ${seriesCars.seriesList.length} series`);
  console.log(`   Total API requests: ${stats.totalRequests}`);
  console.log(`   Total run time: ${(runTimeMs / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
