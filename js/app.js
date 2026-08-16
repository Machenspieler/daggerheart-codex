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
const TYPES = ['traversal', 'social', 'event', 'exploration'];

function normalizeLang(v) { return v === 'en' ? 'en' : 'ru'; }

/* The language is written through persist(), so what comes back out is JSON —
 * `"en"`, quote marks and all, which never equals `en`. Parsing it here keeps
 * the write side symmetric with every other key; the fallback covers a value
 * left in storage by a build that wrote the bare string. */
function storedLang() {
  const raw = localStorage.getItem(LS_KEYS.lang);
  if (!raw) return 'ru';
  try { return normalizeLang(JSON.parse(raw)); }
  catch { return normalizeLang(raw); }
}

const state = {
  lang: storedLang(),
  i18n: null,
  builtinEnvs: [],
  regions: [],
  itemCatalog: { items: {}, itemUrl: '', imageUrl: '' },
  itemIndex: new Map(),
  customEnvs: JSON.parse(localStorage.getItem(LS_KEYS.customEnvs) || '[]'),
  hiddenBuiltin: JSON.parse(localStorage.getItem(LS_KEYS.hiddenBuiltin) || '[]'),
  lists: JSON.parse(localStorage.getItem(LS_KEYS.lists) || '[]'),
  envLists: JSON.parse(localStorage.getItem(LS_KEYS.envLists) || '{}'),
  storageNoticeDismissed: localStorage.getItem(LS_KEYS.storageNoticeDismissed) === '1',
  filters: { search: '', tiers: new Set(), types: new Set(), biomes: new Set(), regionOnly: false },
  // Whether the phone-width filter disclosure is open. Purely presentational,
  // so it lives here rather than in localStorage and survives a re-render only.
  filtersOpen: false,
  route: parseRoute(),
};

/* An open environment card is a "/env/<id>" suffix on whichever route is
 * behind it, rather than a route of its own: the card is an overlay, and the
 * catalog or list underneath it keeps its own address. That gives the card a
 * link worth sharing and, on a phone, makes the Back gesture close the sheet
 * instead of leaving the site. */
