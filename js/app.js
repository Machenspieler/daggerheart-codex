/* ============================================================
   Daggerheart Atlas — app.js
   Vanilla JS, no build step. All state persisted to localStorage
   except the bundled builtin environment data (data/environments.json)
   which stays read-only on disk; user edits layer on top of it.
   ============================================================ */

const LS_KEYS = {
  lang: 'dhcodex_lang',
  customEnvs: 'dhcodex_custom_envs',
  hiddenBuiltin: 'dhcodex_hidden_builtin',
  lists: 'dhcodex_lists',
  envLists: 'dhcodex_env_lists',
  storageNoticeDismissed: 'dhcodex_storage_notice_dismissed',
};

const BIOMES = ['underground', 'aquatic', 'wetland', 'grassland', 'tropical', 'forest', 'drylands', 'rolling', 'mountain', 'frozen', 'badlands', 'settlement', 'universal'];

function normalizeLang(v) { return v === 'en' ? 'en' : 'ru'; }

const state = {
  lang: normalizeLang(localStorage.getItem(LS_KEYS.lang)),
  i18n: null,
  builtinEnvs: [],
  regions: [],
  customEnvs: JSON.parse(localStorage.getItem(LS_KEYS.customEnvs) || '[]'),
  hiddenBuiltin: JSON.parse(localStorage.getItem(LS_KEYS.hiddenBuiltin) || '[]'),
  lists: JSON.parse(localStorage.getItem(LS_KEYS.lists) || '[]'),
  envLists: JSON.parse(localStorage.getItem(LS_KEYS.envLists) || '{}'),
  storageNoticeDismissed: localStorage.getItem(LS_KEYS.storageNoticeDismissed) === '1',
  filters: { search: '', tiers: new Set(), types: new Set(), biomes: new Set(), regionOnly: false },
  editingEnvId: null,
  route: parseRoute(),
};

function parseRoute() {
  const m = location.hash.match(/^#\/lists\/(.+)$/);
  if (m) return { name: 'list', id: decodeURIComponent(m[1]) };
  if (location.hash === '#/lists') return { name: 'lists' };
  return { name: 'catalog' };
}

function navigate(hash) {
  if (location.hash === hash) { state.route = parseRoute(); render(); }
  else { location.hash = hash; }
}

window.addEventListener('hashchange', () => { state.route = parseRoute(); render(); });

function persist(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function t(key) {
  const dict = state.i18n[state.lang] || {};
  return dict[key] || key;
}

function allEnvs() {
  const builtin = state.builtinEnvs.filter(e => !state.hiddenBuiltin.includes(e.id));
  return [...builtin, ...state.customEnvs];
}

function currentEnvs() {
  if (state.route.name === 'list') {
    return allEnvs().filter(e => (state.envLists[e.id] || []).includes(state.route.id));
  }
  return allEnvs();
}

function envName(env) { return env.name[state.lang] || env.name.en || env.name.ru || '(untitled)'; }
function envField(env, field) {
  const v = env[field];
  if (!v) return state.lang === 'ru' ? [] : [];
  return v[state.lang] && v[state.lang].length ? v[state.lang] : (v.en || v.ru || []);
}
function isTranslated(env) {
  return !!(env.name && env.name.ru && env.name.ru.trim());
}

/* ---------------- regions ---------------- */

/** Environments that belong to the same connected place are grouped into a
 * region in data/regions.json. An environment belongs to at most one region. */
function regionOfEnv(envId) {
  return state.regions.find(r => (r.environments || []).includes(envId)) || null;
}
function regionName(region) {
  return region.name?.[state.lang] || region.name?.en || region.name?.ru || '';
}
/** Region members that actually exist right now (a hidden or removed builtin
 * environment drops out of the button row rather than rendering a dead button). */
function regionMembers(region) {
  const byId = new Map(allEnvs().map(e => [e.id, e]));
  return (region.environments || []).map(id => byId.get(id)).filter(Boolean);
}

/** Difficulty is usually a plain number, but a few environments (e.g. duel
 * events whose difficulty depends on the chosen adversary) store a bilingual
 * descriptive string instead: { en, ru }. */
function envDifficulty(env) {
  const d = env.difficulty;
  if (d && typeof d === 'object') return d[state.lang] || d.en || d.ru || '';
  return d;
}

/* ---------------- init ---------------- */

async function init() {
  const [i18n, envs, regions] = await Promise.all([
    fetch('data/i18n.json').then(r => r.json()),
    fetch('data/environments.json').then(r => r.json()),
    fetch('data/regions.json').then(r => r.json()).catch(() => ({ regions: [] })),
  ]);
  state.i18n = i18n;
  state.builtinEnvs = envs.environments;
  state.regions = regions.regions || [];
  render();
}

/* ---------------- rendering ---------------- */

function render() {
  document.documentElement.lang = state.lang;
  if (state.route.name === 'list' && !state.lists.some(l => l.id === state.route.id)) {
    state.route = { name: 'lists' };
    if (location.hash !== '#/lists') location.hash = '#/lists';
  }
  renderHeader();
  if (state.route.name === 'lists') {
    renderListsHome();
  } else {
    renderToolbar();
    renderGrid();
  }
  renderFooter();
}

function renderHeader() {
  const el = document.getElementById('header');
  const onLists = state.route.name !== 'catalog';
  el.innerHTML = `
    <div class="header-inner">
      <div class="brand" id="brand-home" role="button" tabindex="0">
        ${diceMarkSVG()}
        <div class="brand-text">
          <h1>${t('app_title')}</h1>
          <p>${t('app_subtitle')}</p>
        </div>
      </div>
      <div class="header-actions">
        <div class="lang-switch">
          <button data-lang="ru" class="${state.lang === 'ru' ? 'active' : ''}">RU</button>
          <button data-lang="en" class="${state.lang === 'en' ? 'active' : ''}">EN</button>
        </div>
        <button class="btn ${onLists ? 'active' : ''}" id="btn-lists">${t('nav_lists')}</button>
      </div>
    </div>`;
  el.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      persist(LS_KEYS.lang, state.lang);
      render();
    });
  });
  document.getElementById('btn-lists').addEventListener('click', () => navigate('#/lists'));
  document.getElementById('brand-home').addEventListener('click', () => navigate(''));
}

