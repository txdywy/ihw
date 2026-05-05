#!/usr/bin/env node
/**
 * One-time script to clean placeholder images from existing data files.
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '_data');
const PLACEHOLDER = /image_not_available/i;

function cleanFile(file) {
  const filePath = path.join(dataDir, file);
  if (!fs.existsSync(filePath)) return;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  if (!Array.isArray(data)) return;

  const before = data.length;
  let cleaned;

  if (file === 'gallery.json') {
    cleaned = data.filter(item => !PLACEHOLDER.test(item.url) && !PLACEHOLDER.test(item.fullUrl));
  } else if (file === 'featured.json') {
    cleaned = data.map(item => {
      if (PLACEHOLDER.test(item.image)) item.image = null;
      if (PLACEHOLDER.test(item.fullImage)) item.fullImage = null;
      return item;
    }).filter(item => item.image !== null);
  } else if (file === 'releases.json') {
    cleaned = data.map(group => {
      if (group.cars) {
        group.cars = group.cars.filter(car => !PLACEHOLDER.test(car.image));
      }
      return group;
    });
  } else if (file === 'news.json') {
    cleaned = data.map(item => {
      if (PLACEHOLDER.test(item.image)) item.image = null;
      return item;
    });
  } else {
    return;
  }

  fs.writeFileSync(filePath, JSON.stringify(cleaned, null, 2), 'utf-8');
  console.log(`${file}: ${before} → ${cleaned.length} entries`);
}

cleanFile('gallery.json');
cleanFile('featured.json');
cleanFile('releases.json');
cleanFile('news.json');
console.log('Done!');
