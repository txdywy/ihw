/**
 * Tests for the releases scraper module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scrapeReleases, parseYearList, deduplicateByPageName } from '../../scripts/lib/scrapers/releases.js';

/**
 * Create a mock WikiClient with configurable behavior.
 */
function createMockWikiClient(options = {}) {
  const {
    parsePageResult = null,
    imageInfoResult = null,
  } = options;

  return {
    query: vi.fn().mockResolvedValue([]),
    parsePage: vi.fn().mockResolvedValue(parsePageResult),
    search: vi.fn().mockResolvedValue([]),
    imageInfo: vi.fn().mockResolvedValue(imageInfoResult),
  };
}

/**
 * Build a minimal wikitext table for a year list page.
 */
function buildYearListWikitext(cars) {
  let wt = '{| class="wikitable"\n! # !! Name !! Series !! Image\n';
  for (const car of cars) {
    wt += '|-\n';
    wt += `| 1\n`;
    wt += `| [[${car.pageName}${car.display ? '|' + car.display : ''}]]\n`;
    wt += `| Mainline\n`;
    if (car.imgFile) {
      wt += `| [[File:${car.imgFile}|80px]]\n`;
    } else {
      wt += `| \n`;
    }
  }
  wt += '|}';
  return wt;
}

describe('parseYearList', () => {
  it('should return empty array when page is not found', async () => {
    const client = createMockWikiClient({ parsePageResult: null });
    const result = await parseYearList(client, 2025);
    expect(result).toEqual([]);
    expect(client.parsePage).toHaveBeenCalledWith('List of 2025 Hot Wheels');
  });

  it('should parse car entries from wikitext table rows', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Twin Mill', imgFile: 'TwinMill.jpg' },
      { pageName: 'Bone Shaker', display: 'Bone Shaker', imgFile: 'BoneShaker.jpg' },
    ]);

    const client = createMockWikiClient({
      parsePageResult: {
        wikitext: { '*': wikitext },
      },
    });

    const result = await parseYearList(client, 2025);
    expect(result.length).toBe(2);
    expect(result[0]).toEqual({ title: 'Twin Mill', pageName: 'Twin Mill', imgFile: 'TwinMill.jpg' });
    expect(result[1]).toEqual({ title: 'Bone Shaker', pageName: 'Bone Shaker', imgFile: 'BoneShaker.jpg' });
  });

  it('should skip rows without wiki links', async () => {
    const wikitext = '{| class="wikitable"\n|-\n| just text\n| no links here\n| nothing\n|}';
    const client = createMockWikiClient({
      parsePageResult: { wikitext: { '*': wikitext } },
    });

    const result = await parseYearList(client, 2025);
    expect(result).toEqual([]);
  });

  it('should extract display name from [[Page|Display]] links', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Custom_Barracuda', display: 'Custom Barracuda', imgFile: 'Barracuda.jpg' },
    ]);

    const client = createMockWikiClient({
      parsePageResult: { wikitext: { '*': wikitext } },
    });

    const result = await parseYearList(client, 2025);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Custom Barracuda');
    expect(result[0].pageName).toBe('Custom_Barracuda');
  });

  it('should handle entries without image files', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Deora II' },
    ]);

    const client = createMockWikiClient({
      parsePageResult: { wikitext: { '*': wikitext } },
    });

    const result = await parseYearList(client, 2025);
    expect(result.length).toBe(1);
    expect(result[0].imgFile).toBeNull();
  });
});

