import { describe, it, expect } from 'vitest';
import {
  removeTemplates,
  convertWikiLinks,
  removeExternalLinks,
  removeHeadings,
  removeHtmlAndFormatting,
  removeTables,
  cleanWikiText,
  extractDescription,
  truncate,
} from '../../scripts/lib/text-cleaner.js';

// ── removeTemplates ─────────────────────────────────────────────────────────

describe('removeTemplates', () => {
  it('removes a simple template', () => {
    expect(removeTemplates('Hello {{template}} world')).toBe('Hello  world');
  });

  it('removes nested templates from innermost first', () => {
    expect(removeTemplates('{{outer|{{inner}}}}')).toBe('');
  });

  it('removes deeply nested templates', () => {
    expect(removeTemplates('{{a|{{b|{{c|{{d}}}}}}}}')).toBe('');
  });

  it('handles templates with pipe parameters', () => {
    expect(removeTemplates('{{template|param1|param2}}')).toBe('');
  });

  it('handles templates containing wiki links', () => {
    expect(removeTemplates('{{template|[[Link|Text]]}}')).toBe('');
  });

  it('force-removes residual {{ and }} after 10 iterations', () => {
    // Build a deeply nested template (12 levels)
    let text = 'x';
    for (let i = 0; i < 12; i++) {
      text = `{{${text}}}`;
    }
    const result = removeTemplates(text);
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
  });

  it('returns empty string for null/undefined input', () => {
    expect(removeTemplates(null)).toBe('');
    expect(removeTemplates(undefined)).toBe('');
    expect(removeTemplates('')).toBe('');
  });

  it('leaves text without templates unchanged', () => {
    expect(removeTemplates('Hello world')).toBe('Hello world');
  });

  it('removes multiple templates in the same text', () => {
    expect(removeTemplates('A {{t1}} B {{t2}} C')).toBe('A  B  C');
  });
});

// ── convertWikiLinks ────────────────────────────────────────────────────────

describe('convertWikiLinks', () => {
  it('converts [[Page|Display]] to Display', () => {
    expect(convertWikiLinks('See [[Hot Wheels|the cars]]')).toBe('See the cars');
  });

  it('converts [[Page]] to Page', () => {
    expect(convertWikiLinks('See [[Twin Mill]]')).toBe('See Twin Mill');
  });

  it('handles multiple links', () => {
    expect(convertWikiLinks('[[A|B]] and [[C]]')).toBe('B and C');
  });

  it('returns empty string for null input', () => {
    expect(convertWikiLinks(null)).toBe('');
  });
});

// ── removeExternalLinks ─────────────────────────────────────────────────────

describe('removeExternalLinks', () => {
  it('removes http link keeping display text', () => {
    expect(removeExternalLinks('[http://example.com click here]')).toBe('click here');
  });

  it('removes https link keeping display text', () => {
    expect(removeExternalLinks('[https://example.com click here]')).toBe('click here');
  });

  it('removes link with no display text', () => {
    expect(removeExternalLinks('[http://example.com]')).toBe('');
  });

  it('handles multi-word display text', () => {
    expect(removeExternalLinks('[https://example.com/path some display text here]'))
      .toBe('some display text here');
  });

  it('returns empty string for null input', () => {
    expect(removeExternalLinks(null)).toBe('');
  });
});

// ── removeHeadings ──────────────────────────────────────────────────────────

describe('removeHeadings', () => {
  it('removes level 2 headings', () => {
    expect(removeHeadings('== Description ==')).toBe('');
  });

  it('removes level 3 headings', () => {
    expect(removeHeadings('=== Versions ===')).toBe('');
  });

  it('removes level 4 headings', () => {
    expect(removeHeadings('==== Details ====')).toBe('');
  });

  it('preserves non-heading text', () => {
    expect(removeHeadings('Some text\n== Heading ==\nMore text'))
      .toBe('Some text\n\nMore text');
  });

  it('returns empty string for null input', () => {
    expect(removeHeadings(null)).toBe('');
  });
});

// ── removeHtmlAndFormatting ─────────────────────────────────────────────────

describe('removeHtmlAndFormatting', () => {
  it('removes <ref>...</ref> tags', () => {
    expect(removeHtmlAndFormatting('Text<ref>citation</ref> more')).toBe('Text more');
  });

  it('removes self-closing <ref/> tags', () => {
    expect(removeHtmlAndFormatting('Text<ref name="a"/> more')).toBe('Text more');
  });

  it('removes <br/> tags', () => {
    expect(removeHtmlAndFormatting('Line1<br/>Line2')).toBe('Line1Line2');
  });

  it('removes bold wiki formatting', () => {
    expect(removeHtmlAndFormatting("'''bold text'''")).toBe('bold text');
  });

  it('removes italic wiki formatting', () => {
    expect(removeHtmlAndFormatting("''italic text''")).toBe('italic text');
  });

  it('removes bold inside italic', () => {
    // '''''text''''' = 5 apostrophes = bold (3) + italic (2)
    // After removing ''' then '', all 5 are consumed
    expect(removeHtmlAndFormatting("'''''bold italic'''''")).toBe('bold italic');
  });

  it('returns empty string for null input', () => {
    expect(removeHtmlAndFormatting(null)).toBe('');
  });
});