function parseRoute() {
  let hash = location.hash;
  let env = null;
  const em = hash.match(/\/env\/([^/]+)$/);
  if (em) { env = decodeURIComponent(em[1]); hash = hash.slice(0, em.index) || '#'; }
  const m = hash.match(/^#\/lists\/(.+)$/);
  if (m) return { name: 'list', id: decodeURIComponent(m[1]), env };
  if (hash === '#/lists') return { name: 'lists', env };
  return { name: 'catalog', env };
}

/** The address of the route behind the card, without any card on it. */
function baseHash(route = state.route) {
  if (route.name === 'list') return '#/lists/' + encodeURIComponent(route.id);
  if (route.name === 'lists') return '#/lists';
  return '';
}

function envHash(envId, route = state.route) {
  return (baseHash(route) || '#') + '/env/' + encodeURIComponent(envId);
}

function sameBase(a, b) { return a.name === b.name && a.id === b.id; }

function navigate(hash) {
  if (location.hash === hash) { state.route = parseRoute(); render(); }
  else { location.hash = hash; }
}

/* Opening or closing a card only moves the overlay. Re-rendering the page
 * underneath would rebuild the grid and destroy the button the card was opened
 * from, which is the element focus has to return to when it closes. */
window.addEventListener('hashchange', () => {
  const next = parseRoute();
  const onlyCardChanged = sameBase(next, state.route);
  state.route = next;
  if (!next.env) cardEntryPushed = false;
  if (onlyCardChanged) { syncDetail(); document.title = routeTitle(); }
  else render();
});

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

/* ---------------- item catalogue ---------------- */

/* Stat blocks name loot by the plant or object the party harvests — "Nursewood",
 * not "Nursewood Sap" — so a name is looked up through an alias table as well as
 * through the catalogue's own names. Both sides go through the same normaliser,
 * which drops case, punctuation and spacing so a stray apostrophe or hyphen in a
 * stat block never costs a link. */
function normalizeItemKey(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function setItemCatalog(data) {
  const items = data.items || {};
  state.itemCatalog = { items, itemUrl: data.item_url || '', imageUrl: data.image_url || '' };
  const index = new Map();
  const add = (text, id) => {
    const key = normalizeItemKey(text);
    if (key && !index.has(key)) index.set(key, id);
  };
  // Aliases win over catalogue names: they are the deliberate mapping, and a
  // stat block's wording is what the reader is actually clicking on.
  Object.entries(data.aliases || {}).forEach(([name, id]) => { if (items[id]) add(name, id); });
  Object.entries(items).forEach(([id, item]) => {
    ['en', 'ru'].forEach(lang => add(item[lang]?.name, id));
  });
  state.itemIndex = index;
}

function itemById(id) { return state.itemCatalog.items[id] || null; }
function itemIdFor(text) { return state.itemIndex.get(normalizeItemKey(text)) || null; }
function itemField(item, field) { return item[state.lang]?.[field] || item.en?.[field] || item.ru?.[field] || ''; }
function itemUrl(id) { return state.itemCatalog.itemUrl.replace('{id}', id); }
function itemImageUrl(item) {
  return item.img && state.itemCatalog.imageUrl ? state.itemCatalog.imageUrl.replace('{img}', item.img) : '';
}
/** The other end of a craft chain: what this entry becomes, and what becomes it. */
function itemCraftRows(id) {
  const item = itemById(id);
  const rows = [];
  if (item?.craft && itemById(item.craft)) rows.push({ label: t('craft_into'), id: item.craft });
  const from = Object.keys(state.itemCatalog.items).find(other => state.itemCatalog.items[other].craft === id);
  if (from) rows.push({ label: t('craft_from'), id: from });
  return rows;
}

/** Difficulty is usually a plain number, but a few environments (e.g. duel
 * events whose difficulty depends on the chosen adversary) store a bilingual
 * descriptive string instead: { en, ru }. */
function envDifficulty(env) {
  const d = env.difficulty;
  if (d && typeof d === 'object') return d[state.lang] || d.en || d.ru || '';
  return d;
}
/** Whether there is a difficulty to print at all. A descriptive one points back
 * at a feature that spells the rule out ("Relative Strength"), but it is still
 * what the stat block says the difficulty is, and a card that shows no
 * difficulty line reads as though the number were simply missing. */
function hasDifficulty(env) {
  const d = env.difficulty;
  if (d === null || d === undefined || d === '') return false;
  if (typeof d === 'object') return Boolean(envDifficulty(env));
  return true;
}

/** Only a numeric difficulty follows the card to another tier. */
function difficultyScales(env) { return typeof env.difficulty === 'number'; }

/* ---------------- init ---------------- */

/* Cache buster for the JSON under data/. index.html versions the stylesheet and
   this script the same way; the data files are fetched from here instead, so
   bump this whenever anything in data/ changes or browsers serve stale copies. */
const DATA_VERSION = 14;

function getJSON(path) {
  return fetch(path).then(r => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`);
    return r.json();
  });
}

/* The dictionary comes first and alone: it is 8KB against the catalogue's 1.4MB,
 * and every string on the loading screen is in it. Once it lands the header and
 * a skeleton grid go up immediately, so the first paint is the shape of the page
 * rather than an empty near-black rectangle. */
async function init() {
  const v = `?v=${DATA_VERSION}`;
  try {
    state.i18n = await getJSON(`data/i18n.json${v}`);
  } catch (err) {
    renderFatalError(err);
    return;
  }
  renderHeader();
  renderFooter();
  renderLoadingState();
  try {
    const [envs, regions, items] = await Promise.all([
      getJSON(`data/environments.json${v}`),
      getJSON(`data/regions.json${v}`).catch(() => ({ regions: [] })),
      getJSON(`data/items.json${v}`).catch(() => ({ items: {}, aliases: {} })),
    ]);
    state.builtinEnvs = envs.environments;
    state.regions = regions.regions || [];
    setItemCatalog(items);
  } catch (err) {
    renderLoadError(err);
    return;
  }
  render();
}

function renderLoadingState() {
  document.getElementById('toolbar').innerHTML = `
    <div class="skeleton-toolbar" aria-hidden="true">
      <div class="sk sk-field wide"></div>
      <div class="sk sk-field"></div>
      <div class="sk sk-field"></div>
      <div class="sk sk-field"></div>
    </div>`;
  document.getElementById('result-count').textContent = t('loading');
  document.getElementById('grid-wrap').innerHTML =
    Array.from({ length: 6 }, () => '<div class="sk sk-card" aria-hidden="true"></div>').join('');
}

function renderLoadError(err) {
  console.error('[atlas] data load failed', err);
  document.getElementById('toolbar').innerHTML = '';
  document.getElementById('result-count').textContent = '';
  document.getElementById('grid-wrap').innerHTML = emptyStateHtml({
    icon: ICON_ALERT,
    title: t('load_error'),
    hint: t('load_error_hint'),
    action: `<button type="button" class="btn btn-primary" id="retry-load">${t('retry')}</button>`,
    error: true,
  });
  document.getElementById('retry-load').addEventListener('click', e => {
    e.currentTarget.dataset.loading = 'true';
    location.reload();
  });
}

/* The dictionary itself failed, so there are no strings to say so with. */
function renderFatalError(err) {
  console.error('[atlas] i18n load failed', err);
  document.getElementById('grid-wrap').innerHTML = emptyStateHtml({
    icon: ICON_ALERT,
    title: 'Не удалось загрузить атлас. / The atlas could not be loaded.',
    hint: 'Проверьте соединение и обновите страницу. / Check your connection and reload.',
    error: true,
  });
}

/* ---------------- shared UI primitives ---------------- */

const ICON_ALERT = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3.5 22 20H2L12 3.5z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M12 10v4.5M12 17.2v.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="m8 12.2 2.7 2.6L16 9.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICON_SEARCH_EMPTY = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="1.6"/><path d="m15.5 15.5 4.5 4.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M8 10.5h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const ICON_BOOKMARK = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.5 3.5h11a1 1 0 0 1 1 1v16l-6.5-4-6.5 4v-16a1 1 0 0 1 1-1z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

/** One empty/error state for the whole app: an icon, a headline, a line of help
 * and — the part the old dashed box was missing — the action that resolves it. */
function emptyStateHtml({ icon, title, hint, action = '', error = false }) {
  return `
    <div class="empty-state${error ? ' is-error' : ''}"${error ? ' role="alert"' : ''}>
      ${icon}
      <p>${escapeHtml(title)}</p>
      ${hint ? `<p>${escapeHtml(hint)}</p>` : ''}
      ${action}
    </div>`;
}

function showToast(message, kind = 'success') {
  let stack = document.getElementById('toast-stack');
  if (!stack) {
    stack = document.createElement('div');
    stack.id = 'toast-stack';
    stack.className = 'toast-stack';
    stack.setAttribute('role', 'status');
    stack.setAttribute('aria-live', 'polite');
    document.body.appendChild(stack);
  }
  const toast = document.createElement('div');
  toast.className = kind === 'error' ? 'toast is-error' : 'toast';
  toast.innerHTML = `${kind === 'error' ? ICON_ALERT : ICON_CHECK}<span></span>`;
  toast.querySelector('span').textContent = message;
  stack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

/* ---------------- tooltip ---------------- */

/* One element for the whole page, driven by data-tip. The native title it
 * replaces waits ~700ms, cannot be styled and never shows on a keyboard
 * focus. Presentational only: every trigger carries its own accessible name,
 * so the tooltip stays out of the accessibility tree rather than
 * double-announcing it. */
const TIP_DELAY_MS = 200;
let tipEl = null;
let tipTimer = null;
let tipTarget = null;

function tipNode() {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tooltip';
    tipEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

function placeTip(target, el) {
  const r = target.getBoundingClientRect();
  const t = el.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left + r.width / 2 - t.width / 2, window.innerWidth - t.width - 8));
  // Above by preference; below when there is no room, so it never leaves the screen.
  const above = r.top - t.height - 8;
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(above < 8 ? r.bottom + 8 : above)}px`;
}

function showTip(target) {
  const text = target.dataset.tip;
  if (!text) return;
  const el = tipNode();
  el.textContent = text;
  placeTip(target, el);
  el.classList.add('is-open');
  tipTarget = target;
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTarget = null;
  if (tipEl) tipEl.classList.remove('is-open');
}

// Mouse only: on a touch screen pointerover fires with the tap and the tooltip
// would stick around with nothing to dismiss it.
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const target = e.target.closest?.('[data-tip]');
  if (!target || target === tipTarget) return;
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
});
document.addEventListener('pointerout', e => {
  if (e.target.closest?.('[data-tip]')) hideTip();
});
// No delay for the keyboard: focus is already a deliberate act. Deferred to
// the end of the task because moving focus can scroll the element into view,
// and the scroll handler below would otherwise dismiss the tooltip as it
// appeared. A timeout rather than a frame: nothing here needs to line up with
// a paint, and rAF does not run at all in a background tab. Guarded on the
// focus target rather than on document.activeElement, which does not reliably
// track programmatic focus while the window is in the background.
let tipFocusTarget = null;
document.addEventListener('focusin', e => {
  const target = e.target.closest?.('[data-tip]');
  if (!target) return;
  clearTimeout(tipTimer);
  tipFocusTarget = target;
  setTimeout(() => { if (tipFocusTarget === target) showTip(target); }, 0);
});
document.addEventListener('focusout', () => { tipFocusTarget = null; hideTip(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTip(); });
// A focused trigger keeps its tooltip and takes it along; a hovered one loses
// it, since the pointer has effectively left the element.
document.addEventListener('scroll', () => {
  if (tipTarget && tipTarget === tipFocusTarget) placeTip(tipTarget, tipNode());
  else hideTip();
}, true);

/* ---------------- overlay plumbing ---------------- */

/* Every overlay in the app — the environment card, the add-to-list popup and
 * the item card — goes through this. It is what gives them Escape, a focus
 * trap, focus restored to whatever opened them, and a page behind that stays
 * put instead of scrolling under the wheel. */
const overlayStack = [];
let scrollLockY = 0;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function focusableIn(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
}

/* position:fixed rather than overflow:hidden — iOS Safari ignores the latter on
 * body once a nested element is scrolling. The offset is restored on unlock so
 * the catalog is exactly where it was left. */
function lockScroll() {
  if (overlayStack.length !== 1) return;
  scrollLockY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollLockY}px`;
  document.body.style.insetInline = '0';
}

function unlockScroll() {
  if (overlayStack.length) return;
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.insetInline = '';
  window.scrollTo(0, scrollLockY);
}

/** Wires an overlay up and returns its teardown. `closeFn` is the caller's own
 * close routine, so Escape and the trap stay in step with the click handlers. */
function registerOverlay(overlay, closeFn) {
  const previouslyFocused = document.activeElement;
  overlayStack.push(overlay);
  lockScroll();

  function onKeyDown(e) {
    if (overlayStack[overlayStack.length - 1] !== overlay) return;
    if (e.key === 'Escape') { e.preventDefault(); closeFn(); return; }
    if (e.key !== 'Tab') return;
    const items = focusableIn(overlay);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = overlay.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
      e.preventDefault(); first.focus();
    }
  }
  document.addEventListener('keydown', onKeyDown);

  const card = overlay.querySelector('[data-overlay-card]');
  if (card) {
    card.setAttribute('tabindex', '-1');
    card.focus({ preventScroll: true });
  }

  return function teardown() {
    document.removeEventListener('keydown', onKeyDown);
    const i = overlayStack.indexOf(overlay);
    if (i !== -1) overlayStack.splice(i, 1);
    unlockScroll();
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus({ preventScroll: true });
    }
  };
}

/* ---------------- rendering ---------------- */

function render() {
  document.documentElement.lang = state.lang;
  if (state.route.name === 'list' && !state.lists.some(l => l.id === state.route.id)) {
    state.route = { name: 'lists' };
    if (location.hash !== '#/lists') location.hash = '#/lists';
  }
  document.title = routeTitle();
  renderHeader();
  if (state.route.name === 'lists') {
    renderListsHome();
  } else {
    renderToolbar();
    renderGrid();
  }
  renderFooter();
  syncDetail();
}

/** Brings the open card into line with the address — opening one that the URL
 * names, closing one it no longer does. The only place a detail card is
 * created or destroyed, so the two can never disagree. */
function syncDetail() {
  const wanted = state.route.env;
  // A language switch leaves the same card at the same address holding the old
  // language's text. Rebuilding is the only way to change it, since the card is
  // written out in one piece.
  const stale = openDetailId !== null && openDetailLang !== state.lang;
  if (wanted === openDetailId && !stale) return;
  /* Rebuilt for the language alone, the card should come back the way the
   * reader left it rather than as a freshly opened one. */
  const carry = stale && wanted === openDetailId ? detailViewState() : null;
  // Taken down before the card it stands on and put back after it, so it keeps
  // its place at the top of the stack.
  const restackItem = carry ? openItemId : null;
  if (restackItem) closeOpenItemDetail();
  if (openDetailId) closeDetailOverlay();
  if (!wanted) return;
  if (!allEnvs().some(e => e.id === wanted)) {
    // A link to an environment that is not in the catalog: drop the suffix
    // rather than leave the address pointing at nothing.
    history.replaceState(null, '', baseHash() || location.pathname + location.search);
    state.route = parseRoute();
    document.title = routeTitle();
    return;
  }
  openDetailOverlay(wanted, carry);
  if (restackItem) openItemDetail(restackItem);
}

/** What the reader has done to the open card that its address does not record:
 * the tier they are reading it at, and how far down they have scrolled. Read
 * off the DOM, so it costs nothing while no card needs rebuilding. */
function detailViewState() {
  const overlay = document.getElementById('detail-modal')?.closest('.modal-overlay');
  if (!overlay) return null;
  const activeTier = overlay.querySelector('[data-view-tier].active');
  return {
    viewTier: activeTier ? Number(activeTier.dataset.viewTier) : null,
    scrollTop: overlay.scrollTop,
  };
}

/** An open list names itself in the tab, so several of them are tellable apart
 * in a tab strip or a history list. */
function routeTitle() {
  // An open card names itself, so a shared link and a history entry both say
  // which environment they lead to.
  const env = state.route.env && allEnvs().find(e => e.id === state.route.env);
  if (env) return `${envName(env)} — ${t('app_title')}`;
  if (state.route.name === 'catalog') return t('app_title');
  if (state.route.name === 'list') {
    const list = state.lists.find(l => l.id === state.route.id);
    if (list) return `${list.name} — ${t('app_title')}`;
  }
  return `${t('lists_title')} — ${t('app_title')}`;
}

function renderHeader() {
  const el = document.getElementById('header');
  const onLists = state.route.name !== 'catalog';
  el.innerHTML = `
    <a class="skip-link" href="#grid-wrap">${t('skip_to_content')}</a>
    <div class="header-inner">
      <div class="brand">
        <img class="brand-mark" src="img/brand-logo.png?v=2" alt="" aria-hidden="true">
        <span class="brand-text">
          <h1><button type="button" id="brand-home">${t('app_title')}</button></h1>
          <p>${t('app_subtitle')}</p>
        </span>
      </div>
      <div class="header-actions">
        <div class="lang-switch">
          <button type="button" data-lang="ru" aria-pressed="${state.lang === 'ru'}" class="${state.lang === 'ru' ? 'active' : ''}">RU</button>
          <button type="button" data-lang="en" aria-pressed="${state.lang === 'en'}" class="${state.lang === 'en' ? 'active' : ''}">EN</button>
        </div>
        <nav class="header-nav" aria-label="${t('main_nav')}">
          <button type="button" class="btn ${onLists ? 'active' : ''}" id="btn-lists"
                  ${onLists ? 'aria-current="page"' : ''}>${t('nav_lists')}</button>
        </nav>
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
  // A real <button> now, so Enter and Space come for free — the old div carried
  // role="button" and tabindex but no key handler, and did nothing when focused.
  document.getElementById('brand-home').addEventListener('click', () => navigate(''));
  // The route lives in location.hash, so letting the anchor write "#grid-wrap"
  // there would parse as the catalog and navigate away from the lists page.
  // Move focus by hand and leave the hash alone.
  el.querySelector('.skip-link').addEventListener('click', e => {
    e.preventDefault();
    const target = document.getElementById('grid-wrap');
    target.setAttribute('tabindex', '-1');
    target.focus();
    target.scrollIntoView({ block: 'start' });
  });
}

// Long enough to swallow a burst of typing, short enough that the grid still
// feels like it is following the keyboard.
const SEARCH_DEBOUNCE_MS = 120;

function renderToolbar() {
  const el = document.getElementById('toolbar');
  const envs = currentEnvs();
  /* Every group offers only what the environments in front of you actually
   * carry. On the catalog that is the full set, so nothing changes there; on a
   * list it stops the toolbar promising ranks, types and biomes the list has
   * none of, and an empty list drops the groups altogether. Canonical order is
   * kept by filtering the reference arrays rather than collecting a Set. */
  const has = { tiers: new Set(), types: new Set(), biomes: new Set() };
  envs.forEach(e => {
    has.tiers.add(e.tier);
    has.types.add(e.type);
    (e.biomes || []).forEach(b => has.biomes.add(b));
  });
  const usedTiers = [1, 2, 3, 4].filter(tier => has.tiers.has(tier));
  const types = TYPES.filter(type => has.types.has(type));
  const usedBiomes = BIOMES.filter(biome => has.biomes.has(biome));
  /* A filter left pointing at something the current route cannot show would
   * empty the grid with no control still on screen to undo it. */
  state.filters.tiers.forEach(v => { if (!has.tiers.has(v)) state.filters.tiers.delete(v); });
  state.filters.types.forEach(v => { if (!has.types.has(v)) state.filters.types.delete(v); });
  state.filters.biomes.forEach(v => { if (!has.biomes.has(v)) state.filters.biomes.delete(v); });
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

  // How many filter groups are narrowing the list right now. Only shown next to
  // the phone-width disclosure, where the filters themselves are out of sight.
  const activeGroups = (state.filters.tiers.size ? 1 : 0) + (state.filters.types.size ? 1 : 0)
    + (state.filters.biomes.size ? 1 : 0) + (state.filters.regionOnly ? 1 : 0);

  el.innerHTML = listBar + `
    <div class="toolbar" data-filters-open="${state.filtersOpen}">
      <div class="field search-field">
        <label class="field-label" for="f-search">${t('search_label')}</label>
        <div class="search-input-wrap">
          <svg class="search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6.5" stroke="currentColor" stroke-width="1.6"/>
            <line x1="13.6" y1="13.6" x2="18" y2="18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <input type="text" id="f-search" placeholder="${t('search_placeholder')}" value="${escapeAttr(state.filters.search)}">
          <button type="button" class="search-clear-btn" id="f-search-clear" aria-label="${t('clear_filters')}" style="${state.filters.search ? '' : 'display:none;'}">×</button>
        </div>
      </div>
      <button type="button" class="btn filter-toggle" id="f-toggle"
              aria-expanded="${state.filtersOpen}" aria-controls="toolbar-filters">
        ${t('filters_label')}
        ${activeGroups ? `<span class="filter-count" aria-label="${t('filters_active').replace('{n}', activeGroups)}">${activeGroups}</span>` : ''}
      </button>
      <div class="toolbar-filters" id="toolbar-filters">
        ${usedTiers.length ? `
        <div class="field">
          <span class="field-label" id="f-tiers-label">${t('filter_tier')}</span>
          <div class="rank-pills field-control" id="f-tiers" role="group" aria-labelledby="f-tiers-label">
            ${usedTiers.map(tier => `<button type="button" class="rank-icon ${state.filters.tiers.has(tier) ? 'active' : ''}" data-tier="${tier}" aria-pressed="${state.filters.tiers.has(tier)}" aria-label="${t('tier_label')} ${tier}"><span>${tier}</span></button>`).join('')}
          </div>
        </div>` : ''}
        ${types.length || showRegionPill ? `
        <div class="field">
          <span class="field-label" id="f-types-label">${t('filter_type')}</span>
          <div class="type-pills field-control" id="f-types" role="group" aria-labelledby="f-types-label">
            ${types.map(type => `<button type="button" class="pill ${state.filters.types.has(type) ? 'active' : ''}" data-type="${type}" aria-pressed="${state.filters.types.has(type)}">${t('type_' + type)}</button>`).join('')}
            ${showRegionPill ? `<button type="button" class="pill ${state.filters.regionOnly ? 'active' : ''}" data-type="region" id="f-region" aria-pressed="${state.filters.regionOnly}">${t('region_label')}</button>` : ''}
          </div>
        </div>` : ''}
        ${usedBiomes.length ? `
        <div class="field">
          <label class="field-label" for="f-biome">${t('filter_biome')}</label>
          <select id="f-biome">
            <option value="">${t('all')}</option>
            ${usedBiomes.map(biome => `<option value="${biome}" ${state.filters.biomes.has(biome) ? 'selected' : ''}>${t('biome_' + biome)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>
    </div>`;

  const searchInput = document.getElementById('f-search');
  const searchClearBtn = document.getElementById('f-search-clear');
  // Debounced: the grid rebuild is ~190 cards' worth of markup and listeners,
  // and running it per keystroke put that on the typing path.
  let searchTimer = null;
  searchInput.addEventListener('input', e => {
    state.filters.search = e.target.value;
    searchClearBtn.style.display = e.target.value ? '' : 'none';
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderGrid, SEARCH_DEBOUNCE_MS);
  });

  document.getElementById('f-toggle').addEventListener('click', () => {
    state.filtersOpen = !state.filtersOpen;
    renderToolbar();
    document.getElementById('f-toggle').focus();
  });
  searchClearBtn.addEventListener('click', () => {
    clearTimeout(searchTimer);
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
  const biomeSelect = document.getElementById('f-biome');
  if (biomeSelect) biomeSelect.addEventListener('change', e => {
    state.filters.biomes = new Set(e.target.value ? [e.target.value] : []);
    renderGrid();
  });
  const backBtn = document.getElementById('btn-back-to-lists');
  if (backBtn) backBtn.addEventListener('click', () => navigate('#/lists'));
}

function toggleSetValue(set, value) { set.has(value) ? set.delete(value) : set.add(value); }

// Searching any term in a group also searches every other term in the group,
// so "магазин" finds Магическая Лавка and "tavern" finds Магический город.
// Both languages sit in one group because the haystack holds EN and RU text.
// Terms are stems matched at word start, which covers Russian inflections
// (лавк → лавка, лавке). Keep them long and unambiguous: a stem also fires
// inside longer words, so "порт" would drag in Город Порталов and "бар" every
// барьер. Verify a new term against the data before adding it.
//
// A group holds names for one and the same place, nothing looser. Everything a
// wider reading used to sweep in has been taken back out:
// - the person standing in the place ("торгов"/"merchant" matched 21 of 188
//   environments, nearly all of them a feast or a casino that merely lists a
//   Merchant among its adversaries; likewise innkeeper, bartender, barkeep),
// - the thing kept inside it ("книг"/"book" put Лаборатория, Магическая буря
//   and Оживлённый рынок under "библиотека"; "алтар"/"altar" put Туманная
//   Пустошь under "храм"),
// - a neighbouring but different place — a market is not a shop, a cave is not
//   a dungeon, a crypt is not a graveyard, so those now sit in groups of their
//   own,
// - a word the data only ever uses in another sense ("store" appears solely as
//   the verb, "store that roll"),
// - a synonym the data never uses at all, which only lengthens the table.
const SEARCH_ALIASES = [
  ['магазин', 'лавк', 'shop'],
  ['рынок', 'базар', 'market'],
  ['таверн', 'трактир', 'кабак', 'tavern'],
  ['кладбищ', 'погост', 'graveyard', 'cemetery'],
  ['склеп', 'гробниц', 'tomb', 'crypt'],
  ['храм', 'церк', 'temple', 'church'],
  ['пещер', 'cave', 'cavern'],
  ['библиотек', 'library'],
];

// Below this length a query is too generic to expand — "ба" would otherwise
// pull in the whole tavern group.
const MIN_ALIAS_QUERY = 3;

const aliasRegexCache = new Map();

function wordStartRegex(term) {
  let re = aliasRegexCache.get(term);
  if (!re) {
    re = new RegExp('(^|[^\\p{L}\\p{N}])' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    aliasRegexCache.set(term, re);
  }
  return re;
}

// A query expands only as a whole: it must be a prefix of a group term (user
// typed a stem, "таверн") or start with one (user typed an inflection,
// "таверной"). Multi-word queries stay literal — someone narrowing to
// "магазин товаров" wants fewer results than "магазин", not the whole group.
function aliasTermsFor(query) {
  if (query.length < MIN_ALIAS_QUERY || /\s/.test(query)) return [];
  const terms = new Set();
  for (const group of SEARCH_ALIASES) {
    if (!group.some(term => term.startsWith(query) || query.startsWith(term))) continue;
    for (const term of group) terms.add(term);
  }
  return [...terms];
}

// Literal substring first, so every match that worked before still works; the
// alias pass only ever widens the result set. It runs against a narrower
// haystack than the literal pass: the adversary list is a roster of stock NPCs
// that says nothing about what the place is, so a lone Merchant there must not
// answer for "рынок" — but typing "торговец" outright still finds it literally.
function matchesSearch(hay, aliasHay, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (hay.includes(q)) return true;
  return aliasTermsFor(q).some(term => wordStartRegex(term).test(aliasHay));
}

function envMatchesFilters(env) {
  const f = state.filters;
  if (f.search) {
    const featureText = (env.features || []).flatMap(feat => [
      feat.name?.en, feat.name?.ru, feat.description?.en, feat.description?.ru, feat.prompt?.en, feat.prompt?.ru,
    ]);
    const rawText = env.rawText ? [env.rawText.en, env.rawText.ru] : [];
    const adversaries = env.potential_adversaries
      ? [...(env.potential_adversaries.en || []), ...(env.potential_adversaries.ru || [])]
      : [];
    const aliasHay = [
      env.name.en, env.name.ru,
      ...(env.impulses ? [...(env.impulses.en || []), ...(env.impulses.ru || [])] : []),
      ...featureText, ...rawText,
    ].filter(Boolean).join(' ').toLowerCase();
    const hay = adversaries.length
      ? aliasHay + ' ' + adversaries.join(' ').toLowerCase()
      : aliasHay;
    if (!matchesSearch(hay, aliasHay, f.search)) return false;
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

/* Tier first, then the displayed name — so the grid reads as a ladder and each
 * rung is alphabetical in whichever language is on screen. */
function sortedFilteredEnvs() {
  const collator = new Intl.Collator(state.lang, { sensitivity: 'base', numeric: true });
  return currentEnvs()
    .filter(envMatchesFilters)
    .sort((a, b) => a.tier - b.tier || collator.compare(envName(a), envName(b)));
}

function renderGrid() {
  const el = document.getElementById('grid-wrap');
  const total = currentEnvs().length;
  const list = sortedFilteredEnvs();

  const countBar = document.getElementById('result-count');
  countBar.innerHTML = `${t('count_showing').replace('{n}', list.length).replace('{total}', total)}` +
    (hasActiveFilters() ? `<button id="clear-filters-btn">${t('clear_filters')}</button>` : '');
  const clearBtn = document.getElementById('clear-filters-btn');
  if (clearBtn) clearBtn.addEventListener('click', clearAllFilters);

  if (!list.length) {
    el.innerHTML = (state.route.name === 'list' && total === 0)
      ? emptyStateHtml({ icon: ICON_BOOKMARK, title: t('list_empty'), hint: t('list_empty_hint') })
      : emptyStateHtml({
          icon: ICON_SEARCH_EMPTY,
          title: t('no_results'),
          hint: t('no_results_hint'),
          // The way out of the state belongs inside it, not only up in the count bar.
          action: hasActiveFilters()
            ? `<button type="button" class="btn" data-clear-filters>${t('clear_filters')}</button>`
            : '',
        });
    bindGridDelegation(el);
    return;
  }

  el.innerHTML = list.map(cardHtml).join('');
  bindGridDelegation(el);
}

/* One listener on the container instead of two per card. With ~190 cards that
 * was ~380 registrations rebuilt on every filter change. */
function bindGridDelegation(el) {
  if (el._delegated) return;
  el._delegated = true;
  el.addEventListener('click', e => {
    const add = e.target.closest('[data-add-to-list]');
    if (add) { e.preventDefault(); openAddToListPopup(add.dataset.addToList); return; }
    const open = e.target.closest('[data-open-env]');
    if (open) { e.preventDefault(); showEnv(open.dataset.openEnv); return; }
    const clear = e.target.closest('[data-clear-filters]');
    if (clear) clearAllFilters();
  });
}

function clearAllFilters() {
  state.filters = { search: '', tiers: new Set(), types: new Set(), biomes: new Set(), regionOnly: false };
  renderToolbar();
  renderGrid();
  const search = document.getElementById('f-search');
  if (search) search.focus();
}

function hasActiveFilters() {
  const f = state.filters;
  return f.search || f.tiers.size || f.types.size || f.biomes.size || f.regionOnly;
}

/* Biomes that only get to supply a card picture when nothing else is on offer.
 * "universal" ("Другое") says nothing about the place, and "settlement" is worn
 * by a quarter of the catalog, so a more specific biome always outranks them.
 * Ordered least specific first, since each one is dropped in turn. */
const GENERIC_BIOMES = ['universal', 'settlement'];

/* Which biome's picture a card shows. Ties break on the biome id rather than the
 * translated name so the picture stays put when the language changes. */
function artBiome(env) {
  let pool = (env.biomes || []).filter(b => BIOMES.includes(b));
  for (const generic of GENERIC_BIOMES) {
    if (pool.length < 2) break;
    pool = pool.filter(b => b !== generic);
  }
  return pool.sort()[0] || null;
}

/* The picture panel is a fixed width, so the browser can be told exactly how
 * many pixels it will draw and pick the tier that matches the screen: 100 for
 * an ordinary display, 200 at 2x, 300 at 3x. Keep in step with .card-art. */
const ART_SIZES = '(max-width: 640px) 88px, 95px';
const ART_WIDTHS = [100, 200, 250, 300];

function biomeArtHtml(env) {
  const biome = artBiome(env);
  if (!biome) return '';
  const base = 'img/biomes/' + biome;
  const avif = ART_WIDTHS.map(w => `${base}-${w}.avif ${w}w`).join(', ');
  // AVIF holds the detail these landscapes need at a fraction of the weight;
  // the WebP is only there for a browser too old to decode it.
  return `
      <div class="card-art">
        <picture>
          <source type="image/avif" sizes="${ART_SIZES}" srcset="${avif}">
          <img src="${base}-200.webp" alt="" loading="lazy" decoding="async">
        </picture>
      </div>`;
}

function cardHtml(env) {
  const impulses = envField(env, 'impulses');
  const biomeChips = (env.biomes || []).map(b => `<span class="biome-chip">${t('biome_' + b)}</span>`).join('');
  // Environments that belong to a region carry its name alongside the biomes.
  // Regions are optional, so most cards show biome chips only.
  const region = regionOfEnv(env.id);
  const regionChip = region
    ? `<span class="region-chip" data-tip="${t('region_label')}"><span class="sr-only">${t('region_label')}: </span>${escapeHtml(regionName(region))}</span>`
    : '';
  const badges = [
    env.builtin ? '' : `<span class="badge custom">${t('custom_badge')}</span>`,
    isTranslated(env) ? '' : `<span class="badge pending">${t('untranslated_badge')}</span>`,
  ].join('');
  // The whole card is still the click target — the stretched ::after on
  // .card-open covers it — but the tab stop and the accessible name now sit on
  // one real button, so the catalog is reachable from the keyboard.
  return `
    <article class="card" data-id="${env.id}" data-type="${env.type}">
      ${biomeArtHtml(env)}
      <div class="card-body">
        <div class="card-top">
          <div class="card-title-row">
            <h3 class="card-title"><button type="button" class="card-open" data-open-env="${env.id}">${escapeHtml(envName(env))}</button></h3>
            <button type="button" class="card-add-btn" data-add-to-list="${env.id}" aria-label="${t('add_to_list')}" data-tip="${t('add_to_list')}">+</button>
          </div>
          <span class="rank-icon rank-icon-sm active" role="img" aria-label="${t('tier_label')} ${env.tier}" data-tip="${t('tier_label')} ${env.tier}"><span aria-hidden="true">${env.tier}</span></span>
        </div>
        <div class="card-meta">
          <span>${t('type_' + env.type)}</span>
          ${hasDifficulty(env) ? `<span class="diff">${t('difficulty_label')} ${escapeHtml(String(envDifficulty(env)))}</span>` : ''}
        </div>
        ${impulses.length ? `<div class="card-impulses">${escapeHtml(impulses.join(', '))}</div>` : ''}
        ${biomeChips || regionChip ? `<div class="card-biomes">${biomeChips}${regionChip}</div>` : ''}
        ${badges}
      </div>
    </article>`;
}

function renderFooter() {
  const el = document.getElementById('footer');
  const showReset = state.route.name === 'lists';
  el.innerHTML = `
    <span>${t('footer_note')}</span>
    ${showReset ? `<button type="button" class="btn btn-sm btn-ghost" id="btn-reset">${t('reset_data')}</button>` : ''}`;
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

/* An environment that belongs to no list leaves no key behind. An empty array
 * is a membership record that records nothing, and it would sit in storage for
 * good once the list that put it there is gone. Callers persist. */
function setEnvLists(envId, listIds) {
  if (listIds.length) state.envLists[envId] = listIds;
  else delete state.envLists[envId];
}

function listEnvCount(listId) {
  return Object.values(state.envLists).filter(ids => (ids || []).includes(listId)).length;
}

function renderListsHome() {
  document.getElementById('toolbar').innerHTML = '';
  document.getElementById('result-count').innerHTML = '';
  const el = document.getElementById('grid-wrap');
  el.innerHTML = `
    <div class="lists-home-wrap" style="grid-column:1/-1">
      <h2 class="page-title">${t('lists_title')}</h2>
      ${state.storageNoticeDismissed ? '' : `
      <div class="storage-notice" role="status">
        <span class="storage-notice-icon" aria-hidden="true">!</span>
        <p class="storage-notice-text">${t('storage_notice')}</p>
        <button type="button" class="storage-notice-close" id="storage-notice-close"
                aria-label="${t('dismiss')}" data-tip="${t('dismiss')}">×</button>
      </div>`}
      <div>
        <div class="new-list-row">
          <input type="text" id="new-list-input" placeholder="${t('new_list_name')}"
                 aria-label="${t('new_list_name')}" aria-describedby="new-list-error">
          <button type="button" class="btn btn-primary" id="new-list-btn">${t('create')}</button>
        </div>
        <p class="field-error" id="new-list-error" hidden>${ICON_ALERT}<span>${t('list_name_required')}</span></p>
      </div>
      ${state.lists.length
        ? `<div class="list-cards-grid">${state.lists.map(listCardHtml).join('')}</div>`
        : emptyStateHtml({ icon: ICON_BOOKMARK, title: t('no_lists_yet'), hint: t('no_lists_hint') })}
    </div>`;

  const noticeClose = document.getElementById('storage-notice-close');
  if (noticeClose) noticeClose.addEventListener('click', () => {
    state.storageNoticeDismissed = true;
    localStorage.setItem(LS_KEYS.storageNoticeDismissed, '1');
    const notice = noticeClose.closest('.storage-notice');
    if (notice) notice.remove();
  });

  const newListInput = document.getElementById('new-list-input');
  const newListError = document.getElementById('new-list-error');

  function createList() {
    const name = newListInput.value.trim();
    // An empty name used to fail silently — the button simply did nothing.
    if (!name) {
      newListError.hidden = false;
      newListInput.setAttribute('aria-invalid', 'true');
      newListInput.focus();
      return;
    }
    state.lists.push({ id: 'list-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name });
    persist(LS_KEYS.lists, state.lists);
    renderListsHome();
    showToast(t('list_created').replace('{n}', name));
    const input = document.getElementById('new-list-input');
    if (input) input.focus();
  }

  newListInput.addEventListener('input', () => {
    newListError.hidden = true;
    newListInput.removeAttribute('aria-invalid');
  });
  newListInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); createList(); }
  });
  document.getElementById('new-list-btn').addEventListener('click', createList);

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
        setEnvLists(envId, (state.envLists[envId] || []).filter(lid => lid !== id));
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
        <input type="text" value="${escapeAttr(list.name)}" class="list-rename" aria-label="${t('new_list_name')}">
        <button type="button" class="btn btn-sm btn-danger" data-del-list="${list.id}">${t('delete')}</button>
      </div>
      <div class="list-card-count">${t('list_env_count').replace('{n}', listEnvCount(list.id))}</div>
      <button type="button" class="btn btn-sm" data-open-list="${list.id}">${t('open_list')}</button>
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
        <span>${escapeHtml(l.name)}</span>
      </label>`).join('') || `<p class="hint">${t('no_lists_yet')}</p>`;
  }

  overlay.innerHTML = `
    <div class="modal modal-sm" data-overlay-card
         role="dialog" aria-modal="true" aria-labelledby="atl-title">
      <div class="modal-header">
        <h2 id="atl-title">${t('add_to_list')}</h2>
        <button type="button" class="modal-close" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div id="atl-list">${listRowsHtml()}</div>
        <div style="margin-top:var(--s-4)">
          <div class="new-list-row">
            <input type="text" id="atl-new-input" placeholder="${t('new_list_name')}"
                   aria-label="${t('new_list_name')}" aria-describedby="atl-new-error">
            <button type="button" class="btn btn-primary" id="atl-new-btn">${t('create')}</button>
          </div>
          <p class="field-error" id="atl-new-error" hidden>${ICON_ALERT}<span>${t('list_name_required')}</span></p>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const teardown = registerOverlay(overlay, close);

  function bindToggle(cb) {
    cb.addEventListener('change', () => {
      const listId = cb.dataset.listToggle;
      const list = state.lists.find(l => l.id === listId);
      const set = new Set(state.envLists[envId] || []);
      if (cb.checked) set.add(listId); else set.delete(listId);
      setEnvLists(envId, [...set]);
      persist(LS_KEYS.envLists, state.envLists);
      // Membership is otherwise a silent toggle with nothing to confirm it.
      showToast((cb.checked ? t('added_to_list') : t('removed_from_list')).replace('{n}', list ? list.name : ''));
    });
  }
  overlay.querySelectorAll('[data-list-toggle]').forEach(bindToggle);

  function close() {
    overlay.remove();
    teardown();
    // Only the list routes show anything that membership changes; re-rendering
    // the catalog here would throw away the focus teardown just restored.
    if (state.route.name !== 'catalog') render();
  }

  overlay.querySelector('.modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const newInput = overlay.querySelector('#atl-new-input');
  const newError = overlay.querySelector('#atl-new-error');

  function createAndAdd() {
    const name = newInput.value.trim();
    if (!name) {
      newError.hidden = false;
      newInput.setAttribute('aria-invalid', 'true');
      newInput.focus();
      return;
    }
    const list = { id: 'list-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name };
    state.lists.push(list);
    persist(LS_KEYS.lists, state.lists);
    const set = new Set(state.envLists[envId] || []);
    set.add(list.id);
    setEnvLists(envId, [...set]);
    persist(LS_KEYS.envLists, state.envLists);
    newInput.value = '';
    const container = overlay.querySelector('#atl-list');
    container.innerHTML = listRowsHtml();
    container.querySelectorAll('[data-list-toggle]').forEach(bindToggle);
    showToast(t('added_to_list').replace('{n}', name));
    newInput.focus();
  }

  newInput.addEventListener('input', () => {
    newError.hidden = true;
    newInput.removeAttribute('aria-invalid');
  });
  newInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); createAndAdd(); }
  });
  overlay.querySelector('#atl-new-btn').addEventListener('click', createAndAdd);
}

/* ---------------- reading a stat block at another tier ---------------- */

/* "Environment Statistics by Tier" from the Core Rulebook. `difficulty` is the
 * printed value; `band` is the printed damage range expressed as average damage
 * (tier 1 runs 1d6+1 … 1d8+3, i.e. 4.5 … 7.5); `dice` are the die sizes that
 * range uses; `mid` is the band midpoint, used to scale damage the book never
 * prints. */
const TIER_TABLE = {
  1: { difficulty: 11, band: [4.5, 7.5], dice: [6, 8], mid: 6 },
  2: { difficulty: 14, band: [10, 13], dice: [6, 8, 10], mid: 11.5 },
  3: { difficulty: 17, band: [16.5, 17.5], dice: [8, 10], mid: 17 },
  4: { difficulty: 20, band: [21, 32], dice: [8, 10], mid: 26.5 },
};

// No environment in the book or in data/environments.json sits outside 10–20.
const DIFFICULTY_FLOOR = 10;
const DIFFICULTY_CEIL = 20;

const DIE_SIZES = [3, 4, 6, 8, 10, 12, 20, 100];

function diceAvg(count, sides, mod) { return count * (sides + 1) / 2 + mod; }

/** Environments deviate from the printed difficulty by −2…+3 and that deviation
 * is authored tuning, so it is carried over instead of showing the flat table
 * value: a tier 2 environment at 13 (one below the table) reads 16 at tier 3.
 * Descriptive difficulties ("Special (see Relative Strength)") never scale. */
function retierDifficulty(env, tier) {
  if (typeof env.difficulty !== 'number') return envDifficulty(env);
  if (tier === env.tier) return env.difficulty;
  const shifted = env.difficulty + TIER_TABLE[tier].difficulty - TIER_TABLE[env.tier].difficulty;
  return Math.min(DIFFICULTY_CEIL, Math.max(DIFFICULTY_FLOOR, shifted));
}

const damageLadderCache = new Map();

/** Every XdY+Z the table allows for a tier: X equal to the tier, Y one of the
 * tier's die sizes, Z whatever keeps the average inside the printed band. */
function tierDamageLadder(tier) {
  let ladder = damageLadderCache.get(tier);
  if (!ladder) {
    const { band, dice } = TIER_TABLE[tier];
    ladder = [];
    for (const sides of dice) {
      for (let mod = 0; mod <= 15; mod++) {
        const avg = diceAvg(tier, sides, mod);
        if (avg >= band[0] && avg <= band[1]) ladder.push({ count: tier, sides, mod, avg });
      }
    }
    ladder.sort((a, b) => a.avg - b.avg || a.sides - b.sides);
    damageLadderCache.set(tier, ladder);
  }
  return ladder;
}

/** Damage that sits inside its own tier's printed range keeps its position in
 * that range: the tier 2 minimum (2d6+3) reads as the tier 3 minimum (3d8+3).
 * The result is always a roll the table itself allows. */
function mapDamageWithinTable(from, to, roll) {
  const [lo, hi] = TIER_TABLE[from].band;
  const pos = (diceAvg(roll.count, roll.sides, roll.mod) - lo) / (hi - lo || 1);
  const [tLo, tHi] = TIER_TABLE[to].band;
  const want = tLo + pos * (tHi - tLo);
  let best = null;
  for (const cand of tierDamageLadder(to)) {
    if (!best || Math.abs(cand.avg - want) < Math.abs(best.avg - want)) best = cand;
  }
  return best;
}

/** Damage the book never prints — 8d12 in Castle Of Wails, 3d20 in Scorching
 * Dungeon, 2d8+12 in Stop The Collapse Of Reality. Squeezing those into the
 * printed band would *lower* the damage when the tier goes up (8d12 averages 52,
 * the whole tier 3 range tops out at 17.5), so they scale against themselves
 * instead: the average moves by the ratio of the two tiers' midpoints and the
 * die type is kept, so an unusually brutal hazard stays unusually brutal. */
function scaleDamageOutsideTable(from, to, roll) {
  const ratio = TIER_TABLE[to].mid / TIER_TABLE[from].mid;
  const want = diceAvg(roll.count, roll.sides, roll.mod) * ratio;
  let count = Math.max(1, Math.round(roll.count * ratio));
  let sides = roll.sides;
  for (;;) {
    const mod = Math.round(want - diceAvg(count, sides, 0));
    if (mod >= 0) return { count, sides, mod };
    if (count > 1) { count--; continue; }        // drop a die before shrinking one
    const i = DIE_SIZES.indexOf(sides);
    if (i > 0) { sides = DIE_SIZES[i - 1]; continue; }
    return { count: 1, sides: DIE_SIZES[0], mod: 0 };
  }
}

/** Safety net for the two mappings above: a higher tier must hit harder and a
 * lower one softer, never the reverse. Both mappings already guarantee this for
 * every roll in the bundled data — this only catches rounding on hand-authored
 * environments. */
function enforceDamageDirection(from, to, roll, scaled) {
  const target = diceAvg(roll.count, roll.sides, roll.mod);
  const dir = to > from ? 1 : -1;
  let { count, sides, mod } = scaled;
  for (let i = 0; i < 40 && dir * (diceAvg(count, sides, mod) - target) <= 0; i++) {
    if (dir > 0) { mod++; continue; }
    if (mod > 0) { mod--; continue; }
    const idx = DIE_SIZES.indexOf(sides);
    if (idx > 0) { sides = DIE_SIZES[idx - 1]; continue; }
    if (count > 1) { count--; continue; }
    break;                                       // 1d3 is the floor
  }
  return { count, sides, mod };
}

/** The same damage roll read at another tier. The environment's own tier always
 * returns the authored roll untouched — nothing about a stat block is ever
 * rewritten at its native tier. */
function retierDamage(from, to, roll) {
  if (to === from) return { count: roll.count, sides: roll.sides, mod: roll.mod, changed: false };
  const avg = diceAvg(roll.count, roll.sides, roll.mod);
  const [lo, hi] = TIER_TABLE[from].band;
  const scaled = (avg >= lo && avg <= hi)
    ? mapDamageWithinTable(from, to, roll)
    : scaleDamageOutsideTable(from, to, roll);
  return { ...enforceDamageDirection(from, to, roll, scaled), changed: true };
}

/** A scaled roll always prints its count, even where the source wrote "d6":
 * the count is the part that carries the tier. */
function formatDamage(roll) {
  return `${roll.count}d${roll.sides}` + (roll.mod > 0 ? `+${roll.mod}` : '');
}

/* ---------------- detail modal ---------------- */

/* Which card is on screen, and how to take it away again. syncDetail() owns
 * both: nothing else opens or closes a detail card. */
let openDetailId = null;
/* A card's text is baked into its markup at open time, so the address alone no
 * longer says whether what is on screen is current — the language it was built
 * in has to be remembered alongside it. */
let openDetailLang = null;
let closeDetailOverlay = () => {};

/* Whether the card on screen was opened from this page, and so has a history
 * entry of its own to step back through, or arrived with the address — in
 * which case going back would walk off the site rather than close the card. */
let cardEntryPushed = false;

/** Opens a card by address. Everything that opens one — a grid click, a shared
 * link, the Forward button — arrives through the hash, so the card on screen
 * and the URL can never disagree. */
function showEnv(envId) {
  const target = envHash(envId);
  if (location.hash === target) return;
  cardEntryPushed = true;
  location.hash = target;
}

/** Closes the card the way the × and Escape mean it: back out of the entry
 * that opened it, or, for a card that arrived with the address, rewrite the
 * address to the route behind it without adding to the history. */
function dismissDetail() {
  if (cardEntryPushed) { cardEntryPushed = false; history.back(); return; }
  history.replaceState(null, '', baseHash() || location.pathname + location.search);
  state.route = parseRoute();
  syncDetail();
  document.title = routeTitle();
}

/** A neighbour opened from the region block takes the place of the card that
 * offered it, so Escape still means "back to the grid" rather than walking
 * back through every card visited along the way. */
function replaceEnv(envId) {
  history.replaceState(null, '', envHash(envId));
  state.route = parseRoute();
  syncDetail();
  document.title = routeTitle();
}

function openDetailOverlay(envId, carry = null) {
  const env = allEnvs().find(e => e.id === envId);
  if (!env) return;
  const impulses = envField(env, 'impulses');
  const adversaries = envField(env, 'potential_adversaries');

  /* The tier the card is currently being read at. Deliberately modal-local: it
   * lives while this card is open and is gone the moment it closes, so nothing
   * outside — cards, filters, region badges, storage — ever sees an override.
   * Opening a neighbour from the region block opens it at its own tier; only a
   * card being rebuilt in place, for the language, carries its override over. */
  let viewTier = carry?.viewTier ?? env.tier;

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

  // Passive, then reaction, then action. The groups are told apart by the type
  // chip on each feature and by the gap between them, so there is no rule drawn
  // between them.
  const featuresHtml = ['passive', 'reaction', 'action']
    .map(type => (env.features || []).filter(f => f.type === type).map(featureHtml).join(''))
    .filter(Boolean)
    .map(group => `<div class="feature-group">${group}</div>`)
    .join('');

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

  /* The environment's own tier carries a dot, so an overridden card never hides
   * which tier the stat block was actually written for — and so the row reads as
   * something switchable rather than as a rating. */
  const tierPillsHtml = [1, 2, 3, 4].map(n => `
    <button type="button" class="rank-icon rank-icon-sm ${n === env.tier ? 'native' : ''}" data-view-tier="${n}"
            aria-label="${t('view_as_tier')} ${n}" data-tip="${n === env.tier ? t('native_tier') : t('view_as_tier') + ' ' + n}"
      ><span>${n}</span>${n === env.tier ? '<i class="rank-native-dot" aria-hidden="true"></i>' : ''}</button>`).join('');

  const biomesHtml = (env.biomes || []).length ? `
    <div class="detail-footer-biomes">
      <span class="dm-k">${t('filter_biome')}</span><span class="dm-dash">—</span>
      ${env.biomes.map(b => `<span class="biome-chip">${t('biome_' + b)}</span>`).join('')}
    </div>` : '<span></span>';

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal" id="detail-modal" data-overlay-card
         role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div class="modal-header">
        <div class="modal-title-row">
          <h2 id="detail-title">${escapeHtml(envName(env))}</h2>
          <button type="button" class="card-add-btn" id="detail-add-to-list" aria-label="${t('add_to_list')}" data-tip="${t('add_to_list')}">+</button>
        </div>
        <div class="rank-pills detail-tier-pills" id="detail-tier-pills" role="group" aria-label="${t('view_as_tier')}">${tierPillsHtml}</div>
        <button type="button" class="modal-close" aria-label="${t('close')}">&times;</button>
      </div>
      <div class="modal-body">
        <div class="detail-meta">
          ${hasDifficulty(env) ? `
          <span class="dm-item">
            <span class="dm-k">${t('difficulty_label')}</span><span class="dm-dash">—</span>
            <span class="dm-v" id="detail-difficulty-value"></span>
            <span class="dm-orig" id="detail-difficulty-orig"></span>
          </span>
          <span class="dm-sep" aria-hidden="true">·</span>` : ''}
          <span class="dm-item">
            <span class="dm-k">${t('filter_type')}</span><span class="dm-dash">—</span>
            <span class="dm-v dm-v-text">${t('type_' + env.type)}</span>
          </span>
        </div>

        ${impulses.length ? `<span class="section-label">${t('impulses_label')}</span><p class="impulse-list">${escapeHtml(impulses.join(', '))}</p>` : ''}
        ${adversaries.length ? `<span class="section-label">${t('adversaries_label')}</span><p class="adversary-list">${escapeHtml(adversaries.join('; '))}</p>` : ''}
        ${featuresHtml ? `<span class="section-label">${t('features_label')}</span>${featuresHtml}` : ''}
        ${rawHtml}
        ${regionHtml}

        <div class="detail-footer">
          ${biomesHtml}
          <button type="button" class="btn" id="detail-add-to-list-bottom">${t('add_to_list')}</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const modalEl = overlay.querySelector('#detail-modal');
  const difficultyValueEl = overlay.querySelector('#detail-difficulty-value');
  const difficultyOrigEl = overlay.querySelector('#detail-difficulty-orig');

  /** Countdown panels whose button was replaced by a re-render would otherwise
   * linger over the card with nothing behind them. */
  function pruneCountdownOverlays() {
    (overlay._countdownOverlays || []).slice().forEach(panel => {
      if (panel._btn && !document.body.contains(panel._btn)) {
        panel.remove();
        overlay._countdownOverlays = overlay._countdownOverlays.filter(p => p !== panel);
      }
    });
  }

  // Renders dice- and countdown-enabled text, with bullet-list support. On a
  // tier switch only blocks that actually hold a damage roll are rebuilt, so a
  // countdown tracker opened elsewhere in the card survives the switch.
  function renderRichBlocks() {
    const retier = viewTier === env.tier ? null : { from: env.tier, to: viewTier };
    overlay.querySelectorAll('[data-rich-block]').forEach(node => {
      const text = decodeURIComponent(node.getAttribute('data-rich-block'));
      if (node._renderedTier === viewTier) return;
      if (node._renderedTier !== undefined && !hasDamageRoll(text)) return;
      node._renderedTier = viewTier;
      renderFeatureBody(node, text, retier);
    });
    pruneCountdownOverlays();
  }

  function applyViewTier() {
    const overridden = viewTier !== env.tier;
    // While a card is read at another tier it says so twice over: an amber rim
    // around the whole card, and the environment's own difficulty spelled out
    // next to the scaled one.
    modalEl.classList.toggle('retiered', overridden);
    // A descriptive difficulty reads the same at every tier, so it is printed
    // but never annotated: there is no original to set it against, and
    // "(orig. Special (see …))" would only repeat the line above it.
    if (difficultyValueEl) {
      const annotate = overridden && difficultyScales(env);
      difficultyValueEl.textContent = String(retierDifficulty(env, viewTier));
      difficultyOrigEl.textContent = annotate
        ? t('retier_original_short').replace('{v}', String(envDifficulty(env)))
        : '';
      if (annotate) {
        difficultyValueEl.dataset.tip =
          t('retier_original').replace('{v}', `${t('tier_label')} ${env.tier}, ${t('difficulty_label')} ${envDifficulty(env)}`);
      } else {
        delete difficultyValueEl.dataset.tip;
      }
    }
    overlay.querySelectorAll('[data-view-tier]').forEach(btn => {
      const on = Number(btn.dataset.viewTier) === viewTier;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    renderRichBlocks();
  }

  overlay.querySelectorAll('[data-view-tier]').forEach(btn => btn.addEventListener('click', () => {
    viewTier = Number(btn.dataset.viewTier);
    applyViewTier();
  }));
  applyViewTier();

  const teardown = registerOverlay(overlay, dismissDetail);

  // After registerOverlay, which focuses the card: focusing it scrolls the
  // overlay back to the top, so restoring the position has to come last.
  if (carry?.scrollTop) overlay.scrollTop = carry.scrollTop;

  openDetailId = envId;
  openDetailLang = state.lang;
  /* The raw teardown, with no opinion about history. syncDetail() calls it once
   * the address stops naming this card — which is the only way a card ever
   * comes off the screen. */
  closeDetailOverlay = () => {
    (overlay._countdownOverlays || []).slice().forEach(p => p.remove());
    overlay.remove();
    teardown();
    openDetailId = null;
    openDetailLang = null;
    closeDetailOverlay = () => {};
  };

  overlay.querySelector('.modal-close').addEventListener('click', dismissDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) dismissDetail(); });

  overlay.querySelectorAll('[data-region-env]').forEach(btn => btn.addEventListener('click', () => {
    replaceEnv(btn.dataset.regionEnv);
  }));

  overlay.querySelector('#detail-add-to-list').addEventListener('click', () => openAddToListPopup(env.id));
  overlay.querySelector('#detail-add-to-list-bottom').addEventListener('click', () => openAddToListPopup(env.id));
}

/* ---------------- item card ---------------- */

/* This card is a copy of the one the loot generator shows, down to its palette,
 * type and spacing — square art on top, the badge row, the name, the text and
 * the craft chain, on that site's plum surface rather than our parchment. It is
 * quoting another site's card, and the seam is the point: everything inside is
 * theirs. The artwork is served from there too, so a picture that will not load
 * simply drops out of the card. */
const ITEM_CRAFT_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 11h11.2l-3.6-3.6L13 6l6 6-6 6-1.4-1.4 3.6-3.6H4v-2z"/></svg>`;
const ITEM_LINK_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3.9 12a5.1 5.1 0 0 1 5.1-5.1h4V5H9a7 7 0 0 0 0 14h4v-1.9H9A5.1 5.1 0 0 1 3.9 12zM8 13h8v-2H8v2zm7-8v1.9h4a5.1 5.1 0 0 1 0 10.2h-4V19h4a7 7 0 0 0 0-14h-4z"/></svg>`;

/* The quoted card is set in Inter, which is not one of the atlas's three
 * faces. Requesting it up front would put a fourth family on every page load
 * for an overlay most visitors never open, and leaving it out of the request
 * — as it was — meant the quotation silently fell through to the system sans
 * on almost every machine. So it is fetched the first time an item card is
 * actually opened, and never otherwise. */
/* The quoted card is only ever opened from a link inside an environment card,
 * so it sits on top of one — and bakes its text in the same way. Rebuilding the
 * card underneath has to take this one with it, or the language switch would
 * leave a stale item card stranded beneath the card it was opened from. */
let openItemId = null;
let closeOpenItemDetail = () => {};

let lootFontRequested = false;
function ensureLootFont() {
  if (lootFontRequested) return;
  lootFontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap';
  document.head.appendChild(link);
}

function openItemDetail(itemId) {
  const item = itemById(itemId);
  if (!item) return;
  ensureLootFont();

  const name = itemField(item, 'name');
  const art = itemImageUrl(item);
  const kind = item.kind === 'consumable' ? 'consumable' : 'item';

  const craftHtml = itemCraftRows(itemId).map(row => `
    <p>${ITEM_CRAFT_ICON}<span class="loot-craft-l">${row.label}</span>
       <button type="button" class="loot-craft-a" data-craft-item="${escapeAttr(row.id)}">${escapeHtml(itemField(itemById(row.id), 'name'))}</button></p>`).join('');

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay loot-overlay';
  overlay.innerHTML = `
    <div class="loot-modal-card" data-overlay-card role="dialog" aria-modal="true" aria-label="${escapeAttr(name)}">
      <button type="button" class="loot-x" aria-label="${t('close')}">&times;</button>
      <article class="loot-card">
        ${art ? `<div class="loot-media"><img src="${escapeAttr(art)}" alt="${escapeAttr(name)}"></div>` : ''}
        <div class="loot-body">
          <div class="loot-meta">
            ${item.roll ? `<span class="loot-badge num">${item.roll}</span>` : ''}
            <span class="loot-badge ${kind === 'consumable' ? 'cons' : 'thing'}">${t('item_kind_' + kind)}</span>
            <span class="loot-badge src">${t('item_src_' + item.src)}</span>
          </div>
          <h2 class="loot-name"><span>${escapeHtml(name)}</span></h2>
          <div class="loot-desc" data-item-desc></div>
          ${craftHtml ? `<div class="loot-craft">${craftHtml}</div>` : ''}
          <div class="loot-acts">
            <a class="loot-btn" href="${escapeAttr(itemUrl(itemId))}" target="_blank" rel="noopener">${ITEM_LINK_ICON}${t('open_in_loot')}</a>
          </div>
          <p class="loot-src-note">${t('loot_src_note')}</p>
        </div>
      </article>
    </div>`;
  document.body.appendChild(overlay);

  // Item text carries its own rolls ("clear 1d4 HP"), so it goes through the
  // same renderer as a feature — minus the tier scaling, which describes an
  // environment's damage and has nothing to say about a potion.
  renderFeatureBody(overlay.querySelector('[data-item-desc]'), itemField(item, 'description'), null);

  const media = overlay.querySelector('.loot-media');
  if (media) media.querySelector('img').addEventListener('error', () => media.remove());

  const teardown = registerOverlay(overlay, closeItem);

  function closeItem() {
    (overlay._countdownOverlays || []).slice().forEach(p => p.remove());
    overlay.remove();
    teardown();
    if (closeOpenItemDetail === closeItem) {
      openItemId = null;
      closeOpenItemDetail = () => {};
    }
  }

  openItemId = itemId;
  closeOpenItemDetail = closeItem;

  overlay.querySelector('.loot-x').addEventListener('click', closeItem);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeItem(); });

  // Walking the craft chain replaces this card rather than stacking another one:
  // the chain is one entry read from a different end, not a second thing to close.
  overlay.querySelectorAll('[data-craft-item]').forEach(btn => btn.addEventListener('click', () => {
    const nextId = btn.dataset.craftItem;
    closeItem();
    openItemDetail(nextId);
  }));
}

/* ---------------- dice parsing + rolling ---------------- */

/* Matches "2d6", "d20" and an optional flat modifier ("1d6+2", "3d6 - 1"). The
 * lookahead keeps the modifier from swallowing the first die of a following
 * roll, so "2d6 + 1d8" stays two separate buttons. English pluralises the
 * notation — "roll a number of d12s" — so a trailing "s" is allowed to end the
 * die but left out of the match, which keeps the button reading "d12" and the
 * "s" as the prose it belongs to. */
const DICE_RE = /\b(\d{0,2})d(3|4|6|8|10|12|20|100)(?=s?\b)(?:\s*([+-])\s*(\d+)\b(?!\s*d\s*\d))?/gi;
const COUNTDOWN_KEYWORD_RE = /(Countdown|Отсчёт\w*|Отсчет\w*|Счётчик\w*|Счетчик\w*)/gi;
const COUNTDOWN_PAREN_RE = /\(\s*(?:(?:Loop|Цикл)\s+)?(?:(\d*)d)?(\d+)\s*\)/gi;

/* A difficulty in parentheses is not a countdown. "…stop the countdown with a
 * successful Finesse Roll (20)" names a check the party makes against the
 * tracker, and the keyword sitting earlier in the same sentence is the only
 * reason it looks like one, so a roll word between the two disqualifies it. */
const COUNTDOWN_ROLL_WORD_RE = /\b(?:roll|check|DC)\b|Брос\w*|Провер\w*|Сложност\w*/i;

/** Finds "<...Countdown/Отсчёт...> (6)"-style spans in free text: scans for a
 * plain integer, optionally prefixed by a "Loop"/"Цикл" qualifier and/or dice
 * notation (e.g. "(6)", "(Loop 1d6)", "(Цикл d20)"), then walks back to the
 * nearest sentence boundary and takes the text from the closest preceding
 * countdown keyword up to the parens. A "Loop XdY" countdown starts at the
 * highest the dice can show (X times Y), not a roll, so this is matched ahead
 * of the plain dice-roll regex to keep it out of a roll button. */
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
    if (COUNTDOWN_ROLL_WORD_RE.test(segment.slice(kwMatch.index + kwMatch[0].length))) continue;
    // m[1] is the die count: absent for a plain "(6)", empty for "(d20)".
    const sides = parseInt(m[2], 10);
    const dieCount = m[1] === undefined ? 0 : (m[1] === '' ? 1 : parseInt(m[1], 10));
    const value = dieCount ? dieCount * sides : sides;
    const labelStart = segmentStart + kwMatch.index;
    matches.push({ start: labelStart, end: parenEnd, type: 'countdown', value, label: text.slice(labelStart, parenEnd) });
  }
  return matches;
}

