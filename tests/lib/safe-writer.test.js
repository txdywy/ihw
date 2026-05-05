import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { safeWriteJSON } from '../../scripts/lib/safe-writer.js';

describe('safeWriteJSON', () => {
  let tmpDir;
  let counter = 0;

  function tmpFile(name) {
    counter++;
    return path.join(tmpDir, `${name}-${counter}-${Date.now()}.json`);
  }

  beforeEach(() => {
    tmpDir = os.tmpdir();
  });

  afterEach(() => {
    // Clean up is best-effort; temp files in os.tmpdir() are fine to leave
  });

  // ── Empty array → no write ──────────────────────────────────────────────

  it('skips writing when data is an empty array', () => {
    const filePath = tmpFile('empty');
    const result = safeWriteJSON(filePath, [], 'TestLabel');

    expect(result.written).toBe(false);
    expect(result.warning).toBe('TestLabel: empty data, skipping write');
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('does not overwrite existing file when data is an empty array', () => {
    const filePath = tmpFile('empty-existing');
    fs.writeFileSync(filePath, JSON.stringify([1, 2, 3], null, 2), 'utf-8');

    const result = safeWriteJSON(filePath, [], 'TestLabel');

    expect(result.written).toBe(false);
    // Original file should still exist with original content
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(content).toEqual([1, 2, 3]);

    fs.unlinkSync(filePath);
  });

  // ── Normal write → written: true, warning: null ─────────────────────────

  it('writes data normally and returns no warning', () => {
    const filePath = tmpFile('normal');
    const data = [{ id: 1, name: 'Twin Mill' }, { id: 2, name: 'Bone Shaker' }];

    const result = safeWriteJSON(filePath, data, 'Cars');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toEqual(data);

    fs.unlinkSync(filePath);
  });

  it('writes with JSON.stringify pretty format (2-space indent)', () => {
    const filePath = tmpFile('format');
    const data = [{ a: 1 }];

    safeWriteJSON(filePath, data, 'Format');

    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw).toBe(JSON.stringify(data, null, 2));

    fs.unlinkSync(filePath);
  });

  // ── Significant drop → written: true, warning not null ──────────────────

  it('warns when data count drops significantly', () => {
    const filePath = tmpFile('drop');
    // Write 20 items as existing data
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    // Write only 5 items (25% of 20, which is < 50%)
    const newData = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = safeWriteJSON(filePath, newData, 'Cars');

    expect(result.written).toBe(true);
    expect(result.warning).not.toBeNull();
    expect(result.warning).toContain('data count dropped significantly');
    expect(result.warning).toContain('20');
    expect(result.warning).toContain('5');

    // File should still be written with new data
    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toEqual(newData);

    fs.unlinkSync(filePath);
  });

  it('does not warn when data count is exactly 50% of existing', () => {
    const filePath = tmpFile('boundary');
    const existing = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    // 5 items = exactly 50% of 10, should NOT trigger warning
    const newData = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const result = safeWriteJSON(filePath, newData, 'Cars');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    fs.unlinkSync(filePath);
  });

  it('warns when data count is just below 50% of existing', () => {
    const filePath = tmpFile('below-boundary');
    const existing = Array.from({ length: 10 }, (_, i) => ({ id: i }));
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8');

    // 4 items = 40% of 10, should trigger warning
    const newData = Array.from({ length: 4 }, (_, i) => ({ id: i }));
    const result = safeWriteJSON(filePath, newData, 'Cars');

    expect(result.written).toBe(true);
    expect(result.warning).not.toBeNull();

    fs.unlinkSync(filePath);
  });

  // ── Non-existent file → treats as 0 existing, writes normally ───────────

  it('writes normally when file does not exist (existingCount = 0)', () => {
    const filePath = tmpFile('nonexistent');

    const data = [{ id: 1 }];
    const result = safeWriteJSON(filePath, data, 'NewFile');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toEqual(data);

    fs.unlinkSync(filePath);
  });

  // ── Non-array data (like metadata object) → should still write ──────────

  it('writes non-array data (object) normally', () => {
    const filePath = tmpFile('metadata');
    const metadata = { lastUpdated: '2025-01-01', stats: { total: 42 } };

    const result = safeWriteJSON(filePath, metadata, 'Metadata');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toEqual(metadata);

    fs.unlinkSync(filePath);
  });

  it('writes string data normally', () => {
    const filePath = tmpFile('string');

    const result = safeWriteJSON(filePath, 'hello', 'StringData');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toBe('hello');

    fs.unlinkSync(filePath);
  });

  it('writes non-array data even when existing file has array data', () => {
    const filePath = tmpFile('obj-over-array');
    fs.writeFileSync(filePath, JSON.stringify([1, 2, 3], null, 2), 'utf-8');

    const metadata = { version: 2 };
    const result = safeWriteJSON(filePath, metadata, 'Meta');

    expect(result.written).toBe(true);
    expect(result.warning).toBeNull();

    const written = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    expect(written).toEqual(metadata);

    fs.unlinkSync(filePath);
  });
});
