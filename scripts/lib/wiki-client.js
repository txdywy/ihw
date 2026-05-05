/**
 * Wiki API Client for Hot Wheels Fandom Wiki
 * Encapsulates HTTP requests, retry logic, caching, and rate limiting.
 */

const https = require('https');
const http = require('http');

const WIKI_API = 'https://hotwheels.fandom.com/api.php';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class WikiClient {
  /**
   * @param {Object} options
   * @param {number} [options.maxConcurrency=3] - Max concurrent requests
   * @param {number} [options.delayMs=500] - Minimum delay between requests (ms)
   * @param {number} [options.maxRetries=3] - Max retries per request
   * @param {string} [options.userAgent] - User-Agent header
   */
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.delayMs = options.delayMs ?? 500;
    this.maxRetries = options.maxRetries ?? 3;
    this.userAgent =
      options.userAgent ??
      'Mozilla/5.0 (compatible; HotWheelsHub/1.0)';

    // Internal state
    this._imageCache = new Map();
    this._totalRequests = 0;
    this._cacheHits = 0;
    this._startTime = Date.now();
    this._activeRequests = 0;
    this._lastRequestTime = 0;
    this._requestQueue = Promise.resolve();
  }

  // ── Private methods ─────────────────────────────────────────────────────

  /**
   * Low-level HTTP GET with redirect following, retry on 429/5xx/timeout/network errors.
   * @param {string} url
   * @param {number} [retries] - Remaining retries
   * @returns {Promise<{status: number, body: string}>}
   */
  _httpGet(url, retries) {
    if (retries === undefined) retries = this.maxRetries;
    this._totalRequests++;

    return new Promise((resolve, reject) => {
      const proto = url.startsWith('https') ? https : http;
      const req = proto.get(
        url,
        { headers: { 'User-Agent': this.userAgent }, timeout: 20000 },
        (res) => {
          // Handle redirects (3xx)
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            return this._httpGet(res.headers.location, retries).then(
              resolve,
              reject,
            );
          }

          // Handle 429 rate limiting
          if (res.statusCode === 429 && retries > 0) {
            const wait =
              parseInt(res.headers['retry-after'] || '5', 10) * 1000;
            console.warn(`  ⏳ Rate limited, waiting ${wait}ms...`);
            return sleep(wait).then(() =>
              this._httpGet(url, retries - 1).then(resolve, reject),
            );
          }

          // Handle 5xx server errors
          if (res.statusCode >= 500 && retries > 0) {
            return sleep(3000).then(() =>
              this._httpGet(url, retries - 1).then(resolve, reject),
            );
          }

          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf-8'),
            }),
          );
          res.on('error', reject);
        },
      );

      // Handle network errors
      req.on('error', (err) =>
        retries > 0
          ? sleep(2000).then(() =>
              this._httpGet(url, retries - 1).then(resolve, reject),
            )
          : reject(err),
      );

      // Handle timeout
      req.on('timeout', () => {
        req.destroy();
        if (retries > 0) {
          sleep(2000).then(() =>
            this._httpGet(url, retries - 1).then(resolve, reject),
          );
        } else {
          reject(new Error('timeout'));
        }
      });
    });
  }

  /**
   * Fetch a URL and parse the response as JSON. Throws on non-200.
   * @param {string} url
   * @returns {Promise<any>}
   */
  async _fetchJSON(url) {
    const { status, body } = await this._httpGet(url);
    if (status !== 200) {
      throw new Error(`HTTP ${status}: ${url.substring(0, 80)}`);
    }
    return JSON.parse(body);
  }

  /**
   * Build a Wiki API URL from the given params.
   * Always includes format=json.
   * @param {Object} params
   * @returns {string}
   */
  _wikiUrl(params) {
    const sp = new URLSearchParams({ format: 'json', ...params });
    return `${WIKI_API}?${sp.toString()}`;
  }

  /**
   * Rate-limit: ensure at least `delayMs` between requests.
   * Chains onto `_requestQueue` so concurrent callers wait in order.
   * @returns {Promise<void>}
   */
  _throttle() {
    this._requestQueue = this._requestQueue.then(async () => {
      const now = Date.now();
      const elapsed = now - this._lastRequestTime;
      if (elapsed < this.delayMs) {
        await sleep(this.delayMs - elapsed);
      }
      this._lastRequestTime = Date.now();
    });
    return this._requestQueue;
  }

  // ── Public methods ──────────────────────────────────────────────────────

  /**
   * Query the Wiki API with auto-pagination (handles `data.continue`).
   * Max 20 pages safety limit.
   * @param {Object} params - API query parameters
   * @returns {Promise<any[]>}
   */
  async query(params) {
    const items = [];
    let cont = {};
    let safety = 0;

    do {
      await this._throttle();
      const url = this._wikiUrl({ action: 'query', ...params, ...cont });
      const data = await this._fetchJSON(url);
      const result = data.query || {};

      for (const key of Object.keys(result)) {
        if (Array.isArray(result[key])) {
          items.push(...result[key]);
        }
      }

      cont = data.continue || {};
      safety++;
    } while (Object.keys(cont).length > 0 && safety < 20);

    return items;
  }

  /**
   * Parse a Wiki page by page ID (number) or title (string).
   * Requests wikitext, rendered HTML, images, and categories.
   * @param {number|string} pageIdOrTitle
   * @returns {Promise<Object|null>}
   */
  async parsePage(pageIdOrTitle) {
    try {
      await this._throttle();
      const param =
        typeof pageIdOrTitle === 'number'
          ? { pageid: String(pageIdOrTitle) }
          : { page: pageIdOrTitle };
      const data = await this._fetchJSON(
        this._wikiUrl({
          action: 'parse',
          ...param,
          prop: 'wikitext|text|images|categories',
        }),
      );
      return data.parse || null;
    } catch {
      return null;
    }
  }

  /**
   * Search Wiki pages in namespace 0.
   * @param {string} query - Search query
   * @param {number} [limit=10]
   * @returns {Promise<Object[]>}
   */
  async search(query, limit = 10) {
    try {
      await this._throttle();
      const data = await this._fetchJSON(
        this._wikiUrl({
          action: 'query',
          list: 'search',
          srsearch: query,
          srlimit: String(limit),
          srnamespace: '0',
        }),
      );
      return data.query?.search || [];
    } catch {
      return [];
    }
  }

  /**
   * Get image info for a filename, with caching.
   * Uses iiurlwidth=1200 for higher resolution thumbnails.
   * @param {string} filename
   * @returns {Promise<{url: string, thumburl: string, size: number, width: number, height: number}|null>}
   */
  async imageInfo(filename) {
    // Cache check
    if (this._imageCache.has(filename)) {
      this._cacheHits++;
      return this._imageCache.get(filename);
    }

    try {
      await this._throttle();
      const data = await this._fetchJSON(
        this._wikiUrl({
          action: 'query',
          titles: `File:${filename}`,
          prop: 'imageinfo',
          iiprop: 'url|size',
          iiurlwidth: '1200',
        }),
      );
      const pages = Object.values(data.query?.pages || {});
      const info = pages[0]?.imageinfo?.[0] || null;

      // Cache the result (even null to avoid re-fetching)
      this._imageCache.set(filename, info);
      return info;
    } catch {
      // Cache null on error to avoid re-fetching
      this._imageCache.set(filename, null);
      return null;
    }
  }

  /**
   * Get members of a Wiki category, sorted by timestamp descending.
   * @param {string} category - Category name (without "Category:" prefix)
   * @param {number} [limit=50]
   * @returns {Promise<Object[]>}
   */
  async categoryMembers(category, limit = 50) {
    return this.query({
      list: 'categorymembers',
      cmtitle: `Category:${category}`,
      cmlimit: String(limit),
      cmtype: 'page',
      cmsort: 'timestamp',
      cmdir: 'desc',
    });
  }

  /**
   * Get runtime statistics.
   * @returns {{ totalRequests: number, cacheHits: number, totalTimeMs: number }}
   */
  getStats() {
    return {
      totalRequests: this._totalRequests,
      cacheHits: this._cacheHits,
      totalTimeMs: Date.now() - this._startTime,
    };
  }
}

module.exports = WikiClient;
