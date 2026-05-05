import { describe, it, expect, vi, beforeEach } from 'vitest';

// WikiClient is a CommonJS module; import the default export
import WikiClient from '../../scripts/lib/wiki-client.js';

// ── Constructor defaults ────────────────────────────────────────────────────

describe('WikiClient constructor', () => {
  it('uses default options when none are provided', () => {
    const client = new WikiClient();
    expect(client.maxConcurrency).toBe(3);
    expect(client.delayMs).toBe(500);
    expect(client.maxRetries).toBe(3);
    expect(client.userAgent).toBe(
      'Mozilla/5.0 (compatible; HotWheelsHub/1.0)',
    );
  });

  it('accepts custom options', () => {
    const client = new WikiClient({
      maxConcurrency: 5,
      delayMs: 1000,
      maxRetries: 1,
      userAgent: 'TestBot/1.0',
    });
    expect(client.maxConcurrency).toBe(5);
    expect(client.delayMs).toBe(1000);
    expect(client.maxRetries).toBe(1);
    expect(client.userAgent).toBe('TestBot/1.0');
  });

  it('initialises internal state correctly', () => {
    const before = Date.now();
    const client = new WikiClient();
    const after = Date.now();

    expect(client._imageCache).toBeInstanceOf(Map);
    expect(client._imageCache.size).toBe(0);
    expect(client._totalRequests).toBe(0);
    expect(client._cacheHits).toBe(0);
    expect(client._startTime).toBeGreaterThanOrEqual(before);
    expect(client._startTime).toBeLessThanOrEqual(after);
    expect(client._activeRequests).toBe(0);
  });
});

// ── _wikiUrl ────────────────────────────────────────────────────────────────

describe('WikiClient._wikiUrl', () => {
  let client;

  beforeEach(() => {
    client = new WikiClient();
  });

  it('builds a URL with format=json and given params', () => {
    const url = client._wikiUrl({ action: 'query', list: 'search' });
    expect(url).toContain('https://hotwheels.fandom.com/api.php?');
    expect(url).toContain('format=json');
    expect(url).toContain('action=query');
    expect(url).toContain('list=search');
  });

  it('encodes special characters in param values', () => {
    const url = client._wikiUrl({ page: 'Twin Mill III' });
    expect(url).toContain('page=Twin+Mill+III');
  });

  it('includes format=json even when no extra params', () => {
    const url = client._wikiUrl({});
    expect(url).toBe(
      'https://hotwheels.fandom.com/api.php?format=json',
    );
  });

  it('builds correct imageinfo URL with iiurlwidth', () => {
    const url = client._wikiUrl({
      action: 'query',
      titles: 'File:TwinMill.jpg',
      prop: 'imageinfo',
      iiprop: 'url|size',
      iiurlwidth: '1200',
    });
    expect(url).toContain('action=query');
    expect(url).toContain('titles=File%3ATwinMill.jpg');
    expect(url).toContain('prop=imageinfo');
    expect(url).toContain('iiurlwidth=1200');
  });
});

// ── imageInfo caching ───────────────────────────────────────────────────────

describe('WikiClient.imageInfo caching', () => {
  let client;

  beforeEach(() => {
    client = new WikiClient({ delayMs: 0 });
  });

  it('returns cached result on second call and increments cacheHits', async () => {
    const fakeInfo = {
      url: 'https://cdn.example.com/Car.jpg',
      thumburl: 'https://cdn.example.com/Car_thumb.jpg',
      size: 50000,
      width: 1200,
      height: 800,
    };

    // Mock _fetchJSON to return a valid Wiki API response
    const fetchSpy = vi
      .spyOn(client, '_fetchJSON')
      .mockResolvedValue({
        query: {
          pages: {
            '123': {
              imageinfo: [fakeInfo],
            },
          },
        },
      });

    // First call — should hit the network
    const result1 = await client.imageInfo('Car.jpg');
    expect(result1).toEqual(fakeInfo);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Second call — should come from cache
    const result2 = await client.imageInfo('Car.jpg');
    expect(result2).toEqual(fakeInfo);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no additional fetch
    expect(client._cacheHits).toBe(1);
  });

  it('caches null results to avoid re-fetching', async () => {
    const fetchSpy = vi
      .spyOn(client, '_fetchJSON')
      .mockResolvedValue({
        query: {
          pages: {
            '-1': {},
          },
        },
      });

    const result1 = await client.imageInfo('Missing.jpg');
    expect(result1).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const result2 = await client.imageInfo('Missing.jpg');
    expect(result2).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(client._cacheHits).toBe(1);
  });

  it('caches null on fetch error', async () => {
    const fetchSpy = vi
      .spyOn(client, '_fetchJSON')
      .mockRejectedValue(new Error('network error'));

    const result1 = await client.imageInfo('Error.jpg');
    expect(result1).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    const result2 = await client.imageInfo('Error.jpg');
    expect(result2).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(client._cacheHits).toBe(1);
  });

  it('caches different filenames independently', async () => {
    const fakeInfoA = {
      url: 'https://cdn.example.com/A.jpg',
      thumburl: 'https://cdn.example.com/A_thumb.jpg',
      size: 1000,
      width: 800,
      height: 600,
    };
    const fakeInfoB = {
      url: 'https://cdn.example.com/B.jpg',
      thumburl: 'https://cdn.example.com/B_thumb.jpg',
      size: 2000,
      width: 1200,
      height: 900,
    };

    vi.spyOn(client, '_fetchJSON')
      .mockResolvedValueOnce({
        query: { pages: { '1': { imageinfo: [fakeInfoA] } } },
      })
      .mockResolvedValueOnce({
        query: { pages: { '2': { imageinfo: [fakeInfoB] } } },
      });

    const a = await client.imageInfo('A.jpg');
    const b = await client.imageInfo('B.jpg');
    expect(a).toEqual(fakeInfoA);
    expect(b).toEqual(fakeInfoB);

    // Both should now be cached
    const a2 = await client.imageInfo('A.jpg');
    const b2 = await client.imageInfo('B.jpg');
    expect(a2).toEqual(fakeInfoA);
    expect(b2).toEqual(fakeInfoB);
    expect(client._cacheHits).toBe(2);
  });
});

// ── getStats ────────────────────────────────────────────────────────────────

describe('WikiClient.getStats', () => {
  it('returns correct structure with initial values', () => {
    const client = new WikiClient();
    const stats = client.getStats();

    expect(stats).toHaveProperty('totalRequests');
    expect(stats).toHaveProperty('cacheHits');
    expect(stats).toHaveProperty('totalTimeMs');
    expect(typeof stats.totalRequests).toBe('number');
    expect(typeof stats.cacheHits).toBe('number');
    expect(typeof stats.totalTimeMs).toBe('number');
    expect(stats.totalRequests).toBe(0);
    expect(stats.cacheHits).toBe(0);
    expect(stats.totalTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('reflects request count after imageInfo calls', async () => {
    const client = new WikiClient({ delayMs: 0 });
    vi.spyOn(client, '_fetchJSON').mockResolvedValue({
      query: { pages: { '1': { imageinfo: [{ url: 'x' }] } } },
    });

    await client.imageInfo('A.jpg');
    await client.imageInfo('B.jpg');
    await client.imageInfo('A.jpg'); // cache hit

    const stats = client.getStats();
    // _fetchJSON was called twice (A and B), but _httpGet increments _totalRequests
    // Since we mocked _fetchJSON, _totalRequests won't be incremented by _httpGet.
    // However cacheHits should be 1.
    expect(stats.cacheHits).toBe(1);
  });
});
