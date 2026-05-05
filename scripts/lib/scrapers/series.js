/**
 * Series data scraper module.
 * Fetches series information from the Hot Wheels Wiki, with predefined
 * Chinese descriptions as fallback content.
 *
 * Exports:
 *   scrapeSeries(wikiClient) → SeriesData[]
 *   generateSeriesUrl(wikiPage) → string
 */

const { getBestImage } = require('../image-utils');

const WIKI_BASE = 'https://hotwheels.fandom.com/wiki/';

/**
 * Predefined series with their Wiki page names and Chinese descriptions.
 * Used as the authoritative list of series to scrape.
 */
const PREDEFINED_SERIES = [
  { name: 'Mainline', wikiPage: 'Hot_Wheels_Mainline', desc: '风火轮核心产品线，价格亲民、广泛发售的基础车型系列' },
  { name: 'Premium', wikiPage: 'Hot_Wheels_Premium', desc: '高端系列，采用金属底盘、仿真轮胎和精美涂装，收藏价值更高' },
  { name: 'Car Culture', wikiPage: 'Car_Culture', desc: '主题化的高端系列，致敬汽车文化和车迷最爱的经典车型' },
  { name: 'Super Treasure Hunt', wikiPage: 'Super_Treasure_Hunt', desc: '极其稀有的特别版，采用光谱漆面和仿真轮胎，是收藏者的终极目标' },
  { name: 'Monster Trucks', wikiPage: 'Hot_Wheels_Monster_Trucks', desc: '超大尺寸的怪物卡车系列，配备巨大的轮胎，带来极致的玩耍体验' },
  { name: 'Fast & Furious', wikiPage: 'Fast_%26_Furious_(series)', desc: '灵感源自《速度与激情》系列电影的经典车型' },
  { name: 'Batman', wikiPage: 'Batman_(series)', desc: '蝙蝠侠主题系列，包含标志性的蝙蝠车和反派车辆' },
  { name: 'HW Art Cars', wikiPage: 'HW_Art_Cars', desc: '独特艺术涂装系列，在经典车型上展现创意设计' },
  { name: 'Team Transport', wikiPage: 'Team_Transport', desc: '大型车辆搭配配套运输拖车的组合套装系列' },
  { name: 'RLC (Red Line Club)', wikiPage: 'Red_Line_Club', desc: '限量版俱乐部专属系列，拥有最高品质的细节和包装' },
  { name: 'Legends Tour', wikiPage: 'Hot_Wheels_Legends_Tour', desc: '与年度风火轮传奇之旅活动相关的特别版系列' },
  { name: 'Ultra Hots', wikiPage: 'Ultra_Hots', desc: '复古主题系列，致敬风火轮黄金时代的经典设计' },
  { name: 'Boulevard', wikiPage: 'Hot_Wheels_Boulevard', desc: '精选高端系列，以精美涂装和仿真配件呈现经典车型' },
  { name: 'HW Screen Time', wikiPage: 'HW_Screen_Time', desc: '影视联名系列，收录电影、电视和游戏中的经典车辆' },
  { name: 'HW Dream Garage', wikiPage: 'HW_Dream_Garage', desc: '梦想车库系列，汇聚每个车迷心中的梦想之车' }
];

/**
 * Generate the correct Wiki URL for a series page.
 *
 * @param {string} wikiPage - The Wiki page name (already formatted with underscores/encoding)
 * @returns {string} Full Wiki URL
 */
function generateSeriesUrl(wikiPage) {
  return `${WIKI_BASE}${wikiPage}`;
}

/**
 * Generate a series ID from the series name.
 * Converts to lowercase and replaces spaces with underscores.
 * Strips parenthetical suffixes for cleaner IDs.
 *
 * @param {string} name - Series name
 * @returns {string} Series ID
 */
function generateSeriesId(name) {
  return name
    .replace(/\s*\(.*?\)\s*/g, '')  // Remove parenthetical parts like "(Red Line Club)"
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')    // Remove special characters like &
    .replace(/\s+/g, '_')           // Spaces to underscores
    .replace(/_+/g, '_')            // Collapse multiple underscores
    .replace(/^_|_$/g, '');         // Trim leading/trailing underscores
}

/**
 * Scrape series data from the Hot Wheels Wiki.
 *
 * For each predefined series:
 *   1. Generate the correct Wiki URL from the wikiPage field
 *   2. Try to parse the wiki page and extract a representative image
 *   3. Use the predefined Chinese description
 *   4. Return SeriesData format
 *
 * @param {import('../wiki-client')} wikiClient - Wiki API client instance
 * @returns {Promise<Array<{id: string, name: string, url: string, description: string, image: string|null, carCount: number|null}>>}
 */
async function scrapeSeries(wikiClient) {
  console.log('\n📚 Fetching series data...');
  const results = [];

  for (const series of PREDEFINED_SERIES) {
    const url = generateSeriesUrl(series.wikiPage);
    let image = null;

    // Try to get a representative image by parsing the wiki page
    try {
      const parsed = await wikiClient.parsePage(series.wikiPage);
      if (parsed) {
        const imageResult = await getBestImage(parsed, wikiClient);
        if (imageResult) {
          image = imageResult.thumbUrl;
        }
      }
    } catch (err) {
      console.log(`  ⚠ Could not fetch image for ${series.name}: ${err.message}`);
    }

    const id = generateSeriesId(series.name);

    results.push({
      id,
      name: series.name,
      url,
      description: series.desc,
      image,
      carCount: null
    });

    console.log(`  📌 ${series.name} → ${url}${image ? ' (with image)' : ''}`);
  }

  console.log(`  🏁 Series: ${results.length}`);
  return results;
}

module.exports = { scrapeSeries, generateSeriesUrl };