/* A roll counts as damage only when a damage word follows it in the same clause:
 * "3d8 physical damage", "3d8 магического урона". Everything else is left as
 * authored — "summon 2d4+2 Rotted Zombies", "roll 1d4 or choose a trap",
 * "1d3 prisoners". The scan stops at the next roll, so in "1d3+2 guards … doing
 * 1d8 physical damage" only the 1d8 is damage. */
const DAMAGE_WORD_RE = /(damage|уро[нм])/i;
const NEXT_DICE_RE = /\b\d{0,2}d(?:3|4|6|8|10|12|20|100)\b/i;
const DAMAGE_SCAN_CHARS = 70;

function isDamageRoll(text, from) {
  let clause = text.slice(from, from + DAMAGE_SCAN_CHARS).split(/[.!?;:]/)[0];
  const nextDice = clause.search(NEXT_DICE_RE);
  if (nextDice !== -1) clause = clause.slice(0, nextDice);
  return DAMAGE_WORD_RE.test(clause);
}

function findDiceMatches(text) {
  const matches = [];
  DICE_RE.lastIndex = 0;
  let m;
  while ((m = DICE_RE.exec(text))) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = parseInt(m[2], 10);
    const mod = m[4] ? (m[3] === '-' ? -1 : 1) * parseInt(m[4], 10) : 0;
    const end = m.index + m[0].length;
    matches.push({ start: m.index, end, type: 'dice', count, sides, mod, label: m[0], isDamage: isDamageRoll(text, end) });
  }
  return matches;
}