describe('deduplicateByPageName', () => {
  it('should return empty array for empty input', () => {
    expect(deduplicateByPageName([])).toEqual([]);
  });

  it('should keep all entries when no duplicates exist', () => {
    const cars = [
      { title: 'Twin Mill', pageName: 'Twin Mill', imgFile: 'TwinMill.jpg' },
      { title: 'Bone Shaker', pageName: 'Bone Shaker', imgFile: 'BoneShaker.jpg' },
    ];
    const result = deduplicateByPageName(cars);
    expect(result.length).toBe(2);
  });

  it('should keep first entry with valid image when duplicates exist', () => {
    const cars = [
      { title: 'Twin Mill (red)', pageName: 'Twin Mill', imgFile: null },
      { title: 'Twin Mill (blue)', pageName: 'Twin Mill', imgFile: 'TwinMill_blue.jpg' },
      { title: 'Twin Mill (green)', pageName: 'Twin Mill', imgFile: 'TwinMill_green.jpg' },
    ];
    const result = deduplicateByPageName(cars);
    expect(result.length).toBe(1);
    expect(result[0].imgFile).toBe('TwinMill_blue.jpg');
  });

  it('should keep first entry when all duplicates have no image', () => {
    const cars = [
      { title: 'Twin Mill (red)', pageName: 'Twin Mill', imgFile: null },
      { title: 'Twin Mill (blue)', pageName: 'Twin Mill', imgFile: null },
    ];
    const result = deduplicateByPageName(cars);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Twin Mill (red)');
  });

  it('should skip placeholder images during deduplication', () => {
    const cars = [
      { title: 'Car A', pageName: 'Car_A', imgFile: 'Image_Not_Available.jpg' },
      { title: 'Car A v2', pageName: 'Car_A', imgFile: 'CarA_real.jpg' },
    ];
    const result = deduplicateByPageName(cars);
    expect(result.length).toBe(1);
    expect(result[0].imgFile).toBe('CarA_real.jpg');
  });

  it('should preserve order of unique pageNames', () => {
    const cars = [
      { title: 'A', pageName: 'A', imgFile: 'a.jpg' },
      { title: 'B', pageName: 'B', imgFile: 'b.jpg' },
      { title: 'A dup', pageName: 'A', imgFile: 'a2.jpg' },
      { title: 'C', pageName: 'C', imgFile: 'c.jpg' },
    ];
    const result = deduplicateByPageName(cars);
    expect(result.length).toBe(3);
    expect(result[0].pageName).toBe('A');
    expect(result[1].pageName).toBe('B');
    expect(result[2].pageName).toBe('C');
  });
});