function diceMarkSVG() {
  return `<svg class="brand-mark" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
    <polygon points="24,3 43,15 43,33 24,45 5,33 5,15" stroke="#d9a441" stroke-width="2" fill="#211c18"/>
    <polygon points="24,3 43,15 24,24 5,15" fill="#3a322b" opacity="0.6"/>
    <polygon points="24,24 43,15 43,33 24,45" fill="#9c2b3b" opacity="0.25"/>
    <text x="24" y="30" font-family="JetBrains Mono, monospace" font-size="13" font-weight="700" fill="#e9dfc7" text-anchor="middle">12</text>
  </svg>`;
}

function renderToolbar() {
  const el = document.getElementById('toolbar');
  const envs = currentEnvs();
  const usedTiers = [...new Set(envs.map(e => e.tier))].sort();
  const types = ['traversal', 'social', 'event', 'exploration'];
  // The region pill sits alongside the type pills but filters on region
  // membership, not env.type. Regions only make sense on the full catalog, so
  // the pill — and any filter left over from it — is dropped elsewhere.
  const showRegionPill = state.route.name === 'catalog';
  if (!showRegionPill) state.filters.regionOnly = false;

  const listBar = state.route.name === 'list' ? (() => {
    const list = state.lists.find(l => l.id === state.route.id);
    return `<div class="list-context-bar">
      <button class="btn btn-sm btn-ghost" id="btn-back-to-lists">${t('back_to_lists')}</button>
      <h2 class="list-context-title">${escapeHtml(list ? list.name : '')}</h2>
    </div>`;
  })() : '';

  el.innerHTML = listBar + `
    <div class="toolbar">
      <div class="field search-field">
        <div class="search-input-wrap">
          <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.6"/>
            <line x1="13.6" y1="13.6" x2="18" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <input type="text" id="f-search" placeholder="${t('search_placeholder')}" value="${escapeAttr(state.filters.search)}">
          <button type="button" class="search-clear-btn" id="f-search-clear" aria-label="${t('clear_filters')}" style="${state.filters.search ? '' : 'display:none;'}">×</button>
        </div>
      </div>
      <div class="field">
        <label>${t('filter_tier')}</label>
        <div class="rank-pills" id="f-tiers">
          ${usedTiers.map(tier => `<button type="button" class="rank-icon ${state.filters.tiers.has(tier) ? 'active' : ''}" data-tier="${tier}"><span>${tier}</span></button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>${t('filter_type')}</label>
        <div class="type-pills" id="f-types">
          ${types.map(type => `<button class="pill ${state.filters.types.has(type) ? 'active' : ''}" data-type="${type}">${t('type_' + type)}</button>`).join('')}
          ${showRegionPill ? `<button class="pill ${state.filters.regionOnly ? 'active' : ''}" data-type="region" id="f-region">${t('region_label')}</button>` : ''}
        </div>
      </div>
      <div class="field">
        <label>${t('filter_biome')}</label>
        <select id="f-biome">
          <option value="">${t('all')}</option>
          ${BIOMES.map(biome => `<option value="${biome}" ${state.filters.biomes.has(biome) ? 'selected' : ''}>${t('biome_' + biome)}</option>`).join('')}
        </select>
      </div>
      <div class="toolbar-spacer"></div>
    </div>`;

  const searchInput = document.getElementById('f-search');
  const searchClearBtn = document.getElementById('f-search-clear');
  searchInput.addEventListener('input', e => {
    state.filters.search = e.target.value;
    searchClearBtn.style.display = e.target.value ? '' : 'none';
    renderGrid();
  });
  searchClearBtn.addEventListener('click', () => {
    state.filters.search = '';
    searchInput.value = '';
    searchClearBtn.style.display = 'none';
    searchInput.focus();
    renderGrid();
  });
  el.querySelectorAll('#f-tiers .rank-icon').forEach(btn => btn.addEventListener('click', () => {
    const tier = Number(btn.dataset.tier);
    toggleSetValue(state.filters.tiers, tier);
    renderToolbar(); renderGrid();
  }));
  el.querySelectorAll('#f-types .pill:not(#f-region)').forEach(btn => btn.addEventListener('click', () => {
    toggleSetValue(state.filters.types, btn.dataset.type);
    renderToolbar(); renderGrid();
  }));
  const regionBtn = document.getElementById('f-region');
  if (regionBtn) regionBtn.addEventListener('click', () => {
    state.filters.regionOnly = !state.filters.regionOnly;
    renderToolbar(); renderGrid();
  });
  document.getElementById('f-biome').addEventListener('change', e => {
    state.filters.biomes = new Set(e.target.value ? [e.target.value] : []);
    renderGrid();
  });
  const backBtn = document.getElementById('btn-back-to-lists');
  if (backBtn) backBtn.addEventListener('click', () => navigate('#/lists'));
}

function toggleSetValue(set, value) { set.has(value) ? set.delete(value) : set.add(value); }

function envMatchesFilters(env) {
  const f = state.filters;
  if (f.search) {
    const featureText = (env.features || []).flatMap(feat => [
      feat.name?.en, feat.name?.ru, feat.description?.en, feat.description?.ru, feat.prompt?.en, feat.prompt?.ru,
    ]);
    const rawText = env.rawText ? [env.rawText.en, env.rawText.ru] : [];
    const hay = [
      env.name.en, env.name.ru,
      ...(env.impulses ? [...(env.impulses.en || []), ...(env.impulses.ru || [])] : []),
      ...(env.potential_adversaries ? [...(env.potential_adversaries.en || []), ...(env.potential_adversaries.ru || [])] : []),
      ...featureText, ...rawText,
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(f.search.toLowerCase())) return false;
  }
  if (f.tiers.size && !f.tiers.has(env.tier)) return false;
  if (f.types.size && !f.types.has(env.type)) return false;
  if (f.regionOnly && !regionOfEnv(env.id)) return false;
  if (f.biomes.size) {
    const envBiomeSet = new Set(env.biomes || []);
    let match = false;
    for (const b of f.biomes) if (envBiomeSet.has(b)) match = true;
    if (!match) return false;
  }
  return true;
}

function sortedFilteredEnvs() {
  return currentEnvs().filter(envMatchesFilters);
}

function renderGrid() {
  const el = document.getElementById('grid-wrap');
  const total = currentEnvs().length;
  const list = sortedFilteredEnvs();

  const countBar = document.getElementById('result-count');
  countBar.innerHTML = `${t('count_showing').replace('{n}', list.length).replace('{total}', total)}` +
    (hasActiveFilters() ? `<button id="clear-filters-btn">${t('clear_filters')}</button>` : '');
  const clearBtn = document.getElementById('clear-filters-btn');
  if (clearBtn) clearBtn.addEventListener('click', () => {
    state.filters = { search: '', tiers: new Set(), types: new Set(), biomes: new Set(), regionOnly: false };
    renderToolbar(); renderGrid();
  });

  if (!list.length) {
    el.innerHTML = (state.route.name === 'list' && total === 0)
      ? `<div class="empty-state"><p>${t('list_empty')}</p><p>${t('list_empty_hint')}</p></div>`
      : `<div class="empty-state"><p>${t('no_results')}</p><p>${t('no_results_hint')}</p></div>`;
    return;
  }

  el.innerHTML = list.map(cardHtml).join('');
  el.querySelectorAll('.card').forEach(card => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
  });
  el.querySelectorAll('[data-add-to-list]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openAddToListPopup(btn.dataset.addToList);
    });
  });
}

function hasActiveFilters() {
  const f = state.filters;
  return f.search || f.tiers.size || f.types.size || f.biomes.size || f.regionOnly;
}

function cardHtml(env) {
  const impulses = envField(env, 'impulses');
  const biomeChips = (env.biomes || []).map(b => `<span class="biome-chip">${t('biome_' + b)}</span>`).join('');
  const badges = [
    env.builtin ? '' : `<span class="badge custom">${t('custom_badge')}</span>`,
    isTranslated(env) ? '' : `<span class="badge pending">${t('untranslated_badge')}</span>`,
  ].join('');
  return `
    <div class="card" data-id="${env.id}" data-type="${env.type}">
      <div class="card-top">
        <div class="card-title-row">
          <h3 class="card-title">${escapeHtml(envName(env))}</h3>
          <button type="button" class="card-add-btn" data-add-to-list="${env.id}" aria-label="${t('add_to_list')}" title="${t('add_to_list')}">+</button>
        </div>
        <span class="rank-icon rank-icon-sm active" title="${t('tier_label')} ${env.tier}"><span>${env.tier}</span></span>
      </div>
      <div class="card-meta">
        <span>${t('type_' + env.type)}</span>
        <span class="diff">${t('difficulty_label')} ${escapeHtml(String(envDifficulty(env)))}</span>
      </div>
      ${impulses.length ? `<div class="card-impulses">${escapeHtml(impulses.join(', '))}</div>` : ''}
      ${biomeChips ? `<div class="card-biomes">${biomeChips}</div>` : ''}
      ${badges}
    </div>`;
}

function renderFooter() {
  const el = document.getElementById('footer');
  const showReset = state.route.name === 'lists';
  el.innerHTML = `
    <span>${t('footer_note')}</span>
    ${showReset ? `<button class="btn btn-sm btn-ghost" id="btn-reset">${t('reset_data')}</button>` : ''}`;
  if (showReset) {
    document.getElementById('btn-reset').addEventListener('click', () => {
      if (confirm(t('reset_confirm'))) {
        localStorage.removeItem(LS_KEYS.customEnvs);
        localStorage.removeItem(LS_KEYS.hiddenBuiltin);
        state.customEnvs = []; state.hiddenBuiltin = [];
        render();
      }
    });
  }
}

/* ---------------- lists ---------------- */

function listEnvCount(listId) {
  return Object.values(state.envLists).filter(ids => (ids || []).includes(listId)).length;
}

function renderListsHome() {
  document.getElementById('toolbar').innerHTML = '';
  document.getElementById('result-count').innerHTML = '';
  const el = document.getElementById('grid-wrap');
  el.innerHTML = `
    <div class="lists-home-wrap" style="grid-column:1/-1">
      ${state.storageNoticeDismissed ? '' : `
      <div class="storage-notice" role="status">
        <span class="storage-notice-icon" aria-hidden="true">!</span>
        <p class="storage-notice-text">${t('storage_notice')}</p>
        <button type="button" class="storage-notice-close" id="storage-notice-close"
                aria-label="${t('dismiss')}" title="${t('dismiss')}">×</button>
      </div>`}
      <div class="new-list-row">
        <input type="text" id="new-list-input" placeholder="${t('new_list_name')}">
        <button class="btn btn-primary" id="new-list-btn">${t('create')}</button>
      </div>
      ${state.lists.length
        ? `<div class="list-cards-grid">${state.lists.map(listCardHtml).join('')}</div>`
        : `<div class="empty-state"><p>${t('no_lists_yet')}</p><p>${t('no_lists_hint')}</p></div>`}
    </div>`;

  const noticeClose = document.getElementById('storage-notice-close');
  if (noticeClose) noticeClose.addEventListener('click', () => {
    state.storageNoticeDismissed = true;
    localStorage.setItem(LS_KEYS.storageNoticeDismissed, '1');
    const notice = noticeClose.closest('.storage-notice');
    if (notice) notice.remove();
  });

  document.getElementById('new-list-btn').addEventListener('click', () => {
    const input = document.getElementById('new-list-input');
    const name = input.value.trim();
    if (!name) return;
    state.lists.push({ id: 'list-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name });
    persist(LS_KEYS.lists, state.lists);
    renderListsHome();
  });

  el.querySelectorAll('.list-rename').forEach(input => {
    input.addEventListener('change', () => {
      const id = input.closest('.list-card').dataset.list;
      const list = state.lists.find(l => l.id === id);
      if (list && input.value.trim()) { list.name = input.value.trim(); persist(LS_KEYS.lists, state.lists); }
    });
  });
  el.querySelectorAll('[data-del-list]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.delList;
      if (!confirm(t('delete_list_confirm'))) return;
      state.lists = state.lists.filter(l => l.id !== id);
      Object.keys(state.envLists).forEach(envId => {
        state.envLists[envId] = (state.envLists[envId] || []).filter(lid => lid !== id);
      });
      persist(LS_KEYS.lists, state.lists);
      persist(LS_KEYS.envLists, state.envLists);
      renderListsHome();
    });
  });
  el.querySelectorAll('[data-open-list]').forEach(btn => {
    btn.addEventListener('click', () => navigate('#/lists/' + encodeURIComponent(btn.dataset.openList)));
  });
}

function listCardHtml(list) {
  return `
    <div class="list-card" data-list="${list.id}">
      <div class="list-card-top">
        <input type="text" value="${escapeAttr(list.name)}" class="list-rename">
        <button class="btn btn-sm btn-danger" data-del-list="${list.id}">${t('delete')}</button>
      </div>
      <div class="list-card-count">${t('list_env_count').replace('{n}', listEnvCount(list.id))}</div>
      <button class="btn btn-sm" data-open-list="${list.id}">${t('open_list')}</button>
    </div>`;
}

function openAddToListPopup(envId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';

  function listRowsHtml() {
    const membership = new Set(state.envLists[envId] || []);
    return state.lists.map(l => `
      <label class="atl-row">
        <input type="checkbox" data-list-toggle="${l.id}" ${membership.has(l.id) ? 'checked' : ''}>
        ${escapeHtml(l.name)}
      </label>`).join('') || `<p class="hint">${t('no_lists_yet')}</p>`;
  }

  overlay.innerHTML = `
    <div class="modal" style="max-width:360px">
      <div class="modal-header">
        <h2 style="font-size:17px">${t('add_to_list')}</h2>
        <button class="modal-close" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div id="atl-list">${listRowsHtml()}</div>
        <div class="new-list-row" style="margin-top:14px">
          <input type="text" id="atl-new-input" placeholder="${t('new_list_name')}">
          <button class="btn btn-primary" id="atl-new-btn">${t('create')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  function bindToggle(cb) {
    cb.addEventListener('change', () => {
      const listId = cb.dataset.listToggle;
      const set = new Set(state.envLists[envId] || []);
      if (cb.checked) set.add(listId); else set.delete(listId);
      state.envLists[envId] = [...set];
      persist(LS_KEYS.envLists, state.envLists);
    });
  }
  overlay.querySelectorAll('[data-list-toggle]').forEach(bindToggle);

  function close() { overlay.remove(); render(); }
  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  overlay.querySelector('#atl-new-btn').addEventListener('click', () => {
    const input = overlay.querySelector('#atl-new-input');
    const name = input.value.trim();
    if (!name) return;
    const list = { id: 'list-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name };
    state.lists.push(list);
    persist(LS_KEYS.lists, state.lists);
    const set = new Set(state.envLists[envId] || []);
    set.add(list.id);
    state.envLists[envId] = [...set];
    persist(LS_KEYS.envLists, state.envLists);
    input.value = '';
    const container = overlay.querySelector('#atl-list');
    container.innerHTML = listRowsHtml();
    container.querySelectorAll('[data-list-toggle]').forEach(bindToggle);
  });
}

/* ---------------- detail modal ---------------- */

function openDetail(envId) {
  const env = allEnvs().find(e => e.id === envId);
  if (!env) return;
  const impulses = envField(env, 'impulses');
  const adversaries = envField(env, 'potential_adversaries');

  const featureHtml = f => {
    const fname = f.name[state.lang] || f.name.en || f.name.ru;
    const fdesc = f.description[state.lang] || f.description.en || f.description.ru || '';
    const fprompt = (f.prompt && (f.prompt[state.lang] || f.prompt.en || f.prompt.ru)) || '';
    return `
      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">${escapeHtml(fname)}</span>
          <span class="feature-type ${f.type}">${t('feature_' + f.type)}</span>
        </div>
        <div class="feature-desc" data-rich-block="${encodeURIComponent(fdesc)}"></div>
        ${fprompt ? `<p class="feature-prompt">${escapeHtml(fprompt)}</p>` : ''}
      </div>`;
  };

  const featuresHtml = ['passive', 'reaction', 'action']
    .map(type => (env.features || []).filter(f => f.type === type).map(featureHtml).join(''))
    .filter(Boolean)
    .join('<hr class="feature-group-divider">');

  const rawHtml = env.rawText && (env.rawText.en || env.rawText.ru) ? `
    <span class="section-label">${t('raw_text_label')}</span>
    <div class="feature-desc" data-rich-block="${encodeURIComponent(env.rawText[state.lang] || env.rawText.en || env.rawText.ru || '')}"></div>
  ` : '';

  const region = regionOfEnv(env.id);
  const members = region ? regionMembers(region) : [];
  const regionHtml = members.length > 1 ? `
    <div class="region-block">
      <span class="section-label">${t('region_label')}</span>
      <p class="region-name">${escapeHtml(regionName(region))}</p>
      <div class="region-envs">
        ${members.map(member => member.id === env.id
          ? `<button type="button" class="region-env-btn active" disabled aria-current="true">${escapeHtml(envName(member))}<span class="region-env-tier">${member.tier}</span></button>`
          : `<button type="button" class="region-env-btn" data-region-env="${member.id}">${escapeHtml(envName(member))}<span class="region-env-tier">${member.tier}</span></button>`
        ).join('')}
      </div>
    </div>` : '';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div>
          <div class="modal-title-row">
            <h2>${escapeHtml(envName(env))}</h2>
            <button type="button" class="card-add-btn" id="detail-add-to-list" aria-label="${t('add_to_list')}" title="${t('add_to_list')}">+</button>
          </div>
          <div class="modal-sub">${t('type_' + env.type)} — ${t('tier_label')} ${env.tier}</div>
        </div>
        <button class="modal-close" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div class="stat-row">
          <div class="stat-block-item"><span class="k">${t('tier_label')}</span><span class="v">${env.tier}</span></div>
          <div class="stat-block-item"><span class="k">${t('difficulty_label')}</span><span class="v">${escapeHtml(String(envDifficulty(env)))}</span></div>
          <div class="stat-block-item"><span class="k">${t('filter_type')}</span><span class="v">${t('type_' + env.type)}</span></div>
        </div>

        ${(env.biomes || []).length ? `<span class="section-label">${t('filter_biome')}</span><div class="card-biomes">${env.biomes.map(b => `<span class="biome-chip">${t('biome_' + b)}</span>`).join('')}</div>` : ''}
        ${impulses.length ? `<span class="section-label">${t('impulses_label')}</span><p class="impulse-list">${escapeHtml(impulses.join(', '))}</p>` : ''}
        ${adversaries.length ? `<span class="section-label">${t('adversaries_label')}</span><p class="adversary-list">${escapeHtml(adversaries.join('; '))}</p>` : ''}
        ${featuresHtml ? `<span class="section-label">${t('features_label')}</span>${featuresHtml}` : ''}
        ${rawHtml}
        ${regionHtml}

        <div class="form-actions" style="margin-top:22px">
          <button class="btn" id="detail-add-to-list-bottom">${t('add_to_list')}</button>
          ${!env.builtin ? `<button class="btn" id="detail-edit">${t('edit')}</button>` : ''}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // render dice- and countdown-enabled text, with bullet-list support
  overlay.querySelectorAll('[data-rich-block]').forEach(node => {
    const text = decodeURIComponent(node.getAttribute('data-rich-block'));
    node.removeAttribute('data-rich-block');
    renderFeatureBody(node, text);
  });

  function closeDetail() {
    (overlay._countdownOverlays || []).slice().forEach(p => p.remove());
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape') closeDetail();
  }
  document.addEventListener('keydown', onKeyDown);

  overlay.querySelector('.modal-close').addEventListener('click', closeDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDetail(); });

  const editBtn = overlay.querySelector('#detail-edit');
  if (editBtn) editBtn.addEventListener('click', () => { closeDetail(); openEditForm(env.id); });

  overlay.querySelectorAll('[data-region-env]').forEach(btn => btn.addEventListener('click', () => {
    const nextId = btn.dataset.regionEnv;
    closeDetail();
    openDetail(nextId);
  }));

  overlay.querySelector('#detail-add-to-list').addEventListener('click', () => openAddToListPopup(env.id));
  overlay.querySelector('#detail-add-to-list-bottom').addEventListener('click', () => openAddToListPopup(env.id));
}

/* ---------------- dice parsing + rolling ---------------- */

const DICE_RE = /\b(\d{0,2})d(3|4|6|8|10|12|20|100)\b/gi;
const COUNTDOWN_KEYWORD_RE = /(Countdown|Отсчёт\w*|Отсчет\w*|Счётчик\w*|Счетчик\w*)/gi;
const COUNTDOWN_PAREN_RE = /\(\s*(?:(?:Loop|Цикл)\s+)?(?:\d*d)?(\d+)\s*\)/gi;

/** Finds "<...Countdown/Отсчёт...> (6)"-style spans in free text: scans for a
 * plain integer, optionally prefixed by a "Loop"/"Цикл" qualifier and/or dice
 * notation (e.g. "(6)", "(Loop 1d6)", "(Цикл d20)"), then walks back to the
 * nearest sentence boundary and takes the text from the closest preceding
 * countdown keyword up to the parens. A "Loop XdY" countdown starts at the
 * die's max (Y), not a dice roll, so this is matched ahead of the plain
 * dice-roll regex to keep it out of a roll button. */
function findCountdownMatches(text) {
  const matches = [];
  COUNTDOWN_PAREN_RE.lastIndex = 0;
  let m;
  while ((m = COUNTDOWN_PAREN_RE.exec(text))) {
    const parenStart = m.index;
    const parenEnd = m.index + m[0].length;
    const before = text.slice(0, parenStart);
    let boundary = -1;
    for (let i = before.length - 1; i >= 0; i--) {
      if ('.!?\n'.includes(before[i])) { boundary = i; break; }
    }
    const segmentStart = boundary + 1;
    const segment = text.slice(segmentStart, parenStart);
    let kwMatch = null, mm;
    COUNTDOWN_KEYWORD_RE.lastIndex = 0;
    while ((mm = COUNTDOWN_KEYWORD_RE.exec(segment))) kwMatch = mm;
    if (!kwMatch) continue;
    const labelStart = segmentStart + kwMatch.index;
    matches.push({ start: labelStart, end: parenEnd, type: 'countdown', value: parseInt(m[1], 10), label: text.slice(labelStart, parenEnd) });
  }
  return matches;
}

function findDiceMatches(text) {
  const matches = [];
  DICE_RE.lastIndex = 0;
  let m;
  while ((m = DICE_RE.exec(text))) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    matches.push({ start: m.index, end: m.index + m[0].length, type: 'dice', count, sides, label: m[0] });
  }
  return matches;
}

