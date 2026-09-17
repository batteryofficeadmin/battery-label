(function () {
  const params   = new URLSearchParams(window.location.search);
  const supplier = (params.get('Supplier') || '').trim();
  const brand    = (params.get('Brand')    || '').trim();
  const code     = (params.get('Code')     || '').trim();

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const heroPage   = document.getElementById('hero-page');
  const lookupPage = document.getElementById('lookup-page');

  if (supplier && brand && code) {
    lookupPage.classList.remove('hidden');
    runLookup(supplier, brand, code);
  } else {
    heroPage.classList.remove('hidden');
    initHeroSearch();
    initReveal(heroPage);
  }

  function esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function displayBrand(brand) {
    return (brand && brand.trim().toUpperCase() !== 'NO BRAND') ? brand : '';
  }

  // ── QR product-lookup page ──────────────────────────────────────
  async function runLookup(supplier, brand, code) {
    const loadingEl = document.getElementById('loading');
    const errorEl   = document.getElementById('error');
    const errorMsg  = document.getElementById('error-msg');
    const resultEl  = document.getElementById('result');

    function showError(msg) {
      loadingEl.classList.add('hidden');
      errorEl.classList.remove('hidden');
      errorMsg.textContent = msg;
    }

    // --- 1. Load sql.js and the database binary ---
    let SQL;
    try {
      SQL = await initSqlJs(window.sqlJsConfig);
    } catch (e) {
      showError('Failed to load the SQL engine: ' + e.message);
      return;
    }

    let db;
    try {
      const resp = await fetch('products.db?t=' + Date.now());
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const buf  = await resp.arrayBuffer();
      db = new SQL.Database(new Uint8Array(buf));
    } catch (e) {
      showError('Failed to load the database: ' + e.message);
      return;
    }

    // --- 2. Query ---
    const selectCols = `
        p.code,
        p.[group],
        p.chemistry,
        p.voltage,
        p.capacity,
        p.rc,
        p.ccaen,
        p.ccasae,
        p.weight,
        b.name AS brand_name,
        s.name           AS supplier_name,
        s.commercialname AS supplier_commercialname,
        s.vat            AS supplier_vat,
        s.subject        AS supplier_subject,
        s.street         AS supplier_street,
        s.city           AS supplier_city,
        s.country        AS supplier_country,
        s.telephone      AS supplier_telephone,
        s.website_url    AS supplier_website,
        s.production_code_img AS supplier_production_code_img,
        m.manufacturing_date        AS manufacturing_date,
        m.hazardous_substances      AS hazardous_substances,
        m.critical_raw_materials    AS critical_raw_materials,
        m.extinguishing_agents      AS extinguishing_agents,
        m.declaration_of_conformity AS declaration_of_conformity
      FROM Product p
      JOIN Brand       b ON p.brand_name    = b.name
      JOIN Supplier    s ON p.supplier_name = s.name
      LEFT JOIN Manufacture m ON m.supplier_name = s.name`;

    const sqlExact    = `SELECT ${selectCols} WHERE LOWER(s.name) = LOWER(?) AND LOWER(b.name) = LOWER(?) AND LOWER(REPLACE(p.code, ' ', '')) = LOWER(REPLACE(?, ' ', ''))`;
    const sqlFallback = `SELECT ${selectCols} WHERE LOWER(s.name) = LOWER(?) AND LOWER(REPLACE(p.code, ' ', '')) = LOWER(REPLACE(?, ' ', '')) LIMIT 1`;

    function runQuery(sql, queryParams) {
      const stmt = db.prepare(sql);
      stmt.bind(queryParams);
      const result = [];
      while (stmt.step()) result.push(stmt.getAsObject());
      stmt.free();
      return result;
    }

    let rows = [];
    try {
      rows = runQuery(sqlExact, [supplier, brand, code]);
      if (rows.length === 0) {
        rows = runQuery(sqlFallback, [supplier, code]);
        if (rows.length > 0) {
          // Override brand_name with the value from the URL parameter
          rows[0].brand_name = brand;
        }
      }
    } catch (e) {
      showError('Query error: ' + e.message);
      db.close();
      return;
    }
    db.close();

    loadingEl.classList.add('hidden');

    if (rows.length === 0) {
      showError(`No product found for Supplier "${supplier}", Brand "${brand}" and Code "${code}".`);
      return;
    }

    // --- 3. Render ---
    const r = rows[0];

    const num = (v, unit) => v != null && v !== ''
      ? `<span class="count" data-count="${esc(v)}">${esc(v)}</span><small>${unit}</small>`
      : '—';

    const specRows = [
      ['Category',  r.group],
      ['Chemistry', r.chemistry],
      ['Voltage',   r.voltage  != null ? r.voltage  + ' V'   : '—'],
      ['Capacity',  r.capacity != null ? r.capacity + ' Ah'  : '—'],
      ['Reserve capacity (RC)', r.rc != null ? r.rc + ' min' : '—'],
      ['CCA (EN)',  r.ccaen    != null ? r.ccaen     + ' A'   : '—'],
      ['CCA (SAE)', r.ccasae   != null ? r.ccasae    + ' A'   : '—'],
      ['Weight',    r.weight   != null ? r.weight + ' kg ± 5%' : '—'],
      [
        'Manufacturing date',
        r.manufacturing_date
          ? (r.supplier_production_code_img
              ? `${esc(r.manufacturing_date)} &middot; <a href="img/${esc(r.supplier_production_code_img)}" target="_blank" rel="noopener">See pattern</a>`
              : esc(r.manufacturing_date))
          : '—',
        true
      ],
    ];

    const specHTML = specRows.map(([label, val, isHTML]) => `
      <tr>
        <th>${esc(label)}</th>
        <td>${isHTML ? val : esc(String(val ?? '—'))}</td>
      </tr>
    `).join('');

    const websiteHTML = r.supplier_website
      ? `<a href="${esc(r.supplier_website)}" target="_blank" rel="noopener">${esc(r.supplier_website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>`
      : '—';

    const addressParts = [r.supplier_street, r.supplier_city, r.supplier_country].filter(Boolean);
    const addressHTML  = addressParts.length ? esc(addressParts.join(', ')) : '—';

    const displayedBrand = displayBrand(r.brand_name);
    const chips = [r.group, r.chemistry].filter(Boolean)
      .map(c => `<span class="product-chip">${esc(c)}</span>`).join('');

    const icon = (id) => `<svg width="18" height="18" aria-hidden="true"><use href="#${id}"/></svg>`;

    resultEl.innerHTML = `
      <div class="stagger">

        <div class="product-hero">
          <div>
            <div class="product-hero-kicker">
              ${displayedBrand ? `<span class="product-badge">${esc(displayedBrand)}</span>` : ''}
              ${chips}
            </div>
            <h1 class="product-code">${esc(r.code)}</h1>
            <p class="product-hero-sub">${icon('ico-factory')} Manufactured by ${esc(r.supplier_commercialname ?? r.supplier_name ?? '—')}</p>
          </div>
          <svg class="product-hero-art" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="2.5" y="7" width="16.5" height="12" rx="3" stroke="currentColor" stroke-width="1.2"/>
            <rect x="20" y="10.5" width="2.2" height="5" rx=".8" fill="currentColor"/>
            <path class="bolt" d="M12.6 8.6 8.9 13.6h3l-.9 4 3.8-5.2h-3l.8-3.8Z"/>
          </svg>
        </div>

        <div class="stat-tiles">
          <div class="tile tile-indigo">
            <div class="tile-icon">${icon('ico-bolt')}</div>
            <div><div class="tile-label">Voltage</div><div class="tile-value">${num(r.voltage, 'V')}</div></div>
            <span class="tile-bar"></span>
          </div>
          <div class="tile tile-cyan">
            <div class="tile-icon">${icon('ico-battery')}</div>
            <div><div class="tile-label">Capacity</div><div class="tile-value">${num(r.capacity, 'Ah')}</div></div>
            <span class="tile-bar"></span>
          </div>
          <div class="tile tile-amber">
            <div class="tile-icon">${icon('ico-gauge')}</div>
            <div><div class="tile-label">CCA (EN)</div><div class="tile-value">${num(r.ccaen, 'A')}</div></div>
            <span class="tile-bar"></span>
          </div>
          <div class="tile tile-green">
            <div class="tile-icon">${icon('ico-weight')}</div>
            <div><div class="tile-label">Weight</div><div class="tile-value">${num(r.weight, 'kg')}</div></div>
            <span class="tile-bar"></span>
          </div>
        </div>

        <div class="lookup-grid">
          <div class="lookup-col">
            <section class="info-card">
              <div class="info-card-head"><div class="info-card-icon">${icon('ico-list')}</div><h3>Specifications</h3></div>
              <div class="info-card-body">
                <table class="spec-table"><tbody>${specHTML}</tbody></table>
              </div>
            </section>

            <section class="info-card">
              <div class="info-card-head"><div class="info-card-icon amber">${icon('ico-flask')}</div><h3>Composition</h3></div>
              <div class="info-card-body">
                <dl class="dl dl-plain">
                  <div class="dl-row"><dt>Hazardous substances</dt><dd>${esc(r.hazardous_substances ?? '—')}</dd></div>
                  <div class="dl-row"><dt>Critical raw materials</dt><dd>${esc(r.critical_raw_materials ?? '—')}</dd></div>
                  <div class="dl-row"><dt>Extinguishing agents</dt><dd>${esc(r.extinguishing_agents ?? '—')}</dd></div>
                </dl>
              </div>
            </section>
          </div>

          <div class="lookup-col">
            <section class="info-card">
              <div class="info-card-head"><div class="info-card-icon cyan">${icon('ico-factory')}</div><h3>Manufacturer</h3></div>
              <div class="info-card-body">
                <dl class="dl">
                  <div class="dl-row">${icon('ico-factory')}<div><dt>Name</dt><dd>${esc(r.supplier_commercialname ?? '—')}</dd></div></div>
                  <div class="dl-row">${icon('ico-pin')}<div><dt>Address</dt><dd>${addressHTML}</dd></div></div>
                  <div class="dl-row">${icon('ico-phone')}<div><dt>Telephone</dt><dd>${r.supplier_telephone ? `<a href="tel:${esc(String(r.supplier_telephone).replace(/\s+/g, ''))}">${esc(r.supplier_telephone)}</a>` : '—'}</dd></div></div>
                  <div class="dl-row">${icon('ico-globe')}<div><dt>Website</dt><dd>${websiteHTML}</dd></div></div>
                </dl>
              </div>
            </section>

            <section class="info-card">
              <div class="info-card-head"><div class="info-card-icon green">${icon('ico-doc')}</div><h3>EU Declaration of Conformity</h3></div>
              <div class="doc-card-body">
                ${r.declaration_of_conformity
                  ? `<p>The official EU Declaration of Conformity for this battery, issued by the manufacturer.</p>
                     <a class="btn btn-primary download-btn" href="assets/${esc(r.declaration_of_conformity)}.pdf" download="${esc(r.declaration_of_conformity)}.pdf">${icon('ico-download')} Download PDF</a>`
                  : '<p>No declaration is available for this product.</p>'}
              </div>
            </section>
          </div>
        </div>

        <div class="safety-grid">
          <section class="info-card">
            <div class="info-card-head"><div class="info-card-icon red">${icon('ico-shield')}</div><h3>Safety and handling</h3></div>
            <div class="info-card-body">
              <ul class="safety-list">
                <li>Due to hydrogen gas generated from battery, handling without care can cause fire and explosion.</li>
                <li>This 12V battery is only for starting engine. Do not apply this product for other uses.</li>
                <li>Charge this battery only at well ventilated places, and avoid shorts or sparks.</li>
                <li>Refer to the instruction manual of vehicle or battery before using booster cable.</li>
                <li>Sulfuric acid may cause blindness or severe burn. In case eyes, skin, clothes or any articles are stained with acid, flush objects immediately with water. If acid being swallowed, drink plenty of water promptly.</li>
                <li>In case of accidental contact, consult a doctor immediately.</li>
                <li>Battery filled with acid (do not tilt or spill).</li>
                <li>Flammable. Do not charge near fire or sparks.</li>
                <li>Do not charge rapidly.</li>
                <li>Do not disassemble the battery.</li>
              </ul>
              <img src="img/safety.png" alt="Safety icons" class="safety-img" />
            </div>
          </section>

          <section class="info-card">
            <div class="info-card-head"><div class="info-card-icon green">${icon('ico-recycle')}</div><h3>Environment and recycling</h3></div>
            <div class="info-card-body">
              <ul class="safety-list green">
                <li>Contains Lead (Pb). Recycle properly.</li>
                <li>Do NOT dispose of with household waste.</li>
                <li>Take the battery to authorized collection or recycling centers.</li>
                <li>Follow local environmental regulations for disposal.</li>
                <li>Prevent leakage or release into the environment.</li>
              </ul>
              <img src="img/recycling.png" alt="Recycling" class="recycling-img" />
            </div>
          </section>
        </div>

      </div>
    `;

    resultEl.classList.remove('hidden');
    animateCounts(resultEl);
  }

  // ── Motion helpers ──────────────────────────────────────────────
  // Animate every .count[data-count] inside root from 0 to its value.
  function animateCounts(root) {
    const els = root.querySelectorAll('.count[data-count]');
    els.forEach((el) => {
      const raw    = String(el.dataset.count).replace(',', '.');
      const target = parseFloat(raw);
      if (!isFinite(target) || reduceMotion) { el.textContent = el.dataset.count; return; }
      const decimals = (raw.split('.')[1] || '').length;
      const duration = 1100;
      const t0 = performance.now();
      function tick(now) {
        const p = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(decimals);
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = el.dataset.count;
      }
      requestAnimationFrame(tick);
    });
  }

  // Reveal .reveal elements as they scroll into view; count up stats once visible.
  function initReveal(root) {
    const items = root.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || reduceMotion) {
      items.forEach((el) => el.classList.add('in'));
      animateCounts(root);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('in');
        animateCounts(entry.target);
        io.unobserve(entry.target);
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach((el) => io.observe(el));
  }

  // ── Hero landing page: code search ──────────────────────────────
  function initHeroSearch() {
    const form     = document.getElementById('hero-search-form');
    const input    = document.getElementById('hero-search-input');
    const btn      = document.getElementById('hero-search-btn');
    const feedback = document.getElementById('hero-search-feedback');

    function showFeedback(html, isMulti) {
      feedback.innerHTML = html;
      feedback.classList.remove('hidden');
      feedback.classList.toggle('hero-search-feedback-multi', !!isMulti);
    }

    function hideFeedback() {
      feedback.classList.add('hidden');
      feedback.innerHTML = '';
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const q = input.value.trim();
      hideFeedback();
      if (!q) return;

      btn.disabled = true;
      const btnLabel = btn.querySelector('.btn-label') || btn;
      const originalLabel = btnLabel.textContent;
      btnLabel.textContent = 'Searching…';

      try {
        const SQL  = await initSqlJs(window.sqlJsConfig);
        const resp = await fetch('products.db?t=' + Date.now());
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const buf = await resp.arrayBuffer();
        const db  = new SQL.Database(new Uint8Array(buf));

        // Split the query into a code part and, if the user typed one, a brand
        // name part — recognized by matching against the known Brand names.
        const brandStmt = db.prepare('SELECT name FROM Brand ORDER BY LENGTH(name) DESC');
        const brandNames = [];
        while (brandStmt.step()) brandNames.push(brandStmt.getAsObject().name);
        brandStmt.free();

        let brandFilter = null;
        let codeText = q;
        for (const name of brandNames) {
          const re = new RegExp('(^|\\s)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'i');
          if (re.test(q)) {
            brandFilter = name;
            codeText = q.replace(re, ' ').trim();
            break;
          }
        }

        if (!brandFilter) {
          db.close();
          showFeedback(`Please also enter the brand name printed on the label along with the code, e.g. "${esc(q)} VEGA".`, false);
          return;
        }

        const stmt = db.prepare(`
          SELECT p.code AS code, b.name AS brand_name, s.name AS supplier_name
          FROM Product p
          JOIN Brand    b ON p.brand_name    = b.name
          JOIN Supplier s ON p.supplier_name = s.name
          WHERE LOWER(REPLACE(p.code, ' ', '')) = LOWER(REPLACE(?, ' ', ''))
          AND b.name = ?
        `);
        stmt.bind([codeText, brandFilter]);
        let matches = [];
        while (stmt.step()) matches.push(stmt.getAsObject());
        stmt.free();

        // No exact (code, brand) match — fall back to the neutral/no-brand
        // spec from the supplier that actually makes this brand, if there's
        // exactly one such supplier and it has this code under "NO BRAND".
        if (matches.length === 0) {
          const supplierStmt = db.prepare('SELECT DISTINCT supplier_name FROM Product WHERE brand_name = ?');
          supplierStmt.bind([brandFilter]);
          const suppliers = [];
          while (supplierStmt.step()) suppliers.push(supplierStmt.getAsObject().supplier_name);
          supplierStmt.free();

          if (suppliers.length === 1) {
            const neutralStmt = db.prepare(`
              SELECT p.code AS code, b.name AS brand_name, s.name AS supplier_name
              FROM Product p
              JOIN Brand    b ON p.brand_name    = b.name
              JOIN Supplier s ON p.supplier_name = s.name
              WHERE LOWER(REPLACE(p.code, ' ', '')) = LOWER(REPLACE(?, ' ', ''))
              AND s.name = ?
              AND b.name = 'NO BRAND'
            `);
            neutralStmt.bind([codeText, suppliers[0]]);
            while (neutralStmt.step()) matches.push(neutralStmt.getAsObject());
            neutralStmt.free();
          }
        }

        db.close();

        if (matches.length === 0) {
          showFeedback(`No battery found for code "${esc(q)}". Double-check the code printed on the label.`, false);
        } else if (matches.length === 1) {
          const m = matches[0];
          const qs = new URLSearchParams({ Supplier: m.supplier_name, Brand: m.brand_name, Code: m.code });
          window.location.href = '?' + qs.toString();
        } else {
          const items = matches.map((m) => {
            const qs = new URLSearchParams({ Supplier: m.supplier_name, Brand: m.brand_name, Code: m.code });
            const brand = displayBrand(m.brand_name);
            const label = brand ? `${esc(brand)} &mdash; ${esc(m.code)}` : esc(m.code);
            return `<li><a href="?${qs.toString()}"><svg width="14" height="14" aria-hidden="true"><use href="#ico-arrow"/></svg>${label} (${esc(m.supplier_name)})</a></li>`;
          }).join('');
          showFeedback(`Multiple batteries match "${esc(q)}" &mdash; pick one:<ul>${items}</ul>`, true);
        }
      } catch (err) {
        showFeedback('Something went wrong while searching: ' + esc(err.message), false);
      } finally {
        btn.disabled = false;
        btnLabel.textContent = originalLabel;
      }
    });
  }
})();
