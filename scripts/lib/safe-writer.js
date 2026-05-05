const fs = require('fs');

/**
 * 安全写入 JSON 文件
 * - 空数组：跳过写入，输出警告
 * - 数量 < 已有文件的 50%：输出警告但仍写入
 * - 正常情况：直接写入
 * @param {string} filePath - 目标文件路径
 * @param {any} data - 要写入的数据
 * @param {string} label - 数据标签（用于日志）
 * @returns {{ written: boolean, warning: string | null }}
 */
function safeWriteJSON(filePath, data, label) {
  // If data is an empty array, skip writing
  if (Array.isArray(data) && data.length === 0) {
    return { written: false, warning: `${label}: empty data, skipping write` };
  }

  // Read existing file to get entry count
  let existingCount = 0;
  try {
    const existing = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    if (Array.isArray(existing)) {
      existingCount = existing.length;
    }
  } catch {
    // File doesn't exist or can't be read — treat as 0
    existingCount = 0;
  }

  // Write the file
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

  // Check for significant drop (only when data is an array and existing was non-zero)
  if (Array.isArray(data) && existingCount > 0 && data.length < existingCount * 0.5) {
    return {
      written: true,
      warning: `${label}: data count dropped significantly (${existingCount} → ${data.length})`,
    };
  }

  return { written: true, warning: null };
}

module.exports = { safeWriteJSON };