function renderRichText(container, text) {
  container.textContent = '';
  const matches = [...findDiceMatches(text), ...findCountdownMatches(text)].sort((a, b) => a.start - b.start);

  let lastIndex = 0;
  for (const match of matches) {
    if (match.start < lastIndex) continue; // skip overlapping match
    if (match.start > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
    if (match.type === 'dice') container.appendChild(makeDiceButton(match.count, match.sides, match.label));
    else container.appendChild(makeCountdownButton(match.value, match.label));
    lastIndex = match.end;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
}

const BULLET_LINE_RE = /^[-•]\s+/;

/** Splits feature/raw text into paragraphs and "- "/"• "-prefixed bullet lists,
 * rendering dice/countdown spans within each line via renderRichText. */
function renderFeatureBody(container, text) {
  container.innerHTML = '';
  const lines = text.split('\n');
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    renderRichText(p, para.join(' '));
    container.appendChild(p);
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (BULLET_LINE_RE.test(line)) {
      flushPara();
      const ul = document.createElement('ul');
      ul.className = 'feature-bullets';
      while (i < lines.length && BULLET_LINE_RE.test(lines[i].trim())) {
        const li = document.createElement('li');
        renderRichText(li, lines[i].trim().replace(BULLET_LINE_RE, ''));
        ul.appendChild(li);
        i++;
      }
      container.appendChild(ul);
      continue;
    }
    if (line) para.push(line);
    i++;
  }
  flushPara();
}

function makeDiceButton(count, sides, label) {
  const btn = document.createElement('button');
  btn.className = 'dice-btn';
  btn.type = 'button';
  btn.innerHTML = `${diceIconSVG()}<span>${label}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    rollDice(btn, count, sides, label);
  });
  return btn;
}

function diceIconSVG() {
  return `<svg viewBox="0 0 24 24" fill="none"><polygon points="12,2 21,8 21,16 12,22 3,16 3,8" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

/* ---------------- countdown tracker ---------------- */

function makeCountdownButton(value, label) {
  const btn = document.createElement('button');
  btn.className = 'countdown-btn';
  btn.type = 'button';
  btn.dataset.count = String(value);
  btn.innerHTML = `${countdownIconSVG()}<span>${escapeHtml(label)}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openCountdownOverlay(btn);
  });
  return btn;
}

function countdownIconSVG() {
  return `<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>`;
}

function openCountdownOverlay(btn) {
  if (btn._countdownOverlay && document.body.contains(btn._countdownOverlay)) {
    btn._countdownOverlay.querySelector('.countdown-overlay-close').focus();
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'countdown-overlay';
  panel.innerHTML = `
    <button type="button" class="countdown-overlay-close" aria-label="${t('close')}">&times;</button>
    <div class="countdown-overlay-value">${btn.dataset.count}</div>
    <div class="countdown-overlay-actions">
      <button type="button" class="countdown-overlay-btn" data-op="dec" aria-label="-">&minus;</button>
      <button type="button" class="countdown-overlay-btn" data-op="inc" aria-label="+">+</button>
    </div>`;
  let stack = document.getElementById('countdown-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'countdown-stack';
    stack.className = 'countdown-stack';
    document.body.appendChild(stack);
  }
  stack.appendChild(panel);
  btn._countdownOverlay = panel;

  const valueEl = panel.querySelector('.countdown-overlay-value');
  panel.querySelector('[data-op="inc"]').addEventListener('click', () => {
    btn.dataset.count = String(Number(btn.dataset.count) + 1);
    valueEl.textContent = btn.dataset.count;
  });
  panel.querySelector('[data-op="dec"]').addEventListener('click', () => {
    btn.dataset.count = String(Math.max(0, Number(btn.dataset.count) - 1));
    valueEl.textContent = btn.dataset.count;
  });

  function closePanel() {
    panel.remove();
    btn._countdownOverlay = null;
    const modalOverlay = btn.closest('.modal-overlay');
    if (modalOverlay && modalOverlay._countdownOverlays) {
      modalOverlay._countdownOverlays = modalOverlay._countdownOverlays.filter(p => p !== panel);
    }
  }
  panel.querySelector('.countdown-overlay-close').addEventListener('click', closePanel);

  const modalOverlay = btn.closest('.modal-overlay');
  if (modalOverlay) {
    if (!modalOverlay._countdownOverlays) modalOverlay._countdownOverlays = [];
    modalOverlay._countdownOverlays.push(panel);
  }
}

function rollDice(btn, count, sides, label) {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);
  showDiceResultPop(btn, label, rolls, total);
}

function showDiceResultPop(btn, label, rolls, total) {
  const rect = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'dice-result-pop';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 110)) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  pop.innerHTML = `<div class="notation">${label}</div><div class="value">${total}</div>`;
  if (rolls.length > 1) {
    const bd = document.createElement('div');
    bd.className = 'breakdown';
    bd.textContent = rolls.join(' + ');
    pop.appendChild(bd);
  }
  document.body.appendChild(pop);
  pop.addEventListener('click', () => pop.remove());
  setTimeout(() => pop.remove(), 2600);
}

/* ---------------- add / edit environment form ---------------- */

function openEditForm(envId) {
  const existing = envId ? state.customEnvs.find(e => e.id === envId) : null;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:640px">
      <div class="modal-header">
        <h2>${existing ? t('edit') : t('modal_add_title')}</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body form-body">
        <div class="form-grid">
          <div class="form-field"><label>${t('form_name_en')}</label><input id="fe-name-en" value="${escapeAttr(existing?.name?.en || '')}"></div>
          <div class="form-field"><label>${t('form_name_ru')}</label><input id="fe-name-ru" value="${escapeAttr(existing?.name?.ru || '')}"></div>
          <div class="form-field"><label>${t('form_tier')}</label>
            <select id="fe-tier">${[1,2,3,4].map(n => `<option value="${n}" ${existing?.tier === n ? 'selected' : ''}>${n}</option>`).join('')}</select>
          </div>
          <div class="form-field"><label>${t('form_type')}</label>
            <select id="fe-type">${['traversal','social','event','exploration'].map(ty => `<option value="${ty}" ${existing?.type === ty ? 'selected' : ''}>${t('type_' + ty)}</option>`).join('')}</select>
          </div>
          <div class="form-field"><label>${t('form_difficulty')}</label><input id="fe-difficulty" type="number" value="${existing?.difficulty ?? 12}"></div>
        </div>
        <div class="form-field field-wide"><label>${t('form_biomes')}</label>
          <div class="biome-pills" id="fe-biomes">
            ${BIOMES.map(b => `<button type="button" class="pill ${(existing?.biomes || []).includes(b) ? 'active' : ''}" data-biome="${b}">${t('biome_' + b)}</button>`).join('')}
          </div>
        </div>
        <div class="form-field field-wide"><label>${t('form_impulses')}</label><input id="fe-impulses" value="${escapeAttr((existing?.impulses?.ru || existing?.impulses?.en || []).join(', '))}"></div>
        <div class="form-field field-wide"><label>${t('form_adversaries')}</label><input id="fe-adversaries" value="${escapeAttr((existing?.potential_adversaries?.ru || existing?.potential_adversaries?.en || []).join(', '))}"></div>
        <div class="form-field field-wide"><label>${t('form_raw_en')}</label><textarea id="fe-raw-en">${escapeHtml(existing?.rawText?.en || '')}</textarea></div>
        <div class="form-field field-wide"><label>${t('form_raw_ru')}</label><textarea id="fe-raw-ru">${escapeHtml(existing?.rawText?.ru || '')}</textarea></div>
        <p class="hint">${t('form_raw_en')}</p>
        <div class="form-actions">
          <button class="btn" id="fe-cancel">${t('cancel')}</button>
          <button class="btn btn-primary" id="fe-save">${t('save')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#fe-cancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelectorAll('#fe-biomes .pill').forEach(btn => btn.addEventListener('click', () => btn.classList.toggle('active')));

  overlay.querySelector('#fe-save').addEventListener('click', () => {
    const nameEn = overlay.querySelector('#fe-name-en').value.trim();
    const nameRu = overlay.querySelector('#fe-name-ru').value.trim();
    if (!nameEn && !nameRu) { overlay.querySelector('#fe-name-en').focus(); return; }
    const rec = existing || { id: 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), builtin: false, features: [] };
    rec.name = { en: nameEn, ru: nameRu };
    rec.tier = Number(overlay.querySelector('#fe-tier').value);
    rec.type = overlay.querySelector('#fe-type').value;
    rec.difficulty = Number(overlay.querySelector('#fe-difficulty').value);
    rec.biomes = [...overlay.querySelectorAll('#fe-biomes .pill.active')].map(btn => btn.dataset.biome);
    const impulses = overlay.querySelector('#fe-impulses').value.split(',').map(s => s.trim()).filter(Boolean);
    const adversaries = overlay.querySelector('#fe-adversaries').value.split(',').map(s => s.trim()).filter(Boolean);
    // Impulses/adversaries are entered once, in whichever language is active right now.
    rec.impulses = { en: [], ru: [] };
    rec.impulses[state.lang] = impulses;
    rec.potential_adversaries = { en: [], ru: [] };
    rec.potential_adversaries[state.lang] = adversaries;
    rec.rawText = { en: overlay.querySelector('#fe-raw-en').value, ru: overlay.querySelector('#fe-raw-ru').value };
    rec.builtin = false;

    if (!existing) state.customEnvs.push(rec);
    persist(LS_KEYS.customEnvs, state.customEnvs);
    overlay.remove();
    renderToolbar(); renderGrid();
  });
}

/* ---------------- utils ---------------- */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

init();
