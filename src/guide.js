const CATEGORY_LABELS = {
  landmark: 'Landmarks', heritage: 'Heritage', temple: 'Temples', gurudwara: 'Gurdwaras',
  religious: 'Places of worship', worship: 'Places of worship', food: 'Food & cafés',
  restaurant: 'Restaurants', cafe: 'Cafés', hotel: 'Hotels', coaching: 'Coaching classes',
  college: 'Colleges & universities', school: 'Schools', education: 'Education',
  market: 'Markets', shopping: 'Shopping', shop: 'Shops', park: 'Parks & outdoors',
  hospital: 'Hospitals', health: 'Health', transport: 'Travel & transport',
  station: 'Stations', airport: 'Airports', civic: 'City life', recreation: 'Outdoors',
  cinema: 'Cinemas', bridge: 'Bridges', neighbourhood: 'Neighbourhoods', other: 'More places',
};

const CATEGORY_ICONS = {
  landmark: '◇', heritage: '◇', temple: '◇', gurudwara: '◇', religious: '◇', worship: '◇',
  restaurant: 'F', cafe: 'C', food: 'F', hotel: 'H', coaching: 'C', college: 'U', school: 'S',
  education: 'E', market: 'M', shopping: 'M', shop: 'M', park: '↟', hospital: '+', health: '+',
  transport: '↗', station: '↗', airport: '↗', civic: 'N', recreation: '↟', cinema: '▷', bridge: '↔',
};

const normalize = (value) => String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const categoryLabel = (category) => CATEGORY_LABELS[category] || String(category || 'Places').replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());