function hasDamageRoll(text) {
  return findDiceMatches(text).some(m => m.isDamage);
}

/** `retier` is `{ from, to }` while the card is being read at another tier, or
 * null at the environment's own tier. Only damage rolls follow it; countdowns
 * and every other roll in the text are left exactly as written. */
function renderRichText(container, text, retier) {
  container.textContent = '';
  const matches = [...findDiceMatches(text), ...findCountdownMatches(text)].sort((a, b) => a.start - b.start);

  let lastIndex = 0;
  for (const match of matches) {
    if (match.start < lastIndex) continue; // skip overlapping match
    if (match.start > lastIndex) container.appendChild(document.createTextNode(text.slice(lastIndex, match.start)));
    if (match.type === 'dice') {
      const scaled = retier && match.isDamage ? retierDamage(retier.from, retier.to, match) : null;
      container.appendChild(scaled && scaled.changed
        ? makeDiceButton(scaled.count, scaled.sides, scaled.mod, formatDamage(scaled), match.label)
        : makeDiceButton(match.count, match.sides, match.mod, match.label));
    } else {
      container.appendChild(makeCountdownButton(match.value, match.label));
    }
    lastIndex = match.end;
  }
  if (lastIndex < text.length) container.appendChild(document.createTextNode(text.slice(lastIndex)));
}