describe('scrapeReleases', () => {
  it('should return empty results when no year list pages are found', async () => {
    const client = createMockWikiClient({ parsePageResult: null });
    const { releases, newReleases } = await scrapeReleases(client);
    expect(releases).toEqual([]);
    expect(newReleases).toEqual([]);
  });

  it('should parse year list only once per year (no duplicate calls)', async () => {
    const currentYear = new Date().getFullYear();
    const wikitext = buildYearListWikitext([
      { pageName: 'Test Car', imgFile: 'TestCar.jpg' },
    ]);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/TestCar.jpg',
        thumburl: 'https://example.com/TestCar_thumb.jpg',
      },
    });

    // parsePage returns data for year list pages
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });

    await scrapeReleases(client);

    // Should have called parsePage exactly twice (once per year)
    const parsePageCalls = client.parsePage.mock.calls;
    const yearListCalls = parsePageCalls.filter(
      call => typeof call[0] === 'string' && call[0].startsWith('List of')
    );
    expect(yearListCalls.length).toBe(2);
    expect(yearListCalls[0][0]).toBe(`List of ${currentYear} Hot Wheels`);
    expect(yearListCalls[1][0]).toBe(`List of ${currentYear - 1} Hot Wheels`);
  });

  it('should build newReleases in CarData format', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Twin Mill', imgFile: 'TwinMill.jpg' },
    ]);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/TwinMill.jpg',
        thumburl: 'https://example.com/TwinMill_thumb.jpg',
      },
    });
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });

    const { newReleases } = await scrapeReleases(client);
    expect(newReleases.length).toBeGreaterThan(0);

    const car = newReleases[0];
    expect(car).toHaveProperty('id');
    expect(car).toHaveProperty('name', 'Twin Mill');
    expect(car).toHaveProperty('year');
    expect(car).toHaveProperty('series');
    expect(car).toHaveProperty('image', 'https://example.com/TwinMill_thumb.jpg');
    expect(car).toHaveProperty('fullImage', 'https://example.com/TwinMill.jpg');
    expect(car).toHaveProperty('description');
    expect(car).toHaveProperty('url');
    expect(car.url).toContain('hotwheels.fandom.com/wiki/Twin_Mill');
  });

  it('should build releases in ReleaseGroup format', async () => {
    const currentYear = new Date().getFullYear();
    const wikitext = buildYearListWikitext([
      { pageName: 'Car A', imgFile: 'CarA.jpg' },
      { pageName: 'Car B', imgFile: 'CarB.jpg' },
    ]);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/car.jpg',
        thumburl: 'https://example.com/car_thumb.jpg',
      },
    });
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });

    const { releases } = await scrapeReleases(client);
    expect(releases.length).toBeGreaterThan(0);

    const group = releases[0];
    expect(group).toHaveProperty('year');
    expect(group).toHaveProperty('series', 'Mainline');
    expect(group).toHaveProperty('id');
    expect(group.id).toBe(`${currentYear}_mainline`);
    expect(group).toHaveProperty('description');
    expect(group).toHaveProperty('cars');
    expect(group.cars.length).toBeLessThanOrEqual(12);
    expect(group).toHaveProperty('url');
    expect(group.url).toContain(`List_of_${currentYear}_Hot_Wheels`);

    // Each car in the group should have name and image
    for (const car of group.cars) {
      expect(car).toHaveProperty('name');
      expect(car).toHaveProperty('image');
    }
  });

  it('should cap newReleases at 50 total', async () => {
    // Build a list with many cars
    const manyCars = [];
    for (let i = 0; i < 40; i++) {
      manyCars.push({ pageName: `Car_${i}`, imgFile: `Car${i}.jpg` });
    }
    const wikitext = buildYearListWikitext(manyCars);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/car.jpg',
        thumburl: 'https://example.com/car_thumb.jpg',
      },
    });
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });

    const { newReleases } = await scrapeReleases(client);
    expect(newReleases.length).toBeLessThanOrEqual(50);
  });

  it('should skip cars with placeholder images in newReleases', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Placeholder Car', imgFile: 'Image_Not_Available.jpg' },
      { pageName: 'Real Car', imgFile: 'RealCar.jpg' },
    ]);

    const client = createMockWikiClient();
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });
    client.imageInfo.mockImplementation((filename) => {
      if (filename === 'Image_Not_Available.jpg') {
        return Promise.resolve({
          url: 'https://example.com/Image_Not_Available.jpg',
          thumburl: 'https://example.com/Image_Not_Available.jpg',
        });
      }
      return Promise.resolve({
        url: 'https://example.com/RealCar.jpg',
        thumburl: 'https://example.com/RealCar_thumb.jpg',
      });
    });

    const { newReleases } = await scrapeReleases(client);
    // Only the real car should be in newReleases
    const placeholderCars = newReleases.filter(c => c.name === 'Placeholder Car');
    expect(placeholderCars.length).toBe(0);
  });

  it('should deduplicate cars by pageName across entries', async () => {
    const wikitext = buildYearListWikitext([
      { pageName: 'Twin Mill', imgFile: null },
      { pageName: 'Twin Mill', imgFile: 'TwinMill.jpg' },
      { pageName: 'Bone Shaker', imgFile: 'BoneShaker.jpg' },
    ]);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/car.jpg',
        thumburl: 'https://example.com/car_thumb.jpg',
      },
    });
    client.parsePage.mockImplementation((title) => {
      if (typeof title === 'string' && title.startsWith('List of')) {
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      return Promise.resolve(null);
    });

    const { newReleases } = await scrapeReleases(client);
    // Each pageName should appear at most once per year
    const currentYear = new Date().getFullYear();
    const currentYearCars = newReleases.filter(c => c.year === currentYear);
    const pageNames = currentYearCars.map(c => c.id);
    const uniquePageNames = new Set(pageNames);
    expect(uniquePageNames.size).toBe(pageNames.length);
  });

  it('should handle errors gracefully for individual years', async () => {
    const currentYear = new Date().getFullYear();
    const wikitext = buildYearListWikitext([
      { pageName: 'Good Car', imgFile: 'GoodCar.jpg' },
    ]);

    const client = createMockWikiClient({
      imageInfoResult: {
        url: 'https://example.com/car.jpg',
        thumburl: 'https://example.com/car_thumb.jpg',
      },
    });

    let callCount = 0;
    client.parsePage.mockImplementation((title) => {
      callCount++;
      if (typeof title === 'string' && title.includes(String(currentYear))) {
        // First year succeeds
        return Promise.resolve({ wikitext: { '*': wikitext } });
      }
      // Second year fails
      throw new Error('Network error');
    });

    // Should not throw — errors are caught per-year
    const { releases, newReleases } = await scrapeReleases(client);
    // Should still have results from the successful year
    expect(newReleases.length).toBeGreaterThan(0);
  });
});
