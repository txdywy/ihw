/**
 * Gallery scraper module.
 * Fetches images from the Hot_Wheels_Original_Designs category.
 *
 * Exports:
 *   scrapeGallery(wikiClient) → GalleryImage[]
 */

const { getBestImage } = require('../image-utils');

const MAX_PAGES = 35;
const CATEGORY_LIMIT = 50;

/**
 * Scrape gallery images from the Hot Wheels Wiki.
 *
 * Logic:
 *   1. Get category members from Hot_Wheels_Original_Designs (limit 50)
 *   2. For each page (up to 35):
 *      - Parse the page via wikiClient.parsePage()
 *      - Get best image via getBestImage()
 *      - Skip if image is null (placeholder filtering handled by getBestImage)
 *      - Build GalleryImage object
 *   3. Return array of GalleryImage
 *
 * @param {import('../wiki-client')} wikiClient - Wiki API client instance
 * @returns {Promise<Array<{id: string, title: string, url: string, fullUrl: string, width: number, height: number, source: string, carUrl: string}>>}
 */
async function scrapeGallery(wikiClient) {
  console.log('\n🖼  Fetching gallery images...');
  const results = [];

  let members = [];
  try {
    members = await wikiClient.categoryMembers('Hot_Wheels_Original_Designs', CATEGORY_LIMIT);
    console.log(`  Found ${members.length} category members`);
  } catch (err) {
    console.error(`  ⚠ Failed to get category members: ${err.message}`);
    return results;
  }

  const pagesToProcess = members.slice(0, MAX_PAGES);

  for (const member of pagesToProcess) {
    try {
      const parsed = await wikiClient.parsePage(member.pageid || member.title);
      if (!parsed) {
        console.log(`  ⚠ Could not parse page: ${member.title}`);
        continue;
      }

      const imageResult = await getBestImage(parsed, wikiClient);
      if (!imageResult) {
        console.log(`  ⚠ No image for: ${member.title}`);
        continue;
      }

      // Get image dimensions from imageInfo if available
      let width = 600;
      let height = 400;

      // Try to get dimensions from the image info
      // Extract filename from the thumbUrl or use the first image in parsed.images
      const images = parsed.images || [];
      if (images.length > 0) {
        for (const imgFilename of images) {
          try {
            const info = await wikiClient.imageInfo(imgFilename);
            if (info) {
              width = info.thumbwidth || info.width || 600;
              height = info.thumbheight || info.height || 400;
              break;
            }
          } catch {
            // continue to next image
          }
        }
      }

      const pageTitle = parsed.title || member.title;
      const pageid = member.pageid || parsed.pageid || pageTitle.replace(/\s+/g, '_').toLowerCase();
      const carUrl = `https://hotwheels.fandom.com/wiki/${encodeURIComponent(String(pageTitle).replace(/\s+/g, '_'))}`;

      results.push({
        id: `img_${pageid}`,
        title: pageTitle,
        url: imageResult.thumbUrl,
        fullUrl: imageResult.fullUrl,
        width,
        height,
        source: 'Hot Wheels Wiki',
        carUrl
      });

      console.log(`  ✅ ${pageTitle} (${results.length})`);
    } catch (err) {
      console.error(`  ⚠ Error processing ${member.title}: ${err.message}`);
    }
  }

  console.log(`  🏁 Gallery images: ${results.length}`);
  return results;
}

module.exports = { scrapeGallery };
