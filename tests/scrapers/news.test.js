/**
 * Tests for the news scraper module.
 * Validates ID generation, quality filtering, and scraping logic.
 */

import { describe, it, expect, vi } from 'vitest';
import { scrapeNews, generateNewsId, isValidNewsItem } from '../../scripts/lib/scrapers/news.js';

describe('generateNewsId', () => {
  it('generates rc_{revid} when revid is available', () => {
    expect(generateNewsId(12345, 'Some Title', '2025-01-15T10:00:00Z'))
      .toBe('rc_12345');
  });

  it('generates fallback ID when revid is undefined', () => {
    const id = generateNewsId(undefined, 'Twin Mill', '2025-01-15T10:30:00Z');
    expect(id).toBe('rc_Twin_Mill_20250115103000');
  });

  it('generates fallback ID when revid is 0 (falsy)', () => {
    const id = generateNewsId(0, 'Some Car', '2025-03-01T00:00:00Z');
    expect(id).toBe('rc_Some_Car_20250301000000');
  });

  it('encodes special characters in title for fallback ID', () => {
    const id = generateNewsId(undefined, 'Fast & Furious', '2025-06-01T12:00:00Z');
    expect(id).toBe('rc_Fast_%26_Furious_20250601120000');
  });

  it('handles empty title gracefully', () => {
    const id = generateNewsId(undefined, '', '2025-01-01T00:00:00Z');
    expect(id).toBe('rc__20250101000000');
  });

  it('handles empty timestamp gracefully', () => {
    const id = generateNewsId(undefined, 'Test', '');
    expect(id).toBe('rc_Test_');
  });

  it('replaces spaces with underscores in title', () => {
    const id = generateNewsId(undefined, 'Hot Wheels Car Culture', '2025-01-01T00:00:00Z');
    expect(id).toContain('Hot_Wheels_Car_Culture');
  });
});

describe('isValidNewsItem', () => {
  it('returns false for empty comment', () => {
    expect(isValidNewsItem('Some Title', '')).toBe(false);
  });

  it('returns false for null comment', () => {
    expect(isValidNewsItem('Some Title', null)).toBe(false);
  });

  it('returns false for undefined comment', () => {
    expect(isValidNewsItem('Some Title', undefined)).toBe(false);
  });

  it('returns false for whitespace-only comment', () => {
    expect(isValidNewsItem('Some Title', '   ')).toBe(false);
  });

  it('returns false for bot comments starting with "Bot:"', () => {
    expect(isValidNewsItem('Some Title', 'Bot: automated edit')).toBe(false);
  });

  it('returns false for bot comments starting with "Automated"', () => {
    expect(isValidNewsItem('Some Title', 'Automated cleanup')).toBe(false);
  });

  it('returns false for "List of 2025 Hot Wheels" title', () => {
    expect(isValidNewsItem('List of 2025 Hot Wheels', 'Updated car list')).toBe(false);
  });

  it('returns false for "List of 2024 Hot Wheels" title', () => {
    expect(isValidNewsItem('List of 2024 Hot Wheels', 'Added new entries')).toBe(false);
  });

  it('returns true for valid title and comment', () => {
    expect(isValidNewsItem('Twin Mill', 'Added new image')).toBe(true);
  });

  it('returns true for title with year list-like but not exact pattern', () => {
    expect(isValidNewsItem('List of 2025 Hot Wheels Treasure Hunts', 'Updated')).toBe(true);
  });

  it('is case-insensitive for year list pattern', () => {
    expect(isValidNewsItem('list of 2025 hot wheels', 'Some comment')).toBe(false);
  });
});