const BULLET_LINE_RE = /^[-•]\s+/;

/** Splits feature/raw text into paragraphs and "- "/"• "-prefixed bullet lists,
 * rendering dice/countdown spans within each line via renderRichText. */
function renderFeatureBody(container, text, retier) {
  container.innerHTML = '';
  const lines = text.split('\n');
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    renderRichText(p, para.join(' '), retier);
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
        renderBulletBody(li, lines[i].trim().replace(BULLET_LINE_RE, ''), retier);
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

/* The harvesting features list what the party can find as bare bullets, and each
 * of those names an entry in the loot catalogue. The name has to stand alone —
 * either as the whole bullet, or as the label before a colon or dash — so a
 * bullet that merely mentions an item in passing stays prose. */
const BULLET_LABEL_RE = /^([^:—–]+?)\s*([:—–])\s*(.+)$/;

function renderBulletBody(li, text, retier) {
  let id = itemIdFor(text);
  let label = text;
  let sep = '';
  let rest = '';
  if (!id) {
    const m = text.match(BULLET_LABEL_RE);
    const headId = m && itemIdFor(m[1]);
    if (headId) { id = headId; label = m[1]; sep = m[2]; rest = m[3]; }
  }
  if (!id) { renderRichText(li, text, retier); return; }
  li.className = 'has-item';
  li.appendChild(makeItemButton(id, label));
  if (rest) {
    li.appendChild(document.createTextNode(` ${sep} `));
    const tail = document.createElement('span');
    renderRichText(tail, rest, retier);
    li.appendChild(tail);
  }
}

function makeItemButton(id, label) {
  const btn = document.createElement('button');
  btn.className = 'item-btn';
  btn.type = 'button';
  btn.dataset.tip = t('open_item');
  btn.innerHTML = `${itemIconSVG()}<span>${escapeHtml(label)}</span>`;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    openItemDetail(id);
  });
  return btn;
}

