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

  try { featured = await scrapeFeatured(wikiClient); } catch (e) { console.error('Featured failed:', e.message); }
  try {
    const result = await scrapeReleases(wikiClient);
    releases = result.releases;
    newReleases = result.newReleases;
  } catch (e) { console.error('Releases failed:', e.message); }
  try { series = await scrapeSeries(wikiClient); } catch (e) { console.error('Series failed:', e.message); }
  try { news = await scrapeNews(wikiClient); } catch (e) { console.error('News failed:', e.message); }
  try { gallery = await scrapeGallery(wikiClient); } catch (e) { console.error('Gallery failed:', e.message); }
  try { newCastings = await scrapeNewCastings(wikiClient); } catch (e) { console.error('New Castings failed:', e.message); }

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
      { name: 'Hot Wheels Fandom Wiki', url: 'https://hotwheels.fandom.com', type: 'wiki' }
    ],
    stats: {
      totalFeatured: featured.length,
      totalSeries: series.length,
      totalNews: news.length,
      totalGallery: gallery.length,
      totalNewCastings: newCastings.length,
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

  // Metadata is always written (it's an object, not an array)
  fs.writeFileSync(path.join(DATA_DIR, 'metadata.json'), JSON.stringify(metadata, null, 2), 'utf-8');

  // Log summary
  console.log(`\n✨ Done!`);
  console.log(`   Featured: ${featured.length} | Series: ${series.length} | News: ${news.length}`);
  console.log(`   Releases: ${releases.length} | Gallery: ${gallery.length} | New Castings: ${newCastings.length}`);
  console.log(`   Total API requests: ${stats.totalRequests}`);
  console.log(`   Total run time: ${(runTimeMs / 1000).toFixed(1)}s`);
}

main().catch(err => {
  console.error('💥 Fatal:', err);
  process.exit(1);
});