describe('scrapeNews', () => {
  function createMockWikiClient(recentChanges = [], searchResults = []) {
    return {
      query: vi.fn().mockResolvedValue(recentChanges),
      search: vi.fn().mockResolvedValue(searchResults),
      parsePage: vi.fn().mockResolvedValue(null),
      imageInfo: vi.fn().mockResolvedValue(null)
    };
  }

  it('returns an array of news items', async () => {
    const mockClient = createMockWikiClient([
      {
        title: 'Twin Mill',
        timestamp: '2025-01-15T10:00:00Z',
        comment: 'Added new casting info',
        revid: 100
      }
    ]);

    const result = await scrapeNews(mockClient);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(1);
  });

  it('generates correct ID from revid', async () => {
    const mockClient = createMockWikiClient([
      {
        title: 'Bone Shaker',
        timestamp: '2025-02-01T08:00:00Z',
        comment: 'Updated car details',
        revid: 42
      }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result[0].id).toBe('rc_42');
  });

  it('generates fallback ID when revid is missing', async () => {
    const mockClient = createMockWikiClient([
      {
        title: 'Deora II',
        timestamp: '2025-03-10T14:30:00Z',
        comment: 'New release info'
        // no revid
      }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result[0].id).toBe('rc_Deora_II_20250310143000');
  });

  it('filters out items with empty comments', async () => {
    const mockClient = createMockWikiClient([
      { title: 'Hot Wheels Car', timestamp: '2025-01-01T00:00:00Z', comment: '', revid: 1 },
      { title: 'Twin Mill', timestamp: '2025-01-01T00:00:00Z', comment: 'Added info about casting', revid: 2 }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Twin Mill');
  });

  it('filters out bot comments', async () => {
    const mockClient = createMockWikiClient([
      { title: 'Hot Wheels Page', timestamp: '2025-01-01T00:00:00Z', comment: 'Bot: cleanup', revid: 1 },
      { title: 'HW Art Cars', timestamp: '2025-01-01T00:00:00Z', comment: 'New series added', revid: 2 }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('HW Art Cars');
  });

  it('filters out List of YYYY Hot Wheels titles', async () => {
    const mockClient = createMockWikiClient([
      { title: 'List of 2025 Hot Wheels', timestamp: '2025-01-01T00:00:00Z', comment: 'Updated list', revid: 1 },
      { title: 'Treasure Hunt 2025', timestamp: '2025-01-01T00:00:00Z', comment: 'New release info', revid: 2 }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Treasure Hunt 2025');
  });

  it('filters out items not relevant to Hot Wheels', async () => {
    const mockClient = createMockWikiClient([
      { title: 'Random Page', timestamp: '2025-01-01T00:00:00Z', comment: 'Fixed typo', revid: 1 },
      { title: 'Hot Wheels Mainline', timestamp: '2025-01-01T00:00:00Z', comment: 'Updated', revid: 2 }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
    expect(result[0].title).toBe('Hot Wheels Mainline');
  });

  it('deduplicates items by title (case-insensitive)', async () => {
    const mockClient = createMockWikiClient([
      { title: 'Twin Mill', timestamp: '2025-01-01T00:00:00Z', comment: 'First edit about casting', revid: 1 },
      { title: 'Twin Mill', timestamp: '2025-01-02T00:00:00Z', comment: 'Second edit about vehicle', revid: 2 }
    ]);

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
  });

  it('ensures unique IDs even with duplicates', async () => {
    // This tests the ensureUniqueIds function indirectly
    const mockClient = createMockWikiClient([
      { title: 'Hot Wheels A', timestamp: '2025-01-01T00:00:00Z', comment: 'New casting', revid: 10 },
      { title: 'Hot Wheels B', timestamp: '2025-01-02T00:00:00Z', comment: 'New release', revid: 20 }
    ]);

    const result = await scrapeNews(mockClient);
    const ids = result.map(r => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('includes correct fields in news items', async () => {
    const mockClient = createMockWikiClient([
      {
        title: 'Bone Shaker',
        timestamp: '2025-06-15T09:30:00Z',
        comment: 'Added new casting variant',
        revid: 999
      }
    ]);

    const result = await scrapeNews(mockClient);
    const item = result[0];
    expect(item).toHaveProperty('id', 'rc_999');
    expect(item).toHaveProperty('title', 'Bone Shaker');
    expect(item).toHaveProperty('summary');
    expect(item).toHaveProperty('date', '2025-06-15');
    expect(item).toHaveProperty('source', 'Hot Wheels Wiki');
    expect(item).toHaveProperty('url');
    expect(item).toHaveProperty('image');
    expect(item.url).toContain('Bone_Shaker');
  });

  it('enriches articles with page description when available', async () => {
    const mockClient = createMockWikiClient([
      {
        title: 'Twin Mill',
        timestamp: '2025-01-01T00:00:00Z',
        comment: 'Updated casting info',
        revid: 50
      }
    ]);

    mockClient.parsePage.mockResolvedValue({
      wikitext: { '*': 'The Twin Mill is a classic Hot Wheels car designed by Ira Gilford. It features a distinctive dual-engine design that has made it one of the most iconic castings in the Hot Wheels lineup.' },
      text: { '*': '' },
      images: []
    });

    const result = await scrapeNews(mockClient);
    expect(result[0].summary).not.toBe('Updated casting info');
    expect(result[0].summary).toContain('Twin Mill');
  });

  it('handles wikiClient.query errors gracefully', async () => {
    const mockClient = createMockWikiClient();
    mockClient.query.mockRejectedValue(new Error('Network error'));

    const result = await scrapeNews(mockClient);
    expect(Array.isArray(result)).toBe(true);
  });

  it('handles search errors gracefully', async () => {
    const mockClient = createMockWikiClient([
      { title: 'HW Car', timestamp: '2025-01-01T00:00:00Z', comment: 'New casting', revid: 1 }
    ]);
    mockClient.search.mockRejectedValue(new Error('Search failed'));

    const result = await scrapeNews(mockClient);
    expect(result.length).toBe(1);
  });
});
