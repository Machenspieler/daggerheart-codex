/* ============================================================
   Environment Codex — app.js
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
};

const TAG_COLORS = ['#d9a441', '#9c2b3b', '#3f7b74', '#6a7fae', '#a15fb0', '#7a8a4a', '#c17a3d', '#5a8fae'];

const state = {
  lang: localStorage.getItem(LS_KEYS.lang) || 'ru',
  i18n: null,
  builtinEnvs: [],
  customEnvs: JSON.parse(localStorage.getItem(LS_KEYS.customEnvs) || '[]'),
  tags: JSON.parse(localStorage.getItem(LS_KEYS.tags) || '[]'),
  envTags: JSON.parse(localStorage.getItem(LS_KEYS.envTags) || '{}'),
  hiddenBuiltin: JSON.parse(localStorage.getItem(LS_KEYS.hiddenBuiltin) || '[]'),
  filters: { search: '', tiers: new Set(), types: new Set(), tags: new Set() },
  sort: { key: 'name', dir: 'asc' },
  editingEnvId: null,
};

function persist(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

function t(key) {
  const dict = state.i18n[state.lang] || {};
  return dict[key] || key;
}

function allEnvs() {
  const builtin = state.builtinEnvs.filter(e => !state.hiddenBuiltin.includes(e.id));
  return [...builtin, ...state.customEnvs];
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
  renderHeader();
  renderToolbar();
  renderGrid();
  renderFooter();
}

function renderHeader() {
  const el = document.getElementById('header');
  el.innerHTML = `
    <div class="header-inner">
      <div class="brand">
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
  const envs = allEnvs();
  const usedTiers = [...new Set(envs.map(e => e.tier))].sort();
  const types = ['traversal', 'social', 'event', 'exploration'];

  el.innerHTML = `
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
  const list = allEnvs().filter(envMatchesFilters);
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
  const total = allEnvs().length;
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
    el.innerHTML = `<div class="empty-state"><p>${t('no_results')}</p><p>${t('no_results_hint')}</p></div>`;
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

/* ---------------- detail modal ---------------- */

function openDetail(envId) {
  const env = allEnvs().find(e => e.id === envId);
  if (!env) return;
  const impulses = envField(env, 'impulses');
  const adversaries = envField(env, 'potential_adversaries');
  const tagIds = new Set(state.envTags[env.id] || []);

  const featuresHtml = (env.features || []).map(f => {
    const fname = f.name[state.lang] || f.name.en || f.name.ru;
    const fdesc = f.description[state.lang] || f.description.en || f.description.ru || '';
    const fprompt = (f.prompt && (f.prompt[state.lang] || f.prompt.en || f.prompt.ru)) || '';
    return `
      <div class="feature">
        <div class="feature-head">
          <span class="feature-name">${escapeHtml(fname)}</span>
          <span class="feature-type ${f.type}">${t('feature_' + f.type)}</span>
        </div>
        <p class="feature-desc" data-dice-text="${encodeURIComponent(fdesc)}"></p>
        ${fprompt ? `<p class="feature-prompt">${escapeHtml(fprompt)}</p>` : ''}
      </div>`;
  }).join('');

  const rawHtml = env.rawText && (env.rawText.en || env.rawText.ru) ? `
    <span class="section-label">${t('raw_text_label')}</span>
    <p class="feature-desc" data-dice-text="${encodeURIComponent(env.rawText[state.lang] || env.rawText.en || env.rawText.ru || '')}"></p>
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
          ${!env.builtin ? `<button class="btn btn-danger" id="detail-delete">${t('delete')}</button>` : `<button class="btn btn-danger" id="detail-hide">${t('delete')}</button>`}
          ${!env.builtin ? `<button class="btn" id="detail-edit">${t('edit')}</button>` : ''}
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // render dice-enabled text
  overlay.querySelectorAll('[data-dice-text]').forEach(node => {
    const text = decodeURIComponent(node.getAttribute('data-dice-text'));
    node.removeAttribute('data-dice-text');
    renderDiceText(node, text);
  });

  overlay.querySelector('.modal-close').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('#detail-tag-editor .tag-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const tagId = btn.dataset.tag;
      const set = new Set(state.envTags[env.id] || []);
      if (set.has(tagId)) set.delete(tagId); else set.add(tagId);
      state.envTags[env.id] = [...set];
      persist(LS_KEYS.envTags, state.envTags);
      overlay.remove();
      openDetail(envId);
      renderGrid();
    });
  });

  const delBtn = overlay.querySelector('#detail-delete');
  if (delBtn) delBtn.addEventListener('click', () => {
    if (!confirm(t('delete_confirm'))) return;
    state.customEnvs = state.customEnvs.filter(e => e.id !== env.id);
    persist(LS_KEYS.customEnvs, state.customEnvs);
    overlay.remove(); renderGrid();
  });
  const hideBtn = overlay.querySelector('#detail-hide');
  if (hideBtn) hideBtn.addEventListener('click', () => {
    if (!confirm(t('delete_confirm'))) return;
    state.hiddenBuiltin.push(env.id);
    persist(LS_KEYS.hiddenBuiltin, state.hiddenBuiltin);
    overlay.remove(); renderGrid();
  });
  const editBtn = overlay.querySelector('#detail-edit');
  if (editBtn) editBtn.addEventListener('click', () => { overlay.remove(); openEditForm(env.id); });
}

/* ---------------- dice parsing + rolling ---------------- */

const DICE_RE = /\b(\d{0,2})d(4|6|8|10|12|20|100)\b/gi;

function renderDiceText(container, text) {
  container.textContent = '';
  let lastIndex = 0;
  let match;
  DICE_RE.lastIndex = 0;
  while ((match = DICE_RE.exec(text))) {
    if (match.index > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    const count = match[1] ? parseInt(match[1], 10) : 1;
    const sides = parseInt(match[2], 10);
    container.appendChild(makeDiceButton(count, sides, match[0]));
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
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

function rollDice(btn, count, sides, label) {
  if (btn.classList.contains('rolling')) return;
  btn.classList.add('rolling');
  const rect = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'dice-result-pop';
  pop.style.left = Math.max(8, rect.left) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  pop.innerHTML = `<div class="notation">${label}</div><div class="value tumbling">–</div>`;
  document.body.appendChild(pop);

  const valueEl = pop.querySelector('.value');
  let ticks = 0;
  const maxVal = count * sides;
  const interval = setInterval(() => {
    valueEl.textContent = Math.ceil(Math.random() * maxVal);
    ticks++;
  }, 55);

  setTimeout(() => {
    clearInterval(interval);
    btn.classList.remove('rolling');
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
    const total = rolls.reduce((a, b) => a + b, 0);
    valueEl.classList.remove('tumbling');
    valueEl.textContent = total;
    if (count > 1) {
      const bd = document.createElement('div');
      bd.className = 'breakdown';
      bd.textContent = rolls.join(' + ');
      pop.appendChild(bd);
    }
    setTimeout(() => { pop.remove(); }, 2600);
  }, 650);

  pop.addEventListener('click', () => pop.remove());
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
