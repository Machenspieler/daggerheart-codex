/* ============================================================
   Daggerheart Atlas — app.js
   Vanilla JS, no build step. All state persisted to localStorage
   except the bundled builtin environment data (data/environments.json)
   which stays read-only on disk; user edits layer on top of it.
   ============================================================ */

const LS_KEYS = {
  lang: 'dhcodex_lang',
  customEnvs: 'dhcodex_custom_envs',
  tags: 'dhcodex_tags',
  envTags: 'dhcodex_env_tags',
  hiddenBuiltin: 'dhcodex_hidden_builtin',
  lists: 'dhcodex_lists',
  envLists: 'dhcodex_env_lists',
};

const TAG_COLORS = ['#d9a441', '#9c2b3b', '#3f7b74', '#6a7fae', '#a15fb0', '#7a8a4a', '#c17a3d', '#5a8fae'];

function normalizeLang(v) { return v === 'en' ? 'en' : 'ru'; }

const state = {
  lang: normalizeLang(localStorage.getItem(LS_KEYS.lang)),
  i18n: null,
  builtinEnvs: [],
  customEnvs: JSON.parse(localStorage.getItem(LS_KEYS.customEnvs) || '[]'),
  tags: JSON.parse(localStorage.getItem(LS_KEYS.tags) || '[]'),
  envTags: JSON.parse(localStorage.getItem(LS_KEYS.envTags) || '{}'),
  hiddenBuiltin: JSON.parse(localStorage.getItem(LS_KEYS.hiddenBuiltin) || '[]'),
  lists: JSON.parse(localStorage.getItem(LS_KEYS.lists) || '[]'),
  envLists: JSON.parse(localStorage.getItem(LS_KEYS.envLists) || '{}'),
  filters: { search: '', tiers: new Set(), types: new Set(), tags: new Set() },
  sort: { key: 'name', dir: 'asc' },
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

/* ---------------- init ---------------- */

async function init() {
  const [i18n, envs] = await Promise.all([
    fetch('data/i18n.json').then(r => r.json()),
    fetch('data/environments.json').then(r => r.json()),
  ]);
  state.i18n = i18n;
  state.builtinEnvs = envs.environments;
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
        <button class="btn" id="btn-manage-tags">${t('manage_tags')}</button>
      </div>
    </div>`;
  el.querySelectorAll('[data-lang]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.lang = btn.dataset.lang;
      persist(LS_KEYS.lang, state.lang);
      render();
    });
  });
  document.getElementById('btn-manage-tags').addEventListener('click', openTagManager);
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
        <label>${t('search_placeholder')}</label>
        <input type="text" id="f-search" placeholder="${t('search_placeholder')}" value="${escapeAttr(state.filters.search)}">
      </div>
      <div class="field">
        <label>${t('filter_tier')}</label>
        <div class="tier-pills" id="f-tiers">
          ${usedTiers.map(tier => `<button class="pill ${state.filters.tiers.has(tier) ? 'active' : ''}" data-tier="${tier}">${tier}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>${t('filter_type')}</label>
        <div class="type-pills" id="f-types">
          ${types.map(type => `<button class="pill ${state.filters.types.has(type) ? 'active' : ''}" data-type="${type}">${t('type_' + type)}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>${t('filter_tags')}</label>
        <select id="f-tag">
          <option value="">${t('all')}</option>
          ${state.tags.map(tg => `<option value="${tg.id}" ${state.filters.tags.has(tg.id) ? 'selected' : ''}>${escapeHtml(tg.name)}</option>`).join('')}
        </select>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="field">
        <label>${t('sort_by')}</label>
        <select id="f-sort-key">
          <option value="name" ${state.sort.key === 'name' ? 'selected' : ''}>${t('sort_name')}</option>
          <option value="tier" ${state.sort.key === 'tier' ? 'selected' : ''}>${t('sort_tier')}</option>
          <option value="difficulty" ${state.sort.key === 'difficulty' ? 'selected' : ''}>${t('sort_difficulty')}</option>
        </select>
      </div>
      <div class="field">
        <label>&nbsp;</label>
        <select id="f-sort-dir">
          <option value="asc" ${state.sort.dir === 'asc' ? 'selected' : ''}>${t('asc')}</option>
          <option value="desc" ${state.sort.dir === 'desc' ? 'selected' : ''}>${t('desc')}</option>
        </select>
      </div>
    </div>`;

  document.getElementById('f-search').addEventListener('input', e => { state.filters.search = e.target.value; renderGrid(); });
  el.querySelectorAll('#f-tiers .pill').forEach(btn => btn.addEventListener('click', () => {
    const tier = Number(btn.dataset.tier);
    toggleSetValue(state.filters.tiers, tier);
    renderToolbar(); renderGrid();
  }));
  el.querySelectorAll('#f-types .pill').forEach(btn => btn.addEventListener('click', () => {
    toggleSetValue(state.filters.types, btn.dataset.type);
    renderToolbar(); renderGrid();
  }));
  document.getElementById('f-tag').addEventListener('change', e => {
    state.filters.tags = new Set(e.target.value ? [e.target.value] : []);
    renderGrid();
  });
  document.getElementById('f-sort-key').addEventListener('change', e => { state.sort.key = e.target.value; renderGrid(); });
  document.getElementById('f-sort-dir').addEventListener('change', e => { state.sort.dir = e.target.value; renderGrid(); });

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
      ...(state.envTags[env.id] || []).map(tid => (state.tags.find(x => x.id === tid) || {}).name || ''),
    ].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(f.search.toLowerCase())) return false;
  }
  if (f.tiers.size && !f.tiers.has(env.tier)) return false;
  if (f.types.size && !f.types.has(env.type)) return false;
  if (f.tags.size) {
    const envTagSet = new Set(state.envTags[env.id] || []);
    let match = false;
    for (const tg of f.tags) if (envTagSet.has(tg)) match = true;
    if (!match) return false;
  }
  return true;
}