// Tolerate a single mistyped letter without allowing unrelated partial matches.
function nearWord(query, word) {
  if (query.length < 4 || Math.abs(query.length - word.length) > 1) return false;
  let differences = 0;
  let a = 0;
  let b = 0;
  while (a < query.length && b < word.length) {
    if (query[a] === word[b]) { a++; b++; continue; }
    if (++differences > 1) return false;
    if (query.length <= word.length) b++;
    if (query.length >= word.length) a++;
  }
  return differences + (a < query.length || b < word.length ? 1 : 0) <= 1;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function distanceLabel(distance) {
  if (!Number.isFinite(distance)) return '';
  return distance >= 1000 ? `~${(distance / 1000).toFixed(1)} km` : `~${Math.round(distance / 10) * 10} m`;
}

/**
 * Map/directory UI only. Callbacks own gameplay and pause state.
 * getPosition can additionally return metersPerUnit for a compressed world map.
 */
export function createGuide({ places, onNavigate, onTravel, onSelect, onClose, getVisited, getPosition }) {
  const $ = (id) => document.getElementById(id);
  const overlay = $('map-overlay');
  const search = $('guide-search');
  const category = $('guide-category');
  const area = $('guide-area');
  const results = $('guide-results');
  const detail = $('guide-detail');
  const unvisited = $('guide-unvisited');
  const body = overlay.querySelector('.guide-body');
  const byId = new Map(places.map((place) => [place.id, place]));
  const searchable = new Map(places.map((place) => {
    const names = normalize([place.name, place.shortName, ...(place.aliases || [])].join(' '));
    const text = normalize([names, place.area, place.address, categoryLabel(place.category)].join(' '));
    return [place.id, { names, text, words: text.split(' ') }];
  }));
  let selectedId = null;
  let onlyUnvisited = false;
  let returnFocus = null;
  let lastRenderKey = '';
  let focusFrame = 0;

  document.querySelectorAll('[data-place-total]').forEach((node) => { node.textContent = String(places.length); });
  $('start-guide').disabled = false;

  function populateSelect(select, values, label) {
    const first = select.options[0];
    select.replaceChildren(first);
    values.forEach((value) => {
      const option = element('option', '', label(value));
      option.value = value;
      select.append(option);
    });
  }

  populateSelect(category, [...new Set(places.map((place) => place.category).filter(Boolean))].sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b))), categoryLabel);
  populateSelect(area, [...new Set(places.map((place) => place.area).filter(Boolean))].sort((a, b) => a.localeCompare(b)), (value) => value);

  function setView(view) {
    body.dataset.view = view;
    $('guide-show-places').setAttribute('aria-pressed', String(view === 'places'));
    $('guide-show-map').setAttribute('aria-pressed', String(view === 'map'));
  }

  function getDistance(place, position) {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return Infinity;
    const target = place.approach || place;
    return Math.hypot(target.x - position.x, target.z - position.z) * (position.metersPerUnit || 1);
  }

  function searchScore(place, tokens, query) {
    if (!tokens.length) return 1;
    const record = searchable.get(place.id);
    let score = 0;
    for (const token of tokens) {
      if (record.names.includes(token)) score += 8;
      else if (record.text.includes(token)) score += 3;
      else if (record.words.some((word) => nearWord(token, word))) score += 1;
      else return 0;
    }
    if (record.names.startsWith(query)) score += 12;
    return score;
  }

  function resetFilters() {
    search.value = '';
    category.value = '';
    area.value = '';
    onlyUnvisited = false;
    unvisited.setAttribute('aria-pressed', 'false');
  }

  function renderDetail(visited) {
    const place = byId.get(selectedId);
    const changed = detail.dataset.placeId !== (place?.id || '');
    detail.dataset.placeId = place?.id || '';
    detail.replaceChildren();
    detail.hidden = !place;
    $('guide-pick-hint').hidden = Boolean(place);
    if (!place) return;

    const topline = element('div', 'guide-detail-topline');
    topline.append(element('span', '', categoryLabel(place.category)));
    if (visited.has(place.id)) topline.append(element('span', 'guide-detail-visited', '✓ Discovered'));
    detail.append(topline, element('h3', '', place.name));

    const actions = element('div', 'guide-detail-actions');
    const navigate = element('button', 'button button-primary', 'Set destination');
    navigate.type = 'button';
    navigate.append(element('span', '', '↗'));
    navigate.lastChild.setAttribute('aria-hidden', 'true');
    navigate.addEventListener('click', () => onNavigate?.(place));
    const travel = element('button', 'button button-secondary', 'Go there · free');
    travel.type = 'button';
    travel.title = 'Travel here instantly, for free';
    travel.setAttribute('aria-label', `Travel instantly to ${place.shortName || place.name}, for free`);
    travel.append(element('span', '', '→'));
    travel.lastChild.setAttribute('aria-hidden', 'true');
    travel.addEventListener('click', () => onTravel?.(place));
    actions.append(navigate, travel);
    detail.append(actions);
    if (place.localDetail) detail.append(element('p', '', place.localDetail));
    if (place.address || place.area) detail.append(element('p', 'guide-place-address', place.address || place.area));
    detail.append(element('p', 'guide-location-note', place.locationPrecision === 'area'
      ? `Placed in the ${place.area || 'local'} neighbourhood. Building and exact position are illustrated.`
      : 'Based on a map location. The building and its entrance are illustrated.'));

    if (place.sourceUrl && /^https?:\/\//i.test(place.sourceUrl)) {
      const source = element('div', 'guide-source');
      source.append(element('span', '', place.confidence === 'directory' ? 'Listed by' : 'Source'));
      const link = element('a', '', place.sourceTitle || 'Place reference');
      link.href = place.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      source.append(link);
      detail.append(source);
    }
    if (changed) detail.scrollTop = 0;
  }

  function render(force = false) {
    const visited = getVisited?.() || new Set();
    const position = getPosition?.();
    const query = normalize(search.value);
    const renderKey = [query, category.value, area.value, onlyUnvisited, selectedId, [...visited].sort().join(','), Math.round((position?.x || 0) / 25), Math.round((position?.z || 0) / 25)].join('|');
    if (!force && renderKey === lastRenderKey) return;
    lastRenderKey = renderKey;
    const tokens = query.split(' ').filter(Boolean);
    const matches = places.map((place) => ({ place, score: searchScore(place, tokens, query), distance: getDistance(place, position) }))
      .filter(({ place, score }) => score > 0 && (!category.value || place.category === category.value)
        && (!area.value || place.area === area.value) && (!onlyUnvisited || !visited.has(place.id)))
      .sort((a, b) => b.score - a.score || a.distance - b.distance || a.place.name.localeCompare(b.place.name));

    const discovered = places.reduce((total, place) => total + (visited.has(place.id) ? 1 : 0), 0);
    $('guide-visited-summary').textContent = `${discovered} of ${places.length} discovered`;
    $('guide-result-count').textContent = matches.length === places.length ? `${places.length} places` : `${matches.length} of ${places.length} places`;
    $('guide-clear-search').hidden = !search.value;
    const scroll = results.scrollTop;
    const focusedId = document.activeElement?.closest?.('[data-place-id]')?.dataset.placeId;
    const fragment = document.createDocumentFragment();

    for (const { place, distance } of matches) {
      const button = element('button', 'guide-place');
      button.type = 'button';
      button.dataset.placeId = place.id;
      button.setAttribute('aria-pressed', String(place.id === selectedId));
      button.setAttribute('aria-label', `${place.name}, ${place.area || categoryLabel(place.category)}${visited.has(place.id) ? ', discovered' : ''}`);
      const icon = element('span', 'guide-place-icon', CATEGORY_ICONS[place.category] || '◇');
      icon.setAttribute('aria-hidden', 'true');
      const copy = element('span', 'guide-place-copy');
      copy.append(element('strong', '', place.shortName || place.name), element('span', '', `${place.area || 'Nanded'} · ${categoryLabel(place.category)}`));
      const distanceNode = element('span', 'guide-place-distance', distanceLabel(distance));
      if (visited.has(place.id)) distanceNode.append(element('span', 'guide-visited-tick', '✓ Seen'));
      button.append(icon, copy, distanceNode);
      fragment.append(button);
    }

    if (!matches.length) {
      const empty = element('div', 'guide-empty');
      empty.append(element('strong', '', onlyUnvisited && discovered === places.length ? 'You know this city.' : 'Try another turn.'),
        element('span', '', onlyUnvisited && discovered === places.length ? 'Every place in this guide is discovered.' : 'No matches here. Try a shorter name or a different neighbourhood.'));
      const reset = element('button', '', 'Show all places');
      reset.type = 'button';
      reset.addEventListener('click', () => { resetFilters(); render(true); search.focus(); });
      empty.append(reset);
      fragment.append(empty);
    }
    results.replaceChildren(fragment);
    results.scrollTop = scroll;
    if (focusedId) [...results.querySelectorAll('[data-place-id]')].find((button) => button.dataset.placeId === focusedId)?.focus({ preventScroll: true });
    renderDetail(visited);
  }

  function updateFilter() {
    results.scrollTop = 0;
    render(true);
  }
  search.addEventListener('input', updateFilter);
  category.addEventListener('change', updateFilter);
  area.addEventListener('change', updateFilter);
  unvisited.addEventListener('click', () => { onlyUnvisited = !onlyUnvisited; unvisited.setAttribute('aria-pressed', String(onlyUnvisited)); updateFilter(); });
  $('guide-clear-search').addEventListener('click', () => { search.value = ''; updateFilter(); search.focus(); });
  $('map-close').addEventListener('click', () => onClose?.());
  $('guide-show-places').addEventListener('click', () => setView('places'));
  $('guide-show-map').addEventListener('click', () => { setView('map'); const place = byId.get(selectedId); if (place) onSelect?.(place); });
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-place-id]');
    if (!button) return;
    const place = byId.get(button.dataset.placeId);
    if (!place) return;
    selectedId = place.id;
    render(true);
    onSelect?.(place);
  });

  overlay.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab' || overlay.hidden) return;
    const focusable = [...overlay.querySelectorAll('button:not(:disabled),input,select,a[href],canvas[tabindex]')]
      .filter((node) => node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  return {
    get selectedId() { return selectedId; },
    open() {
      returnFocus = document.activeElement;
      overlay.hidden = false;
      selectedId = null;
      resetFilters();
      setView('places');
      results.scrollTop = 0;
      render(true);
      cancelAnimationFrame(focusFrame);
      // Avoid covering the mobile directory with the software keyboard on opening.
      focusFrame = requestAnimationFrame(() => {
        if (overlay.hidden) return;
        (matchMedia('(pointer:coarse)').matches ? $('map-close') : search).focus({ preventScroll: true });
      });
    },
    close() {
      cancelAnimationFrame(focusFrame);
      overlay.hidden = true;
      selectedId = null;
      resetFilters();
      lastRenderKey = '';
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
      else $('game-canvas')?.focus({ preventScroll: true });
    },
    refresh() { if (!overlay.hidden) render(); },
    select(id) {
      const place = byId.get(id);
      if (!place) return false;
      selectedId = id;
      resetFilters();
      setView('places');
      render(true);
      const selectedRow = [...results.querySelectorAll('[data-place-id]')].find((button) => button.dataset.placeId === id);
      selectedRow?.scrollIntoView({ block: 'nearest' });
      selectedRow?.focus({ preventScroll: true });
      onSelect?.(place);
      return true;
    },
  };
}
