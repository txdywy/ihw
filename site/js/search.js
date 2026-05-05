/**
 * Hot Wheels Hub — Search Module
 * Client-side fuzzy search across all loaded data
 */

/**
 * SearchEngine — builds an index from all data and performs keyword matching
 */
class SearchEngine {
  constructor() {
    this._index = [];
  }

  /**
   * Build search index from all loaded data
   * Indexes: featured, releases (flatten cars from groups), newCastings, gallery
   */
  buildIndex(allData) {
    this._index = [];

    // Index featured cars
    if (allData.featured && allData.featured.length) {
      allData.featured.forEach(car => {
        this._index.push({
          name: car.name || '',
          image: car.image || null,
          category: '经典名车',
          url: car.url || '',
          sectionId: 'featured'
        });
      });
    }

    // Index releases (flatten cars from groups)
    if (allData.releases && allData.releases.length) {
      allData.releases.forEach(group => {
        if (group.cars && group.cars.length) {
          group.cars.forEach(car => {
            this._index.push({
              name: car.name || group.series || '',
              image: car.image || null,
              category: '新车速递',
              url: car.url || group.url || '',
              sectionId: 'releases'
            });
          });
        } else {
          // Group without individual cars — index the group itself
          this._index.push({
            name: group.series || '',
            image: null,
            category: '新车速递',
            url: group.url || '',
            sectionId: 'releases'
          });
        }
      });
    }

    // Index new castings
    if (allData.newCastings && allData.newCastings.length) {
      allData.newCastings.forEach(c => {
        this._index.push({
          name: c.name || '',
          image: c.image || null,
          category: '新模具',
          url: c.url || '',
          sectionId: 'new-castings'
        });
      });
    }

    // Index Elite 64
    if (allData.elite64 && allData.elite64.length) {
      allData.elite64.forEach(c => {
        this._index.push({
          name: c.name || '',
          image: c.image || null,
          category: 'Elite 64',
          url: c.url || '',
          sectionId: 'elite64'
        });
      });
    }

    // Index series cars (2026 lineup)
    if (allData.seriesCars && allData.seriesCars.length) {
      allData.seriesCars.forEach(group => {
        if (group.cars && group.cars.length) {
          group.cars.forEach(car => {
            this._index.push({
              name: car.name || '',
              image: car.image || null,
              category: '系列新车 · ' + (group.seriesName || ''),
              url: car.url || '',
              sectionId: 'series-cars'
            });
          });
        }
      });
    }

    // Index gallery
    if (allData.gallery && allData.gallery.length) {
      allData.gallery.forEach(img => {
        this._index.push({
          name: img.title || '',
          image: img.url || null,
          category: '图片库',
          url: img.carUrl || img.fullUrl || img.url || '',
          sectionId: 'gallery'
        });
      });
    }
  }

  /**
   * Search the index by query string
   * Splits query into keywords (lowercase), counts matches per entry
   * Returns top maxResults sorted by match count descending
   */
  search(query, maxResults) {
    if (maxResults === undefined) maxResults = 10;
    if (!query || !query.trim()) return [];

    var keywords = query.toLowerCase().split(/\s+/).filter(function(k) { return k.length > 0; });
    if (!keywords.length) return [];

    var scored = [];
    for (var i = 0; i < this._index.length; i++) {
      var entry = this._index[i];
      var nameLower = (entry.name || '').toLowerCase();
      var matchCount = 0;
      for (var j = 0; j < keywords.length; j++) {
        if (nameLower.indexOf(keywords[j]) !== -1) {
          matchCount++;
        }
      }
      if (matchCount > 0) {
        scored.push({ entry: entry, score: matchCount });
      }
    }

    // Sort by score descending
    scored.sort(function(a, b) { return b.score - a.score; });

    // Return top results
    var results = [];
    var limit = Math.min(scored.length, maxResults);
    for (var k = 0; k < limit; k++) {
      results.push(scored[k].entry);
    }
    return results;
  }
}

/**
 * SearchUI — handles input events, debounce, rendering results dropdown
 */
class SearchUI {
  constructor(inputEl, resultsEl, engine) {
    this._input = inputEl;
    this._results = resultsEl;
    this._engine = engine;
    this._debounceTimer = null;
  }

  init() {
    if (!this._input || !this._results) return;

    var self = this;

    // Listen to input events with 300ms debounce
    this._input.addEventListener('input', function() {
      clearTimeout(self._debounceTimer);
      self._debounceTimer = setTimeout(function() {
        var query = self._input.value.trim();
        if (!query) {
          self._close();
          return;
        }
        var results = self._engine.search(query);
        self._renderResults(results);
      }, 300);
    });

    // On Escape: close dropdown
    this._input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        self._close();
        self._input.blur();
      }
    });

    // On click outside: close dropdown
    document.addEventListener('click', function(e) {
      if (!self._input.contains(e.target) && !self._results.contains(e.target)) {
        self._close();
      }
    });
  }

  _renderResults(results) {
    if (!results.length) {
      this._results.innerHTML = '<div class="search-no-results">未找到相关车型</div>';
      this._results.classList.add('active');
      return;
    }

    var self = this;
    var html = results.map(function(r) {
      var imgHtml = r.image
        ? '<img src="' + _escAttr(r.image) + '" alt="' + _escAttr(r.name) + '">'
        : '';
      return '<div class="search-result-item" data-url="' + _escAttr(r.url) + '" data-section="' + _escAttr(r.sectionId) + '">'
        + imgHtml
        + '<div>'
        + '<div class="search-result-name">' + _escHtml(r.name) + '</div>'
        + '<div class="search-result-category">' + _escHtml(r.category) + '</div>'
        + '</div>'
        + '</div>';
    }).join('');

    this._results.innerHTML = html;
    this._results.classList.add('active');

    // Attach click handlers to result items
    var items = this._results.querySelectorAll('.search-result-item');
    items.forEach(function(item) {
      item.addEventListener('click', function() {
        var url = item.getAttribute('data-url');
        var sectionId = item.getAttribute('data-section');
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
          window.open(url, '_blank');
        } else if (sectionId) {
          var section = document.getElementById(sectionId);
          if (section) {
            section.scrollIntoView({ behavior: 'smooth' });
          }
        }
        self._close();
      });
    });
  }

  _close() {
    this._results.classList.remove('active');
    this._results.innerHTML = '';
  }
}

// Simple HTML/attribute escaping helpers
function _escHtml(str) {
  if (!str) return '';
  var d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function _escAttr(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Export on window for use by app.js
window.SearchEngine = SearchEngine;
window.SearchUI = SearchUI;