// ── removeTables ────────────────────────────────────────────────────────────

describe('removeTables', () => {
  it('removes table start marker', () => {
    expect(removeTables('{| class="wikitable"')).toBe('');
  });

  it('removes table row separator', () => {
    expect(removeTables('|-')).toBe('');
  });

  it('removes table end marker', () => {
    expect(removeTables('|}')).toBe('');
  });

  it('removes cell content lines', () => {
    expect(removeTables('| cell content')).toBe('');
  });

  it('preserves non-table text', () => {
    expect(removeTables('Normal text\n{| class="wikitable"\n| cell\n|}\nMore text'))
      .toBe('Normal text\n\n\n\nMore text');
  });

  it('returns empty string for null input', () => {
    expect(removeTables(null)).toBe('');
  });
});

// ── truncate ────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('returns text as-is when <= maxLength', () => {
    expect(truncate('Short text.', 400)).toBe('Short text.');
  });

  it('truncates at sentence boundary', () => {
    const text = 'First sentence. Second sentence. ' + 'x'.repeat(400);
    const result = truncate(text, 50);
    expect(result).toBe('First sentence. Second sentence....');
  });

  it('truncates at last space when no sentence boundary', () => {
    const text = 'word '.repeat(100);
    const result = truncate(text, 20);
    expect(result.endsWith('...')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(23); // 20 + "..."
  });

  it('appends ... when truncating', () => {
    const text = 'A'.repeat(500);
    const result = truncate(text, 400);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns empty string for null input', () => {
    expect(truncate(null)).toBe('');
    expect(truncate('')).toBe('');
  });

  it('does not truncate text exactly at maxLength', () => {
    const text = 'A'.repeat(400);
    expect(truncate(text, 400)).toBe(text);
  });
});

// ── cleanWikiText ───────────────────────────────────────────────────────────

describe('cleanWikiText', () => {
  it('cleans a complex wiki text', () => {
    const input = "{{Infobox|name=Test}}The '''Twin Mill''' is a [[Hot Wheels|toy car]]. It was released in [[1969]].\n==Description==\nSome details.";
    const result = cleanWikiText(input);
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
    expect(result).not.toContain('[[');
    expect(result).not.toContain(']]');
    expect(result).not.toContain("'''");
    expect(result).not.toMatch(/^={2,}/m);
    expect(result).toContain('toy car');
    expect(result).toContain('Twin Mill');
  });

  it('preserves display text from wiki links', () => {
    const result = cleanWikiText('The [[Bone Shaker|Bone Shaker car]] is cool.');
    expect(result).toContain('Bone Shaker car');
  });

  it('preserves display text from external links', () => {
    const result = cleanWikiText('[https://example.com official site] is great.');
    expect(result).toContain('official site');
  });

  it('truncates long text at sentence boundary', () => {
    const longText = ('This is a sentence. ').repeat(30);
    const result = cleanWikiText(longText, 100);
    expect(result.length).toBeLessThanOrEqual(103);
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns empty string for null input', () => {
    expect(cleanWikiText(null)).toBe('');
    expect(cleanWikiText('')).toBe('');
  });

  it('removes ref tags with content', () => {
    const result = cleanWikiText('Text<ref>some citation</ref> more text.');
    expect(result).not.toContain('<ref>');
    expect(result).not.toContain('</ref>');
    expect(result).toContain('Text');
    expect(result).toContain('more text.');
  });
});

// ── extractDescription ──────────────────────────────────────────────────────

describe('extractDescription', () => {
  it('extracts description skipping infobox', () => {
    const wikitext = '{{Infobox_Car|name=Twin Mill|year=1969}}\nThe Twin Mill is a classic Hot Wheels car. It was first released in 1969.';
    const result = extractDescription(wikitext);
    expect(result).toContain('Twin Mill');
    expect(result).not.toContain('{{');
    expect(result).not.toContain('Infobox');
  });

  it('stops at first section heading', () => {
    const wikitext = 'The car is great. It has a V8 engine.\n== Versions ==\nVersion 1 details.';
    const result = extractDescription(wikitext);
    expect(result).toContain('The car is great');
    expect(result).not.toContain('Version 1');
  });

  it('returns empty string for null input', () => {
    expect(extractDescription(null)).toBe('');
    expect(extractDescription('')).toBe('');
  });

  it('handles text with nested templates', () => {
    const wikitext = '{{casting|name={{link|Twin Mill}}|year=1969}}The car is awesome.';
    const result = extractDescription(wikitext);
    expect(result).not.toContain('{{');
    expect(result).not.toContain('}}');
    expect(result).toContain('The car is awesome');
  });

  it('truncates long descriptions', () => {
    const wikitext = ('This is a long sentence about cars. ').repeat(20);
    const result = extractDescription(wikitext, 100);
    expect(result.length).toBeLessThanOrEqual(103);
  });
});