function sortedFilteredEnvs() {
  const list = currentEnvs().filter(envMatchesFilters);
  const { key, dir } = state.sort;
  list.sort((a, b) => {
    let av, bv;
    if (key === 'name') { av = envName(a).toLowerCase(); bv = envName(b).toLowerCase(); }
    else { av = a[key]; bv = b[key]; }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
  return list;
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
    state.filters = { search: '', tiers: new Set(), types: new Set(), tags: new Set() };
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
}

function hasActiveFilters() {
  const f = state.filters;
  return f.search || f.tiers.size || f.types.size || f.tags.size;
}

function cardHtml(env) {
  const impulses = envField(env, 'impulses');
  const tagIds = state.envTags[env.id] || [];
  const tagChips = tagIds.map(tid => {
    const tg = state.tags.find(x => x.id === tid);
    if (!tg) return '';
    return `<span class="tag-chip" style="border-color:${tg.color}55;color:${tg.color}">${escapeHtml(tg.name)}</span>`;
  }).join('');
  const badges = [
    env.builtin ? '' : `<span class="badge custom">${t('custom_badge')}</span>`,
    isTranslated(env) ? '' : `<span class="badge pending">${t('untranslated_badge')}</span>`,
  ].join('');
  return `
    <div class="card" data-id="${env.id}" data-type="${env.type}">
      <div class="card-top">
        <h3 class="card-title">${escapeHtml(envName(env))}</h3>
        <span class="card-tier">${t('tier_label')} ${env.tier}</span>
      </div>
      <div class="card-meta">
        <span>${t('type_' + env.type)}</span>
        <span class="diff">${t('difficulty_label')} ${env.difficulty}</span>
      </div>
      ${impulses.length ? `<div class="card-impulses">${escapeHtml(impulses.join(', '))}</div>` : ''}
      ${badges}
      <div class="card-tags">${tagChips}</div>
    </div>`;
}

function renderFooter() {
  const el = document.getElementById('footer');
  el.innerHTML = `
    <span>${t('footer_note')}</span>
    <button class="btn btn-sm btn-ghost" id="btn-reset">${t('reset_data')}</button>`;
  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm(t('reset_confirm'))) {
      localStorage.removeItem(LS_KEYS.customEnvs);
      localStorage.removeItem(LS_KEYS.tags);
      localStorage.removeItem(LS_KEYS.envTags);
      localStorage.removeItem(LS_KEYS.hiddenBuiltin);
      state.customEnvs = []; state.tags = []; state.envTags = {}; state.hiddenBuiltin = [];
      render();
    }
  });
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
      <div class="new-list-row">
        <input type="text" id="new-list-input" placeholder="${t('new_list_name')}">
        <button class="btn btn-primary" id="new-list-btn">${t('create')}</button>
      </div>
      ${state.lists.length
        ? `<div class="list-cards-grid">${state.lists.map(listCardHtml).join('')}</div>`
        : `<div class="empty-state"><p>${t('no_lists_yet')}</p><p>${t('no_lists_hint')}</p></div>`}
    </div>`;

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
  const tagIds = new Set(state.envTags[env.id] || []);

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

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <div>
          <h2>${escapeHtml(envName(env))}</h2>
          <div class="modal-sub">${t('type_' + env.type)} — ${t('tier_label')} ${env.tier}</div>
        </div>
        <button class="modal-close" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div class="stat-row">
          <div class="stat-block-item"><span class="k">${t('tier_label')}</span><span class="v">${env.tier}</span></div>
          <div class="stat-block-item"><span class="k">${t('difficulty_label')}</span><span class="v">${env.difficulty}</span></div>
          <div class="stat-block-item"><span class="k">${t('filter_type')}</span><span class="v">${t('type_' + env.type)}</span></div>
        </div>

        ${impulses.length ? `<span class="section-label">${t('impulses_label')}</span><p class="impulse-list">${escapeHtml(impulses.join(', '))}</p>` : ''}
        ${adversaries.length ? `<span class="section-label">${t('adversaries_label')}</span><p class="adversary-list">${escapeHtml(adversaries.join('; '))}</p>` : ''}
        ${featuresHtml ? `<span class="section-label">${t('features_label')}</span>${featuresHtml}` : ''}
        ${rawHtml}

        <span class="section-label">${t('filter_tags')}</span>
        <div class="tag-editor" id="detail-tag-editor">
          ${state.tags.map(tg => `<button class="tag-toggle ${tagIds.has(tg.id) ? 'on' : ''}" data-tag="${tg.id}" style="${tagIds.has(tg.id) ? `border-color:${tg.color};color:${tg.color}` : ''}">${escapeHtml(tg.name)}</button>`).join('') || `<span class="hint">${t('no_tags_yet')}</span>`}
        </div>

        <div class="form-actions" style="margin-top:22px">
          <button class="btn" id="detail-add-to-list">${t('add_to_list')}</button>
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
  }

  overlay.querySelector('.modal-close').addEventListener('click', closeDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDetail(); });

  overlay.querySelectorAll('#detail-tag-editor .tag-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const tagId = btn.dataset.tag;
      const set = new Set(state.envTags[env.id] || []);
      if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
      state.envTags[env.id] = [...set];
      persist(LS_KEYS.envTags, state.envTags);
      closeDetail();
      openDetail(envId);
      renderGrid();
    });
  });

  const editBtn = overlay.querySelector('#detail-edit');
  if (editBtn) editBtn.addEventListener('click', () => { closeDetail(); openEditForm(env.id); });

  overlay.querySelector('#detail-add-to-list').addEventListener('click', () => openAddToListPopup(env.id));
}

/* ---------------- dice parsing + rolling ---------------- */

const DICE_RE = /\b(\d{0,2})d(3|4|6|8|10|12|20|100)\b/gi;
const COUNTDOWN_KEYWORD_RE = /(Countdown|Отсчёт\w*|Отсчет\w*|Счётчик\w*|Счетчик\w*)/gi;
const COUNTDOWN_PAREN_RE = /\(\s*(\d+)\s*\)/g;

/** Finds "<...Countdown/Отсчёт...> (6)"-style spans in free text: scans for a
 * plain integer in parens, then walks back to the nearest sentence boundary and
 * takes the text from the closest preceding countdown keyword up to the parens. */
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
  document.body.appendChild(panel);
  btn._countdownOverlay = panel;

  const stackIndex = document.querySelectorAll('.countdown-overlay').length - 1;
  panel.style.bottom = (18 + stackIndex * 92) + 'px';

  const valueEl = panel.querySelector('.countdown-overlay-value');
  panel.querySelector('[data-op="inc"]').addEventListener('click', () => {
    btn.dataset.count = String(Number(btn.dataset.count) + 1);
    valueEl.textContent = btn.dataset.count;
  });
  panel.querySelector('[data-op="dec"]').addEventListener('click', () => {
    btn.dataset.count = String(Number(btn.dataset.count) - 1);
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
  if (btn.classList.contains('rolling')) return;

  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0);

  // No physical d3 die exists to animate as a 3D shape, so skip the flying-dice
  // animation for it and just show the result popup.
  if (sides === 3) {
    showDiceResultPop(btn, label, rolls, total);
    return;
  }

  btn.classList.add('rolling');

  const rect = btn.getBoundingClientRect();
  const landX = rect.left + rect.width / 2;
  const landY = rect.top + rect.height / 2;

  const flightMs = spawnFlyingDice(rolls, sides, landX, landY);

  setTimeout(() => {
    btn.classList.remove('rolling');
    showDiceResultPop(btn, label, rolls, total);
  }, flightMs);
}

/* ---------------- true 3D die geometry (generic convex-hull engine) ----------------
 * Each die type is defined only by its vertex coordinates (standard Platonic-solid
 * formulas, plus a dual-of-antiprism construction for the d10 pentagonal
 * trapezohedron). A brute-force convex-hull face finder derives the actual polygon
 * faces from those vertices, so no face lists are hand-authored/hard-coded. */

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
function v3norm(a) { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

/** Brute-force convex hull face finder for small point sets (n <= ~24). For every
 * candidate plane through 3 points, if all other points lie on one side (within eps)
 * it's a hull face; points exactly on that plane are grouped into one polygon and
 * ordered by angle around its centroid. Works for triangular, square, pentagonal and
 * kite-shaped faces alike — the face's vertex count falls out naturally. */
function convexHullFaces(points, eps = 1e-4) {
  const n = points.length;
  const faces = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        const a = points[i], b = points[j], c = points[k];
        let normal = v3cross(v3sub(b, a), v3sub(c, a));
        const len = v3len(normal);
        if (len < eps) continue;
        normal = v3scale(normal, 1 / len);
        let pos = false, neg = false;
        const onPlane = [];
        for (let m = 0; m < n; m++) {
          const d = v3dot(normal, v3sub(points[m], a));
          if (d > eps) pos = true;
          else if (d < -eps) neg = true;
          else onPlane.push(m);
        }
        if (pos && neg) continue;
        if (!pos && !neg) continue;
        if (pos) normal = v3scale(normal, -1);
        const idx = [...new Set(onPlane)];
        if (idx.length < 3) continue;
        const key = idx.slice().sort((x, y) => x - y).join(',');
        if (seen.has(key)) continue;
        seen.add(key);

        const centroid = v3scale(idx.reduce((acc, ix) => v3add(acc, points[ix]), [0, 0, 0]), 1 / idx.length);
        const ref = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        const u = v3norm(v3cross(ref, normal));
        const vv = v3cross(normal, u);
        const ordered = idx
          .map((ix) => {
            const p = v3sub(points[ix], centroid);
            return { ix, ang: Math.atan2(v3dot(p, vv), v3dot(p, u)) };
          })
          .sort((x, y) => x.ang - y.ang)
          .map((o) => o.ix);

        faces.push({ indices: ordered, normal, centroid, u, v: vv });
      }
    }
  }
  return faces;
}

function scaleToCircumradius(points, targetR) {
  const maxR = Math.max(...points.map((p) => v3len(p)));
  const s = targetR / maxR;
  return points.map((p) => v3scale(p, s));
}

function tetrahedronVerts() {
  return [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]];
}
function cubeVerts() {
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  return v;
}
function octahedronVerts() {
  return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
}
function icosahedronVerts() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const v = [];
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    v.push([0, s1, s2 * phi]);
    v.push([s1, s2 * phi, 0]);
    v.push([s1 * phi, 0, s2]);
  }
  return v;
}
function dodecahedronVerts() {
  const phi = (1 + Math.sqrt(5)) / 2;
  const inv = 1 / phi;
  const v = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x, y, z]);
  for (const s1 of [1, -1]) for (const s2 of [1, -1]) {
    v.push([0, s1 * inv, s2 * phi]);
    v.push([s1 * inv, s2 * phi, 0]);
    v.push([s1 * phi, 0, s2 * inv]);
  }
  return v;
}
/** A pentagonal trapezohedron (real d10 shape: 10 kite faces) is the polar dual of a
 * uniform pentagonal antiprism. Build the antiprism, hull it, then reciprocate each
 * of its 12 faces (2 pentagon caps + 10 triangles) into a dual vertex — the hull of
 * those 12 dual vertices is exactly the 10-kite-face trapezohedron. */
function pentagonalTrapezohedronVerts() {
  const r = 1, h = 0.5;
  const antiprism = [];
  for (let k = 0; k < 5; k++) {
    const a = (k * 2 * Math.PI) / 5;
    antiprism.push([r * Math.cos(a), r * Math.sin(a), h]);
  }
  for (let k = 0; k < 5; k++) {
    const a = Math.PI / 5 + (k * 2 * Math.PI) / 5;
    antiprism.push([r * Math.cos(a), r * Math.sin(a), -h]);
  }
  const capFaces = convexHullFaces(antiprism);
  return capFaces.map((f) => v3scale(f.normal, 1 / v3dot(f.normal, f.centroid)));
}

const DIE_VERT_BUILDERS = {
  4: tetrahedronVerts,
  6: cubeVerts,
  8: octahedronVerts,
  10: pentagonalTrapezohedronVerts,
  12: dodecahedronVerts,
  20: icosahedronVerts,
};

const dieMeshCache = new Map();

/** Computes (once per die type, then cached) the CSS transform + clip-path needed
 * for every face of a true 3D polyhedron matching `sides`. */
function buildDieMesh(sides) {
  if (dieMeshCache.has(sides)) return dieMeshCache.get(sides);
  const builder = DIE_VERT_BUILDERS[sides] || cubeVerts;
  const verts = scaleToCircumradius(builder(), 26);
  const faces = convexHullFaces(verts);

  let maxFaceExtent = 0;
  const facesWithLocal = faces.map((f) => {
    const local = f.indices.map((ix) => {
      const p = v3sub(verts[ix], f.centroid);
      return [v3dot(p, f.u), v3dot(p, f.v)];
    });
    maxFaceExtent = Math.max(maxFaceExtent, ...local.map(([x, y]) => Math.hypot(x, y)));
    return { ...f, local };
  });
  const boxSize = maxFaceExtent * 2 * 1.15;

  const meshFaces = facesWithLocal.map((f) => {
    const inradius = v3dot(f.normal, f.centroid);
    const z = [0, 0, 1];
    let axis = v3cross(z, f.normal);
    const axisLen = v3len(axis);
    let axisUnit, angleDeg;
    if (axisLen < 1e-6) {
      axisUnit = [1, 0, 0];
      angleDeg = f.normal[2] > 0 ? 0 : 180;
    } else {
      axisUnit = v3scale(axis, 1 / axisLen);
      angleDeg = (Math.acos(Math.min(1, Math.max(-1, v3dot(z, f.normal)))) * 180) / Math.PI;
    }
    const clipPath = `polygon(${f.local
      .map(([x, y]) => `${(((x + boxSize / 2) / boxSize) * 100).toFixed(2)}% ${(((-y + boxSize / 2) / boxSize) * 100).toFixed(2)}%`)
      .join(', ')})`;
    return {
      boxSize,
      clipPath,
      transform: `translate(-50%, -50%) rotate3d(${axisUnit[0].toFixed(4)}, ${axisUnit[1].toFixed(4)}, ${axisUnit[2].toFixed(4)}, ${angleDeg.toFixed(3)}deg) translateZ(${inradius.toFixed(2)}px)`,
      fontSize: Math.max(9, Math.min(19, boxSize * 0.26)),
    };
  });

  const result = { faces: meshFaces, size: 26 * 2 + 16 };
  dieMeshCache.set(sides, result);
  return result;
}

function makeDie3D(value, sides) {
  const mesh = buildDieMesh(sides);
  const wrap = document.createElement('div');
  wrap.className = 'die3d-wrap';
  wrap.style.width = mesh.size + 'px';
  wrap.style.height = mesh.size + 'px';
  const cube = document.createElement('div');
  cube.className = 'die3d-cube';
  mesh.faces.forEach((f) => {
    const face = document.createElement('div');
    face.className = 'die3d-face';
    face.style.width = f.boxSize + 'px';
    face.style.height = f.boxSize + 'px';
    face.style.transform = f.transform;
    face.style.clipPath = f.clipPath;
    face.style.fontSize = f.fontSize + 'px';
    face.textContent = value;
    cube.appendChild(face);
  });
  wrap.appendChild(cube);
  return { wrap, cube, size: mesh.size };
}

/**
 * Flies `rolls.length` 3D dice in from independently-random compass
 * directions (each die picks its own edge, per-die) toward (landX, landY),
 * showing their real rolled values, then fades them out.
 * Returns the ms until the flight/landing settles (for scheduling the result bubble).
 */
function spawnFlyingDice(rolls, sides, landX, landY) {
  let layer = document.querySelector('.dice-fly-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'dice-fly-layer';
    document.body.appendChild(layer);
  }

  const diag = Math.hypot(window.innerWidth, window.innerHeight);
  let maxFinish = 0;

  rolls.forEach((value, i) => {
    const angle = Math.random() * 360 * (Math.PI / 180);
    const startX = landX + Math.cos(angle) * diag;
    const startY = landY + Math.sin(angle) * diag;

    const clusterAngle = (i / rolls.length) * Math.PI * 2 + Math.random() * 0.6;
    const clusterR = rolls.length > 1 ? 26 : 0;
    const endX = landX + Math.cos(clusterAngle) * clusterR + (Math.random() - 0.5) * 8;
    const endY = landY - 30 + Math.sin(clusterAngle) * clusterR + (Math.random() - 0.5) * 8;

    const { wrap, cube, size } = makeDie3D(value, sides);
    const half = size / 2;
    layer.appendChild(wrap);

    const delay = i * 70;
    const duration = 720 + Math.random() * 180;
    const spin = (base) => base * (720 + Math.random() * 360) * (Math.random() < 0.5 ? -1 : 1);
    const restTilt = () => Math.random() * 20 - 10;

    wrap.animate([
      { transform: `translate3d(${startX - half}px, ${startY - half}px, 0) scale(0.55)`, opacity: 0 },
      { transform: `translate3d(${startX - half}px, ${startY - half}px, 0) scale(0.55)`, opacity: 1, offset: 0.06 },
      { transform: `translate3d(${endX - half}px, ${endY - half}px, 0) scale(1.08)`, offset: 0.85 },
      { transform: `translate3d(${endX - half}px, ${endY - half}px, 0) scale(1)`, offset: 1 },
    ], { duration, delay, easing: 'cubic-bezier(0.18,0.62,0.25,1)', fill: 'forwards' });

    cube.animate([
      { transform: 'rotateX(0deg) rotateY(0deg) rotateZ(0deg)' },
      { transform: `rotateX(${spin(1) + restTilt()}deg) rotateY(${spin(1) + restTilt()}deg) rotateZ(${spin(0.6) + restTilt()}deg)` },
    ], { duration, delay, easing: 'cubic-bezier(0.18,0.62,0.25,1)', fill: 'forwards' });

    const lifespan = delay + duration + 900;
    maxFinish = Math.max(maxFinish, delay + duration);
    setTimeout(() => {
      const fade = wrap.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, fill: 'forwards' });
      fade.onfinish = () => wrap.remove();
    }, lifespan);
  });

  return maxFinish + 40;
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

/* ---------------- tag manager ---------------- */

function openTagManager() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" style="max-width:480px">
      <div class="modal-header">
        <h2 style="font-size:19px">${t('manage_tags')}</h2>
        <button class="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="tag-list"></div>
        <div class="new-tag-row">
          <input type="text" id="new-tag-input" placeholder="${t('new_tag_name')}">
          <button class="btn btn-primary" id="new-tag-btn">${t('create')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  function renderTagList() {
    const listEl = overlay.querySelector('#tag-list');
    if (!state.tags.length) { listEl.innerHTML = `<p class="hint">${t('no_tags_yet')}</p>`; return; }
    listEl.innerHTML = state.tags.map(tg => `
      <div class="tag-manage-row" data-tag="${tg.id}">
        <div style="display:flex;align-items:center;flex:1">
          <span class="tag-color-dot" style="background:${tg.color}"></span>
          <input type="text" value="${escapeAttr(tg.name)}" class="tag-rename" style="background:transparent;border:none;color:var(--parchment);font-family:var(--font-body);font-size:14px;width:100%">
        </div>
        <button class="btn btn-sm btn-danger" data-del="${tg.id}">${t('delete')}</button>
      </div>`).join('');
    listEl.querySelectorAll('.tag-rename').forEach(input => {
      input.addEventListener('change', () => {
        const id = input.closest('.tag-manage-row').dataset.tag;
        const tg = state.tags.find(x => x.id === id);
        if (tg && input.value.trim()) { tg.name = input.value.trim(); persist(LS_KEYS.tags, state.tags); renderGrid(); }
      });
    });
    listEl.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.del;
        state.tags = state.tags.filter(x => x.id !== id);
        Object.keys(state.envTags).forEach(envId => {
          state.envTags[envId] = (state.envTags[envId] || []).filter(t2 => t2 !== id);
        });
        persist(LS_KEYS.tags, state.tags);
        persist(LS_KEYS.envTags, state.envTags);
        renderTagList(); renderGrid(); renderToolbar();
      });
    });
  }
  renderTagList();

  overlay.querySelector('#new-tag-btn').addEventListener('click', () => {
    const input = overlay.querySelector('#new-tag-input');
    const name = input.value.trim();
    if (!name) return;
    const color = TAG_COLORS[state.tags.length % TAG_COLORS.length];
    state.tags.push({ id: 'tag-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, color });
    persist(LS_KEYS.tags, state.tags);
    input.value = '';
    renderTagList(); renderGrid(); renderToolbar();
  });
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

  overlay.querySelector('#fe-save').addEventListener('click', () => {
    const nameEn = overlay.querySelector('#fe-name-en').value.trim();
    const nameRu = overlay.querySelector('#fe-name-ru').value.trim();
    if (!nameEn && !nameRu) { overlay.querySelector('#fe-name-en').focus(); return; }
    const rec = existing || { id: 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), builtin: false, features: [] };
    rec.name = { en: nameEn, ru: nameRu };
    rec.tier = Number(overlay.querySelector('#fe-tier').value);
    rec.type = overlay.querySelector('#fe-type').value;
    rec.difficulty = Number(overlay.querySelector('#fe-difficulty').value);
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
