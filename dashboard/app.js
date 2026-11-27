/* Token Launch Radar — app.js (no network, no framework) */
/* global window, document */
(function () {
  'use strict';

  const R = window.RADAR;
  if (!R) { document.body.innerHTML = '<p style="padding:40px;color:#ef4444">data.js not loaded</p>'; return; }

  // ── Utilities ──────────────────────────────────────────────────────────────
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  function fmtUsd(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toFixed(0);
  }
  function fmtPct(n) {
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtMult(n) {
    if (n == null) return '—';
    return '×' + n.toFixed(3);
  }
  function fmtAge(days) {
    if (days == null) return '—';
    if (days < 30) return days + 'd';
    if (days < 365) return Math.floor(days / 30) + 'mo';
    return (days / 365).toFixed(1) + 'yr';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Build watchlist set ────────────────────────────────────────────────────
  // watchlist slugs live in full data.js (board rows with watchlist flag)
  // We detect them by checking if tvl_usd >= floor_usd for pre-token protocols
  const FLOOR = R.floor_usd;
  const watchlistSet = new Set(R.rows.filter(r => r.tvl_usd >= FLOOR).map(r => r.slug));

  // ── Header ─────────────────────────────────────────────────────────────────
  const headerMeta = $('#header-meta');
  headerMeta.innerHTML =
    `Snapshot: <strong>${R.as_of}</strong> &nbsp;·&nbsp; ` +
    `<strong>${R.board_size}</strong> protocols ranked &nbsp;·&nbsp; ` +
    `<strong>${R.watchlist_size}</strong> on watchlist`;

  // ── Stat bar ───────────────────────────────────────────────────────────────
  const statBar = $('#stat-bar');
  const topImplied = R.rows[0] ? fmtUsd(R.rows[0].implied_value_usd) : '—';
  const topName = R.rows[0] ? esc(R.rows[0].name) : '—';
  const totalImplied = R.rows.reduce((s, r) => s + r.implied_value_usd, 0);
  statBar.innerHTML = [
    { label: 'Board rows', value: R.board_size },
    { label: 'Watchlist covered', value: R.watchlist_size + ' / ' + R.watchlist_size },
    { label: 'Early finds', value: R.early_size },
    { label: '#1 implied', value: topImplied + ' — ' + topName },
    { label: 'Total implied', value: fmtUsd(totalImplied) },
    { label: 'Model', value: R.model_version },
  ].map(s =>
    `<div class="stat-item"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`
  ).join('');

  // ── Tab switching ──────────────────────────────────────────────────────────
  $$('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.tab-btn').forEach(b => b.classList.remove('active'));
      $$('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      $('#view-' + btn.dataset.view).classList.add('active');
    });
  });

  // ── Board ──────────────────────────────────────────────────────────────────
  let sortCol = 'implied_value_usd';
  let sortAsc = false;
  let selectedSlug = null;

  const searchEl = $('#search');
  const catEl = $('#filter-category');
  const chainEl = $('#filter-chain');
  const watchlistEl = $('#filter-watchlist');
  const sortColEl = $('#sort-col');
  const sortDirEl = $('#sort-dir');

  // Populate category filter
  const cats = [...new Set(R.rows.map(r => r.category).filter(Boolean))].sort();
  cats.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; catEl.appendChild(o); });

  // Populate chain filter
  const chains = [...new Set(R.rows.flatMap(r => r.chains))].sort();
  chains.forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; chainEl.appendChild(o); });

  function getFiltered() {
    const q = searchEl.value.trim().toLowerCase();
    const cat = catEl.value;
    const chain = chainEl.value;
    const wlOnly = watchlistEl.checked;
    return R.rows.filter(r =>
      (!q || r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q)) &&
      (!cat || r.category === cat) &&
      (!chain || r.chains.includes(chain)) &&
      (!wlOnly || watchlistSet.has(r.slug))
    );
  }

  function getSorted(rows) {
    const col = sortCol;
    return [...rows].sort((a, b) => {
      let va = a[col], vb = b[col];
      if (va == null) va = sortAsc ? Infinity : -Infinity;
      if (vb == null) vb = sortAsc ? Infinity : -Infinity;
      return sortAsc ? va - vb : vb - va;
    });
  }

  function renderBoard() {
    const rows = getSorted(getFiltered());
    const tbody = $('#board-body');
    if (rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="empty-state">No protocols match your filters.</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(r => {
      const isWL = watchlistSet.has(r.slug);
      const chainPills = r.chains.slice(0, 3).map(c =>
        `<span class="chain-pill">${esc(c)}</span>`
      ).join('') + (r.chains.length > 3 ? `<span class="chain-more">+${r.chains.length - 3}</span>` : '');
      const changeClass = r.change_7d > 0 ? 'change-pos' : r.change_7d < 0 ? 'change-neg' : '';
      const isSelected = r.slug === selectedSlug;
      return `<tr data-slug="${esc(r.slug)}" class="${isSelected ? 'selected' : ''}">
        <td class="col-rank">${r.rank}</td>
        <td class="col-name">
          <div class="name-wrap">
            ${isWL ? '<span class="watchlist-dot" title="Watchlist"></span>' : ''}
            <div>
              <div>${esc(r.name)}</div>
              <div class="slug">${esc(r.slug)}</div>
            </div>
          </div>
        </td>
        <td class="col-cat">${r.category ? `<span class="cat-badge">${esc(r.category)}</span>` : '—'}</td>
        <td class="col-chains"><div class="chain-list">${chainPills}</div></td>
        <td class="col-tvl fmt-usd">${fmtUsd(r.tvl_usd)}</td>
        <td class="col-change"><span class="${changeClass}">${fmtPct(r.change_7d)}</span></td>
        <td class="col-implied"><span class="implied-val fmt-usd">${fmtUsd(r.implied_value_usd)}</span></td>
        <td class="col-action"><button class="detail-btn" data-slug="${esc(r.slug)}">Detail →</button></td>
      </tr>`;
    }).join('');
  }

  // ── Detail panel ───────────────────────────────────────────────────────────
  // Load full board.json farm steps
  let boardJson = null;
  function ensureBoardJson(cb) {
    if (boardJson) { cb(boardJson); return; }
    // board.json is in /output alongside this page — load it via fetch-equivalent
    // Since we're offline, board.json is adjacent to index.html
    const xhr = new XMLHttpRequest();
    xhr.open('GET', '../board.json');
    xhr.onload = () => {
      try { boardJson = JSON.parse(xhr.responseText); } catch(e) { boardJson = { rows: [] }; }
      cb(boardJson);
    };
    xhr.onerror = () => { boardJson = { rows: [] }; cb(boardJson); };
    xhr.send();
  }

  function showDetail(slug) {
    selectedSlug = slug;
    renderBoard();
    const row = R.rows.find(r => r.slug === slug);
    if (!row) return;
    const panel = $('#detail-panel');
    panel.classList.remove('hidden');

    const isWL = watchlistSet.has(slug);
    const mcapOverTvl = row.tvl_usd > 0 ? row.implied_value_usd / row.tvl_usd : 0;

    const baseHtml = `
      <div class="detail-header">
        <div>
          <div class="detail-name">${esc(row.name)} ${isWL ? '<span class="header-badge" style="font-size:.7rem">Watchlist</span>' : ''}</div>
          <div class="detail-slug">${esc(row.slug)} · Rank #${row.rank}</div>
        </div>
        <button class="close-btn" id="close-detail">✕</button>
      </div>
      <div class="detail-grid">
        <div class="detail-card"><div class="detail-card-label">Implied Value</div><div class="detail-card-value" style="color:var(--accent2)">${fmtUsd(row.implied_value_usd)}</div></div>
        <div class="detail-card"><div class="detail-card-label">TVL</div><div class="detail-card-value">${fmtUsd(row.tvl_usd)}</div></div>
        <div class="detail-card"><div class="detail-card-label">Implied/TVL</div><div class="detail-card-value">${fmtMult(mcapOverTvl)}</div></div>
        <div class="detail-card"><div class="detail-card-label">7-Day Change</div><div class="detail-card-value" style="color:${row.change_7d >= 0 ? 'var(--green)' : 'var(--red)'}">${fmtPct(row.change_7d)}</div></div>
        <div class="detail-card"><div class="detail-card-label">Category</div><div class="detail-card-value" style="font-size:.9rem">${row.category || '—'}</div></div>
        <div class="detail-card"><div class="detail-card-label">Age</div><div class="detail-card-value">${fmtAge(row.age_days)}</div></div>
        <div class="detail-card"><div class="detail-card-label">Chains</div><div class="detail-card-value" style="font-size:.85rem">${row.chains.join(', ') || '—'}</div></div>
      </div>
      <div class="model-breakdown">
        <h4>Model breakdown (radar-2)</h4>
        <div class="model-row"><span>Peer multiple (category median mcap/TVL)</span><span>${fmtMult(row.peer_multiple)}</span></div>
        <div class="model-row"><span>Growth multiplier (7d TVL change × 0.40)</span><span>${fmtMult(row.growth_multiplier)}</span></div>
        <div class="model-row"><span>Maturity multiplier (age curve)</span><span>${fmtMult(row.maturity_multiplier)}</span></div>
        <div class="model-row"><span>Chain diversity multiplier (${row.chains.length} chain${row.chains.length !== 1 ? 's' : ''})</span><span>${fmtMult(row.chain_multiplier)}</span></div>
        <div class="model-row" style="font-weight:700;color:var(--accent2)"><span>= Implied value</span><span>${fmtUsd(row.implied_value_usd)}</span></div>
      </div>
      <div class="farm-steps">
        <h4>7-Step Farm Plan</h4>
        <div class="step-list" id="farm-steps-${esc(slug)}"><em style="color:var(--text2)">Loading…</em></div>
      </div>`;

    panel.innerHTML = baseHtml;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    $('#close-detail').addEventListener('click', () => {
      panel.classList.add('hidden');
      selectedSlug = null;
      renderBoard();
    });

    // Load farm steps from board.json
    ensureBoardJson((bj) => {
      const fullRow = bj.rows && bj.rows.find(r => r.slug === slug);
      const stepsEl = $(`#farm-steps-${slug.replace(/[^a-z0-9]/gi, '_')}`);
      // Try a few ways to find the element
      const stepsEl2 = panel.querySelector('.step-list');
      if (!stepsEl2) return;
      if (fullRow && fullRow.farm_steps && fullRow.farm_steps.length) {
        stepsEl2.innerHTML = fullRow.farm_steps.map(s =>
          `<div class="step-item"><span class="step-text">${esc(s)}</span></div>`
        ).join('');
      } else {
        stepsEl2.innerHTML = '<em style="color:var(--text2)">Farm steps not loaded (run from /output directory)</em>';
      }
    });
  }

  // Event delegation for board rows + detail buttons
  $('#board-body').addEventListener('click', e => {
    const btn = e.target.closest('.detail-btn');
    if (btn) { showDetail(btn.dataset.slug); return; }
    const row = e.target.closest('tr[data-slug]');
    if (row) showDetail(row.dataset.slug);
  });

  // Sort column headers
  $$('thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      if (sortCol === th.dataset.col) { sortAsc = !sortAsc; }
      else { sortCol = th.dataset.col; sortAsc = false; }
      sortColEl.value = sortCol;
      sortDirEl.textContent = sortAsc ? '↑ Asc' : '↓ Desc';
      renderBoard();
    });
  });

  sortColEl.addEventListener('change', () => { sortCol = sortColEl.value; renderBoard(); });
  sortDirEl.addEventListener('click', () => { sortAsc = !sortAsc; sortDirEl.textContent = sortAsc ? '↑ Asc' : '↓ Desc'; renderBoard(); });
  searchEl.addEventListener('input', renderBoard);
  catEl.addEventListener('change', renderBoard);
  chainEl.addEventListener('change', renderBoard);
  watchlistEl.addEventListener('change', renderBoard);

  renderBoard();

  // ── Live token table ────────────────────────────────────────────────────────
  const liveBody = $('#live-body');
  liveBody.innerHTML = R.live.map((p, i) => {
    const mult = p.tvl_usd > 0 && p.mcap_usd ? p.mcap_usd / p.tvl_usd : null;
    const changeClass = p.change_7d > 0 ? 'change-pos' : p.change_7d < 0 ? 'change-neg' : '';
    return `<tr>
      <td>${i + 1}</td>
      <td><div>${esc(p.name)}</div><div class="slug">${esc(p.slug)}</div></td>
      <td>${p.category ? `<span class="cat-badge">${esc(p.category)}</span>` : '—'}</td>
      <td class="fmt-usd">${fmtUsd(p.tvl_usd)}</td>
      <td class="fmt-usd">${fmtUsd(p.mcap_usd)}</td>
      <td>${mult != null ? '×' + mult.toFixed(2) : '—'}</td>
      <td><span class="${changeClass}">${fmtPct(p.change_7d)}</span></td>
    </tr>`;
  }).join('');

  // ── About — multiples table ─────────────────────────────────────────────────
  const MULTIPLES = {
    'Dexs': 0.342, 'Lending': 0.132, 'RWA': 0.275, 'Yield': 0.191,
    'Basis Trading': 0.654, 'Yield Aggregator': 0.252, 'Cross Chain Bridge': 2.205,
    'Indexes': 0.148, 'CDP': 0.169, 'Privacy': 0.969, 'Staking Pool': 0.003,
    'Token Locker': 18.976, 'Derivatives': 2.947, 'Payments': 0.223,
    'AI Agents': 0.888, 'Restaking': 0.032, 'Onchain Capital Allocator': 0.019,
    'Collateral Management': 12.160, 'Prediction Market': 20.000,
    'Decentralized AI': 2.060, 'NFT Marketplace': 2.002, 'Options': 1.515,
    'Chain': 3.026, 'Risk Curators': 2.975,
  };
  const aboutTable = $('#about-multiples');
  aboutTable.innerHTML =
    `<thead><tr><th>Category</th><th>Peer multiple (median mcap/TVL)</th></tr></thead>` +
    `<tbody>` +
    Object.entries(MULTIPLES).sort((a, b) => b[1] - a[1]).map(([cat, mult]) =>
      `<tr><td>${esc(cat)}</td><td>${mult.toFixed(3)}×</td></tr>`
    ).join('') +
    `</tbody>`;

  $('#about-early-count').textContent = R.early_size;

})();