function itemIconSVG() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M9.5 3v5.4L5.4 16.6A2.6 2.6 0 0 0 7.7 20.5h8.6a2.6 2.6 0 0 0 2.3-3.9L14.5 8.4V3" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8.4 3h7.2M7.6 13.4h8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
}

function makeDiceButton(count, sides, mod, label, originalLabel) {
  const btn = document.createElement('button');
  btn.className = originalLabel ? 'dice-btn dice-btn-retiered' : 'dice-btn';
  btn.type = 'button';
  if (originalLabel) btn.dataset.tip = t('retier_original').replace('{v}', originalLabel);
  btn.innerHTML = `${diceIconSVG()}<span>${label}</span>`;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    rollDice(btn, count, sides, mod, label);
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
  panel._btn = btn;

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

function rollDice(btn, count, sides, mod, label) {
  const rolls = Array.from({ length: count }, () => 1 + Math.floor(Math.random() * sides));
  const total = rolls.reduce((a, b) => a + b, 0) + mod;
  showDiceResultPop(btn, label, rolls, mod, total);
}

function showDiceResultPop(btn, label, rolls, mod, total) {
  const rect = btn.getBoundingClientRect();
  const pop = document.createElement('div');
  pop.className = 'dice-result-pop';
  pop.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - 110)) + 'px';
  pop.style.top = (rect.bottom + 8) + 'px';
  pop.innerHTML = `<div class="notation">${label}</div><div class="value">${total}</div>`;
  if (rolls.length > 1 || mod) {
    const bd = document.createElement('div');
    bd.className = 'breakdown';
    let expr = rolls.join(' + ');
    if (mod) expr += (mod < 0 ? ' − ' : ' + ') + Math.abs(mod);
    bd.textContent = `${expr} = ${total}`;
    pop.appendChild(bd);
  }
  document.body.appendChild(pop);
  pop.addEventListener('click', () => pop.remove());
  setTimeout(() => pop.remove(), 2600);
}

/* ---------------- utils ---------------- */

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

init();
