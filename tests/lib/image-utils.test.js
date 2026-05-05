import { describe, it, expect, vi } from 'vitest';
import {
  isPlaceholderImage,
  getBestImage,
  normalizeImageUrl,
} from '../../scripts/lib/image-utils.js';

// ── isPlaceholderImage ──────────────────────────────────────────────────────

describe('isPlaceholderImage', () => {
  it('returns true for URL containing Image_Not_Available', () => {
    expect(isPlaceholderImage('https://static.wikia.nocookie.net/hotwheels/images/Image_Not_Available.jpg')).toBe(true);
  });

  it('returns true regardless of case', () => {
    expect(isPlaceholderImage('https://example.com/image_not_available.png')).toBe(true);
    expect(isPlaceholderImage('https://example.com/IMAGE_NOT_AVAILABLE.JPG')).toBe(true);
    expect(isPlaceholderImage('https://example.com/Image_not_Available.jpg')).toBe(true);
  });

  it('returns false for a normal image URL', () => {
    expect(isPlaceholderImage('https://static.wikia.nocookie.net/hotwheels/images/Twin_Mill.jpg')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isPlaceholderImage(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isPlaceholderImage(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isPlaceholderImage('')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isPlaceholderImage(42)).toBe(false);
    expect(isPlaceholderImage({})).toBe(false);
  });

  it('returns true when Image_Not_Available appears mid-path', () => {
    expect(isPlaceholderImage('https://cdn.example.com/path/Image_Not_Available/thumb.jpg')).toBe(true);
  });
});

// ── normalizeImageUrl ───────────────────────────────────────────────────────

describe('normalizeImageUrl', () => {
  it('replaces existing scale-to-width-down value', () => {
    const url = 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest/scale-to-width-down/600?cb=20230101';
    const result = normalizeImageUrl(url, 1200);
    expect(result).toBe('https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest/scale-to-width-down/1200?cb=20230101');
  });

  it('appends scale-to-width-down before ?cb= when missing', () => {
    const url = 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest?cb=20230101';
    const result = normalizeImageUrl(url, 1200);
    expect(result).toBe('https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest/scale-to-width-down/1200?cb=20230101');
  });

  it('appends scale-to-width-down at end when no ?cb= query', () => {
    const url = 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest';
    const result = normalizeImageUrl(url, 800);
    expect(result).toBe('https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest/scale-to-width-down/800');
  });

  it('uses default width of 1200', () => {
    const url = 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Twin_Mill.jpg/revision/latest/scale-to-width-down/300';
    const result = normalizeImageUrl(url);
    expect(result).toContain('scale-to-width-down/1200');
  });

  it('returns non-Vignette URLs unchanged', () => {
    const url = 'https://example.com/images/car.jpg';
    expect(normalizeImageUrl(url)).toBe(url);
  });

  it('returns null/undefined unchanged', () => {
    expect(normalizeImageUrl(null)).toBe(null);
    expect(normalizeImageUrl(undefined)).toBe(undefined);
  });

  it('returns empty string unchanged', () => {
    expect(normalizeImageUrl('')).toBe('');
  });
});

// ── getBestImage ────────────────────────────────────────────────────────────

describe('getBestImage', () => {
  function createMockWikiClient(imageInfoMap) {
    return {
      imageInfo: vi.fn(async (filename) => {
        return imageInfoMap[filename] || null;
      }),
    };
  }

  it('returns image from infobox when available', async () => {
    const parsed = {
      wikitext: { '*': '{{Infobox_Car\n| image = TwinMill.jpg\n| year = 1969\n}}' },
      text: { '*': '<div></div>' },
      images: ['Other.jpg'],
    };
    const client = createMockWikiClient({
      'TwinMill.jpg': {
        url: 'https://static.wikia.nocookie.net/hotwheels/TwinMill.jpg',
        thumburl: 'https://static.wikia.nocookie.net/hotwheels/TwinMill_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://static.wikia.nocookie.net/hotwheels/TwinMill_thumb.jpg',
      fullUrl: 'https://static.wikia.nocookie.net/hotwheels/TwinMill.jpg',
    });
    // Should have called imageInfo with the infobox image first
    expect(client.imageInfo).toHaveBeenCalledWith('TwinMill.jpg');
  });

  it('falls back to wikitext [[File:...]] when infobox image is placeholder', async () => {
    const parsed = {
      wikitext: {
        '*': '{{Infobox_Car\n| image = Image_Not_Available.jpg\n}}\n[[File:RealCar.jpg|thumb]]',
      },
      text: { '*': '' },
      images: [],
    };
    const client = createMockWikiClient({
      'Image_Not_Available.jpg': {
        url: 'https://cdn.example.com/Image_Not_Available.jpg',
        thumburl: 'https://cdn.example.com/Image_Not_Available_thumb.jpg',
      },
      'RealCar.jpg': {
        url: 'https://cdn.example.com/RealCar.jpg',
        thumburl: 'https://cdn.example.com/RealCar_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://cdn.example.com/RealCar_thumb.jpg',
      fullUrl: 'https://cdn.example.com/RealCar.jpg',
    });
  });

  it('falls back to parsed.images array', async () => {
    const parsed = {
      wikitext: { '*': 'No infobox here, no [[File:]] either.' },
      text: { '*': '' },
      images: ['Gallery1.jpg', 'Gallery2.jpg'],
    };
    const client = createMockWikiClient({
      'Gallery1.jpg': {
        url: 'https://cdn.example.com/Gallery1.jpg',
        thumburl: 'https://cdn.example.com/Gallery1_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://cdn.example.com/Gallery1_thumb.jpg',
      fullUrl: 'https://cdn.example.com/Gallery1.jpg',
    });
  });

  it('falls back to HTML img tag', async () => {
    const parsed = {
      wikitext: { '*': '' },
      text: {
        '*': '<div><img src="https://static.wikia.nocookie.net/hotwheels/images/a/ab/Car.jpg/revision/latest/scale-to-width-down/600" /></div>',
      },
      images: [],
    };
    const client = createMockWikiClient({});

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Car.jpg/revision/latest/scale-to-width-down/600',
      fullUrl: 'https://static.wikia.nocookie.net/hotwheels/images/a/ab/Car.jpg',
    });
  });

  it('returns null when all images are placeholders', async () => {
    const parsed = {
      wikitext: { '*': '| image = Image_Not_Available.jpg' },
      text: { '*': '' },
      images: ['Image_Not_Available.jpg'],
    };
    const client = createMockWikiClient({
      'Image_Not_Available.jpg': {
        url: 'https://cdn.example.com/Image_Not_Available.jpg',
        thumburl: 'https://cdn.example.com/Image_Not_Available_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toBeNull();
  });

  it('returns null when no images exist', async () => {
    const parsed = {
      wikitext: { '*': 'Just some text, no images.' },
      text: { '*': '<div>No images here</div>' },
      images: [],
    };
    const client = createMockWikiClient({});

    const result = await getBestImage(parsed, client);
    expect(result).toBeNull();
  });

  it('returns null for null parsed input', async () => {
    const client = createMockWikiClient({});
    const result = await getBestImage(null, client);
    expect(result).toBeNull();
  });

  it('skips candidates where imageInfo returns null', async () => {
    const parsed = {
      wikitext: { '*': '' },
      text: { '*': '' },
      images: ['Missing.jpg', 'Found.jpg'],
    };
    const client = createMockWikiClient({
      'Found.jpg': {
        url: 'https://cdn.example.com/Found.jpg',
        thumburl: 'https://cdn.example.com/Found_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://cdn.example.com/Found_thumb.jpg',
      fullUrl: 'https://cdn.example.com/Found.jpg',
    });
  });

  it('does not add duplicate candidates', async () => {
    const parsed = {
      wikitext: { '*': '{{Infobox\n| image = Same.jpg\n}}\n[[File:Same.jpg|thumb]]' },
      text: { '*': '' },
      images: ['Same.jpg'],
    };
    const client = createMockWikiClient({
      'Same.jpg': {
        url: 'https://cdn.example.com/Same.jpg',
        thumburl: 'https://cdn.example.com/Same_thumb.jpg',
      },
    });

    const result = await getBestImage(parsed, client);
    expect(result).toEqual({
      thumbUrl: 'https://cdn.example.com/Same_thumb.jpg',
      fullUrl: 'https://cdn.example.com/Same.jpg',
    });
    // Should only call imageInfo once since all candidates are the same file
    expect(client.imageInfo).toHaveBeenCalledTimes(1);
  });

  it('skips HTML fallback when it is a placeholder', async () => {
    const parsed = {
      wikitext: { '*': '' },
      text: {
        '*': '<div><img src="https://static.wikia.nocookie.net/hotwheels/Image_Not_Available.jpg/revision/latest" /></div>',
      },
      images: [],
    };
    const client = createMockWikiClient({});

    const result = await getBestImage(parsed, client);
    expect(result).toBeNull();
  });
});
