/**
 * Hot Wheels Hub — Main Application
 * Loads data from JSON, renders all sections, handles interactions
 */
(function () {
  'use strict';

  const DATA_BASE = 'data';
  let allData = { featured: [], series: [], news: [], releases: [], gallery: [], newCastings: [], metadata: {} };

  // ── Data Loading ───────────────────────────────────────────────────────────

  async function loadJSON(file) {
    try {
      const r = await fetch(`${DATA_BASE}/${file}`);
      if (!r.ok) return null;
      return await r.json();
    } catch { return null; }
  }

  async function loadAllData() {
    const [featured, series, news, releases, gallery, newCastings, metadata] = await Promise.all([
      loadJSON('featured.json'), loadJSON('series.json'),
      loadJSON('news.json'), loadJSON('releases.json'),
      loadJSON('gallery.json'), loadJSON('new-castings.json'),
      loadJSON('metadata.json')
    ]);
    allData.featured = featured || [];
    allData.series = series || [];
    allData.news = news || [];
    allData.releases = releases || [];
    allData.gallery = gallery || [];
    allData.newCastings = newCastings || [];
    allData.metadata = metadata || {};
  }

  // ── Renderers ──────────────────────────────────────────────────────────────

  function renderStats() {
    const m = allData.metadata;
    document.getElementById('statCars').textContent = (m.stats?.totalFeatured || allData.featured.length) + '+';
    document.getElementById('statSeries').textContent = (m.stats?.totalSeries || allData.series.length) + '+';
    document.getElementById('statImages').textContent = (m.stats?.totalGallery || allData.gallery.length) + '+';
    const castingsEl = document.getElementById('statCastings');
    if (castingsEl) {
      castingsEl.textContent = (m.stats?.totalNewCastings || allData.newCastings.length) + '+';
    }
    const updated = m.lastUpdated ? timeAgo(new Date(m.lastUpdated)) : '--';
    document.getElementById('statUpdated').textContent = updated;
  }

  function renderFeatured() {
    const slider = document.getElementById('featuredSlider');
    const grid = document.getElementById('featuredGrid');
    const items = allData.featured;
    if (!items.length) {
      slider.innerHTML = grid.innerHTML = emptyState('经典车型数据加载中...', '🏎️');
      return;
    }
    // Slider: first 8
    slider.innerHTML = items.slice(0, 8).map(car => `
      <div class="slider-card" onclick="window.open('${car.url}','_blank')">
        <div class="slider-img">${car.image ? `<img src="${car.image}" alt="${esc(car.name)}" loading="lazy">` : placeholder()}</div>
        <div class="slider-info">
          <h3>${esc(car.name)}</h3>
          <p>${esc(car.description || '')}</p>
          <div class="slider-meta">
            ${car.year ? `<span>${car.year}</span>` : ''}
            ${car.series ? `<span>${esc(car.series)}</span>` : ''}
            ${car.color ? `<span>${esc(car.color)}</span>` : ''}
          </div>
        </div>
      </div>
    `).join('');
    // Grid: all
    grid.innerHTML = items.map(car => cardHTML(car)).join('');
  }

  function renderReleases() {
    const grid = document.getElementById('releasesGrid');
    const filter = document.getElementById('releasesFilter');
    const items = allData.releases;
    if (!items.length) {
      grid.innerHTML = emptyState('暂无新车型数据', '📋');
      return;
    }
    // Year filter
    const years = [...new Set(items.map(r => r.year))].sort((a, b) => b - a);
    filter.innerHTML = `<button class="filter-btn active" data-year="all">全部</button>` +
      years.map(y => `<button class="filter-btn" data-year="${y}">${y}</button>`).join('');

    function renderFiltered(year) {
      const filtered = year === 'all' ? items : items.filter(r => r.year === year);
      grid.innerHTML = filtered.map(r => releaseCard(r)).join('');
      observeFadeIns(grid);
    }
    renderFiltered('all');
    filter.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      filter.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFiltered(btn.dataset.year);
    });
  }

  function renderSeries() {
    const grid = document.getElementById('seriesGrid');
    const items = allData.series;
    if (!items.length) {
      grid.innerHTML = emptyState('系列数据加载中...', '📦');
      return;
    }
    const icons = ['🏎️', '⚡', '🔥', '🏆', '🚀', '💎', '🏁', '🛞', '💨', '🌟', '🎯', '🛠️', '🎨', '🦇', '🌊'];
    grid.innerHTML = items.map((s, i) => `
      <div class="series-card fade-in" onclick="window.open('${s.url}','_blank')">
        <div class="series-icon">${icons[i % icons.length]}</div>
        <h3>${esc(s.name)}</h3>
        <p>${esc(s.description || '')}</p>
        <span class="series-link">了解更多 →</span>
      </div>
    `).join('');
    observeFadeIns(grid);
  }

  function renderNews() {
    const grid = document.getElementById('newsGrid');
    const items = allData.news;
    if (!items.length) {
      grid.innerHTML = emptyState('暂无最新资讯', '📰');
      return;
    }
    grid.innerHTML = items.slice(0, 12).map(n => `
      <a href="${n.url}" target="_blank" rel="noopener" class="news-card fade-in">
        <div class="news-img">
          ${n.image ? `<img src="${n.image}" alt="${esc(n.title)}" loading="lazy">` : '<div style="width:100%;height:100%;background:linear-gradient(135deg,#1a1a1a,#222)"></div>'}
        </div>
        <div class="news-body">
          <h3>${esc(n.title)}</h3>
          <p>${esc(n.summary || '')}</p>
          <div class="news-meta">
            <span class="news-source">${esc(n.source || 'Hot Wheels')}</span>
            <span>${n.date || ''}</span>
          </div>
        </div>
      </a>
    `).join('');
    observeFadeIns(grid);
  }

  function renderGallery() {
    const grid = document.getElementById('galleryGrid');
    const items = allData.gallery;
    if (!items.length) {
      grid.innerHTML = emptyState('图片加载中...', '🖼️');
      return;
    }
    grid.innerHTML = items.map(img => `
      <div class="gallery-item fade-in" data-full="${img.fullUrl || img.url}" data-title="${esc(img.title)}" data-source="${esc(img.source || '')}">
        <img src="${img.url}" alt="${esc(img.title)}" loading="lazy">
        <div class="gallery-overlay">
          <h4>${esc(img.title)}</h4>
          <p>${esc(img.source || 'Hot Wheels')}</p>
        </div>
      </div>
    `).join('');
    observeFadeIns(grid);
  }

  function renderNewCastings() {
    const grid = document.getElementById('castingsGrid');
    const items = allData.newCastings;
    if (!items.length) { grid.innerHTML = emptyState('暂无新模具数据', '🆕'); return; }
    grid.innerHTML = items.map(c => `
      <div class="card fade-in" onclick="window.open('${c.url}','_blank')">
        <div class="card-img-wrap">
          ${c.image ? `<img src="${c.image}" alt="${esc(c.name)}" loading="lazy">` : placeholder()}
          ${c.year ? `<span class="card-badge">${c.year}</span>` : ''}
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(c.name)}</h3>
          <p class="card-meta">${esc(c.firstSeries || c.designer || '')}</p>
        </div>
      </div>
    `).join('');
    observeFadeIns(grid);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function cardHTML(car) {
    return `
      <div class="card fade-in" onclick="window.open('${car.url}','_blank')">
        <div class="card-img-wrap">
          ${car.image ? `<img src="${car.image}" alt="${esc(car.name)}" loading="lazy">` : placeholder()}
          ${car.year ? `<span class="card-badge">${car.year}</span>` : ''}
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(car.name)}</h3>
          <p class="card-meta">${esc(car.series || car.color || '')}</p>
        </div>
      </div>
    `;
  }

  function releaseCard(r) {
    const hasImg = r.cars?.[0]?.image;
    return `
      <div class="card fade-in">
        <div class="card-img-wrap">
          ${hasImg ? `<img src="${r.cars[0].image}" alt="${esc(r.series)}" loading="lazy">` : placeholder()}
          <span class="card-badge">${r.year}</span>
        </div>
        <div class="card-body">
          <h3 class="card-title">${esc(r.series)}</h3>
          <p class="card-meta">${esc(r.description || '')}</p>
        </div>
      </div>
    `;
  }

  function placeholder() {
    return '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#1a1a1a,#252525);font-size:3rem">🏎️</div>';
  }

  function emptyState(msg, icon = '📭') {
    return `<div class="empty-state"><div class="emoji">${icon}</div><h3>${msg}</h3><p>数据正在自动更新中，请稍后刷新</p></div>`;
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function timeAgo(date) {
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return '刚刚';
    if (s < 3600) return Math.floor(s / 60) + '分钟前';
    if (s < 86400) return Math.floor(s / 3600) + '小时前';
    return Math.floor(s / 86400) + '天前';
  }

  // ── Intersection Observer (fade-in) ────────────────────────────────────────

  let observer;
  function observeFadeIns(container) {
    if (!observer) {
      observer = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('visible');
            observer.unobserve(e.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });
    }
    (container || document).querySelectorAll('.fade-in:not(.visible)').forEach(el => observer.observe(el));
  }

  // ── Lightbox ───────────────────────────────────────────────────────────────

  function initLightbox() {
    const lb = document.getElementById('lightbox');
    const lbImg = document.getElementById('lightboxImg');
    const lbInfo = document.getElementById('lightboxInfo');
    const lbClose = lb.querySelector('.lightbox-close');

    document.addEventListener('click', e => {
      const item = e.target.closest('.gallery-item');
      if (!item) return;
      lbImg.src = item.dataset.full;
      lbImg.alt = item.dataset.title;
      lbInfo.innerHTML = `<h4>${item.dataset.title}</h4><p>${item.dataset.source}</p>`;
      lb.classList.add('active');
      document.body.style.overflow = 'hidden';
    });

    lbClose.addEventListener('click', closeLb);
    lb.addEventListener('click', e => { if (e.target === lb) closeLb(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });

    function closeLb() {
      lb.classList.remove('active');
      document.body.style.overflow = '';
    }
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function initNavigation() {
    const header = document.getElementById('header');
    const toggle = document.getElementById('mobileToggle');
    const links = document.getElementById('navLinks');
    const navItems = links.querySelectorAll('.nav-link');

    // Scroll effects
    let ticking = false;
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          header.classList.toggle('scrolled', window.scrollY > 60);
          updateActiveNav(navItems);
          ticking = false;
        });
        ticking = true;
      }
    });

    // Mobile toggle
    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      links.classList.toggle('open');
    });

    // Close mobile menu on link click
    links.addEventListener('click', e => {
      if (e.target.closest('.nav-link')) {
        toggle.classList.remove('active');
        links.classList.remove('open');
      }
    });
  }

  function updateActiveNav(navItems) {
    const sections = document.querySelectorAll('.section, .hero');
    let current = 'home';
    sections.forEach(s => {
      if (window.scrollY >= s.offsetTop - 200) {
        current = s.id || 'home';
      }
    });
    navItems.forEach(link => {
      link.classList.toggle('active', link.getAttribute('data-nav') === current ||
        link.getAttribute('href') === `#${current}`);
    });
  }

  // ── Skeleton Loading ───────────────────────────────────────────────────────

  function showSkeletons() {
    const cards = 6;
    ['featuredGrid', 'releasesGrid', 'seriesGrid'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = Array(cards).fill(0).map(() =>
        '<div class="card"><div class="card-img-wrap skeleton" style="aspect-ratio:4/3"></div><div class="card-body"><div class="skeleton" style="height:16px;width:70%;margin-bottom:8px"></div><div class="skeleton" style="height:12px;width:50%"></div></div></div>'
      ).join('');
    });
    ['featuredSlider'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = Array(4).fill(0).map(() =>
        '<div class="slider-card"><div class="skeleton" style="aspect-ratio:3/2"></div><div style="padding:20px"><div class="skeleton" style="height:16px;width:60%;margin-bottom:10px"></div><div class="skeleton" style="height:12px;width:80%"></div></div></div>'
      ).join('');
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    showSkeletons();
    initNavigation();
    initLightbox();

    await loadAllData();

    renderStats();
    renderFeatured();
    renderReleases();
    renderNewCastings();
    renderSeries();
    renderNews();
    renderGallery();

    // Initialize search
    const searchEngine = new SearchEngine();
    searchEngine.buildIndex(allData);
    const searchUI = new SearchUI(
      document.getElementById('searchInput'),
      document.getElementById('searchResults'),
      searchEngine
    );
    searchUI.init();

    observeFadeIns();
    document.getElementById('loader').classList.add('hidden');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
