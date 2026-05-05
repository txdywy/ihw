const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'site');
const DATA_DIR = path.join(ROOT, '_data');
const IMAGES_DIR = path.join(ROOT, 'images');
const OUTPUT_DIR = path.join(ROOT, '_site');

/**
 * Recursively copy a directory's contents to a destination.
 */
function copyDirSync(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Clean and create _site/
if (fs.existsSync(OUTPUT_DIR)) {
  fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
}
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// 2. Copy site/* to _site/
copyDirSync(SITE_DIR, OUTPUT_DIR);
console.log('Copied site/ → _site/');

// 3. Copy _data/*.json to _site/data/
const dataOutputDir = path.join(OUTPUT_DIR, 'data');
fs.mkdirSync(dataOutputDir, { recursive: true });
if (fs.existsSync(DATA_DIR)) {
  for (const file of fs.readdirSync(DATA_DIR)) {
    if (file.endsWith('.json')) {
      fs.copyFileSync(path.join(DATA_DIR, file), path.join(dataOutputDir, file));
    }
  }
  console.log('Copied _data/*.json → _site/data/');
}

// 4. Copy images/* to _site/images/ (if any)
const imagesOutputDir = path.join(OUTPUT_DIR, 'images');
if (fs.existsSync(IMAGES_DIR)) {
  copyDirSync(IMAGES_DIR, imagesOutputDir);
  console.log('Copied images/ → _site/images/');
}

console.log('Build complete: _site/');
