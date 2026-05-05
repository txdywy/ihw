/**
 * Tests for the featured cars scraper module.
 */

import { describe, it, expect, vi } from 'vitest';
import { scrapeFeatured, FEATURED_CASTINGS } from '../../scripts/lib/scrapers/featured.js';

/**
 * Create a mock WikiClient with configurable behavior.
 */
function createMockWikiClient(options = {}) {
  const {
    parsePageResult = null,
    searchResults = [],
    imageInfoResult = null,
    queryResult = []
  } = options;

  return {
    query: vi.fn().mockResolvedValue(queryResult),
    parsePage: vi.fn().mockResolvedValue(parsePageResult),
    search: vi.fn().mockResolvedValue(searchResults),
    imageInfo: vi.fn().mockResolvedValue(imageInfoResult),
  };
}

/**
 * Build a minimal parsed page object for testing.
 */
function buildParsedPage(title, opts = {}) {
  const {
    wikitext = '',
    html = '',
    images = [],
    categories = []
  } = opts;

  return {
    title,
    wikitext: { '*': wikitext },
    text: { '*': html },
    images,
    categories,
  };
}

describe('scrapeFeatured', () => {
  it('should export FEATURED_CASTINGS list with expected entries', () => {
    expect(FEATURED_CASTINGS).toBeInstanceOf(Array);
    expect(FEATURED_CASTINGS.length).toBeGreaterThanOrEqual(12);
    expect(FEATURED_CASTINGS).toContain('Twin Mill');
    expect(FEATURED_CASTINGS).toContain('Bone Shaker');
  });

  it('should return an empty array when no pages are found', async () => {
    const client = createMockWikiClient({
      parsePageResult: null,
      searchResults: [],
    });

    const results = await scrapeFeatured(client);
    expect(results).toEqual([]);
  });

  it('should skip cars without images', async () => {
    // parsePage returns a page but no images available
    const parsed = buildParsedPage('Twin Mill', {
      wikitext: '{{casting|year=1969}}',
    });

    const client = createMockWikiClient({
      parsePageResult: parsed,
      imageInfoResult: null, // no image info available
    });

    const results = await scrapeFeatured(client);
    expect(results).toEqual([]);
  });

  it('should collect cars with valid images and stop at 12', async () => {
    const wikitext = `{{casting
| year = 1969
| series = Mainline
| number = 42
| color = Red
| image = TwinMill.jpg
}}
The Twin Mill is an iconic Hot Wheels casting first released in 1969. It features a distinctive dual-engine design.`;

    const parsed = buildParsedPage('Twin Mill', {
      wikitext,
      images: ['TwinMill.jpg'],
    });

    const client = createMockWikiClient({
      parsePageResult: parsed,
      imageInfoResult: {
        url: 'https://static.wikia.nocookie.net/hotwheels/images/TwinMill.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/images/TwinMill.jpg/revision/latest/scale-to-width-down/600',
        size: 50000,
        width: 1200,
        height: 800,
      },
    });

    const results = await scrapeFeatured(client);

    // Should have collected cars (up to 12, but limited by FEATURED_CASTINGS
    // all resolving to the same mock)
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(12);

    const first = results[0];
    expect(first).toHaveProperty('id');
    expect(first).toHaveProperty('name');
    expect(first).toHaveProperty('year');
    expect(first).toHaveProperty('series');
    expect(first).toHaveProperty('number');
    expect(first).toHaveProperty('color');
    expect(first).toHaveProperty('image');
    expect(first).toHaveProperty('fullImage');
    expect(first).toHaveProperty('description');
    expect(first).toHaveProperty('url');

    // Verify image URLs are not placeholders
    for (const car of results) {
      if (car.image) {
        expect(car.image.toLowerCase()).not.toContain('image_not_available');
      }
      if (car.fullImage) {
        expect(car.fullImage.toLowerCase()).not.toContain('image_not_available');
      }
    }
  });

  it('should build correct CarData fields from infobox', async () => {
    const wikitext = `{{casting
| year = 1969
| series = Original 16
| number = 6258
| color = Spectraflame Aqua
| image = TwinMill.jpg
}}
The Twin Mill is a Hot Wheels casting designed by Ira Gilford. It was first released in 1969 as part of the original Sweet Sixteen.`;

    const parsed = buildParsedPage('Twin Mill', {
      wikitext,
      images: ['TwinMill.jpg'],
    });

    // Only return parsed for the first call (Twin Mill), null for others
    let callCount = 0;
    const client = {
      query: vi.fn().mockResolvedValue([]),
      parsePage: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? parsed : null);
      }),
      search: vi.fn().mockResolvedValue([]),
      imageInfo: vi.fn().mockResolvedValue({
        url: 'https://static.wikia.nocookie.net/hotwheels/images/TwinMill.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/images/TwinMill_thumb.jpg',
      }),
    };

    const results = await scrapeFeatured(client);
    expect(results.length).toBe(1);

    const car = results[0];
    expect(car.id).toBe('twin_mill');
    expect(car.name).toBe('Twin Mill');
    expect(car.year).toBe(1969);
    expect(car.series).toBe('Original 16');
    expect(car.number).toBe('6258');
    expect(car.color).toBe('Spectraflame Aqua');
    expect(car.image).toBe('https://static.wikia.nocookie.net/hotwheels/images/TwinMill_thumb.jpg');
    expect(car.fullImage).toBe('https://static.wikia.nocookie.net/hotwheels/images/TwinMill.jpg');
    expect(car.url).toBe('https://hotwheels.fandom.com/wiki/Twin_Mill');
    expect(car.description).toBeTruthy();
    // Description should be clean text without wiki markup
    expect(car.description).not.toContain('{{');
    expect(car.description).not.toContain('}}');
  });

  it('should skip placeholder images', async () => {
    const wikitext = `{{casting
| year = 2000
| image = Image_Not_Available.jpg
}}
Some description text here.`;

    const parsed = buildParsedPage('Phantom Racer', {
      wikitext,
      images: ['Image_Not_Available.jpg'],
    });

    let callCount = 0;
    const client = {
      query: vi.fn().mockResolvedValue([]),
      parsePage: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? parsed : null);
      }),
      search: vi.fn().mockResolvedValue([]),
      imageInfo: vi.fn().mockResolvedValue({
        url: 'https://static.wikia.nocookie.net/hotwheels/images/Image_Not_Available.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/images/Image_Not_Available.jpg',
      }),
    };

    const results = await scrapeFeatured(client);
    expect(results.length).toBe(0);
  });

  it('should fall back to search when direct page parse fails', async () => {
    const wikitext = `{{casting|year=2005|image=BadBlade.jpg}}
Bad to the Blade is a futuristic Hot Wheels casting.`;

    const parsed = buildParsedPage('Bad to the Blade', {
      wikitext,
      images: ['BadBlade.jpg'],
    });

    // Track which casting names have been searched so we only return
    // a result for the very first one
    let searchedOnce = false;
    const client = {
      query: vi.fn().mockResolvedValue([]),
      parsePage: vi.fn().mockImplementation((idOrTitle) => {
        // Only resolve for the search-result pageid
        if (idOrTitle === 123) return Promise.resolve(parsed);
        return Promise.resolve(null);
      }),
      search: vi.fn().mockImplementation(() => {
        if (!searchedOnce) {
          searchedOnce = true;
          return Promise.resolve([{ title: 'Bad to the Blade', pageid: 123 }]);
        }
        return Promise.resolve([]);
      }),
      imageInfo: vi.fn().mockResolvedValue({
        url: 'https://static.wikia.nocookie.net/hotwheels/images/BadBlade.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/images/BadBlade_thumb.jpg',
      }),
    };

    const results = await scrapeFeatured(client);
    expect(results.length).toBe(1);
    expect(client.search).toHaveBeenCalled();
  });

  it('should generate correct wiki URL with encoded title', async () => {
    const wikitext = `{{casting|year=1968|image=Deora.jpg}}
The Deora II is a concept car.`;

    const parsed = buildParsedPage('Deora II', {
      wikitext,
      images: ['Deora.jpg'],
    });

    let callCount = 0;
    const client = {
      query: vi.fn().mockResolvedValue([]),
      parsePage: vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(callCount === 1 ? parsed : null);
      }),
      search: vi.fn().mockResolvedValue([]),
      imageInfo: vi.fn().mockResolvedValue({
        url: 'https://static.wikia.nocookie.net/hotwheels/images/Deora.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/images/Deora_thumb.jpg',
      }),
    };

    const results = await scrapeFeatured(client);
    expect(results.length).toBe(1);
    expect(results[0].url).toBe('https://hotwheels.fandom.com/wiki/Deora_II');
  });
});
