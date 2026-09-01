/* ===========================================================
   PESTAÑA COSTOS — Dashboard PMO Efletexia
   Lee public/data/presupuestos.json (job nocturno desde Drive).
   Se auto-registra en la pestaña data-tab="costos". No toca app.js.
   =========================================================== */
(function () {
  const RUTA_JSON = '/data/presupuestos.json';

  let DATA = null, JIRA = {}, cargado = false;
  let USD = false, TC = 3.75;
  let filtro = { estado: '', area: '' };
  let sortK = 'total', sortDir = -1;

  /* ---------- estilos, alcanzados a #panel-costos ---------- */
  const CSS = `
#panel-costos .cos-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;
  justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border)}
#panel-costos .cos-title{font-size:15px;font-weight:700;color:var(--text-primary)}
#panel-costos .cos-meta{font-size:11px;color:var(--text-muted);margin-top:2px}
#panel-costos .cos-ctrl{display:flex;gap:8px;flex-wrap:wrap}
#panel-costos select,#panel-costos button.cos-tg{background:var(--bg-elevated);
  color:var(--text-primary);border:1px solid var(--border);border-radius:6px;
  padding:6px 10px;font-family:var(--font);font-size:12px;cursor:pointer}
#panel-costos button.cos-tg[aria-pressed="true"]{border-color:var(--blue);color:var(--blue)}
#panel-costos .cos-msg{margin:14px 20px 0;padding:11px 14px;border-radius:6px;font-size:12px;
  background:var(--bg-surface);border:1px solid var(--border);
  border-left:2px solid var(--yellow);color:var(--text-muted)}
#panel-costos .cos-msg.err{border-left-color:var(--red)}
#panel-costos .cos-msg b{color:var(--text-primary)}
#panel-costos .cos-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  background:var(--border);gap:1px;border-bottom:1px solid var(--border)}
#panel-costos .cos-kpi{background:var(--bg-surface);padding:14px 18px;border-left:2px solid transparent}
#panel-costos .cos-kpi-lab{font-size:10px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--text-muted);margin-bottom:5px}
#panel-costos .cos-kpi-val{font-family:var(--font-mono);font-size:19px;font-weight:700}
#panel-costos .cos-kpi-note{font-size:11px;color:var(--text-dim);margin-top:1px}
#panel-costos .cos-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:1px;
  background:var(--border);border-bottom:1px solid var(--border)}
@media(max-width:980px){#panel-costos .cos-grid{grid-template-columns:1fr}}
#panel-costos .cos-card{background:var(--bg-surface);padding:18px 20px}
#panel-costos .cos-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--text-muted);font-weight:700}
#panel-costos .cos-sub{font-size:11.5px;color:var(--text-dim);margin:4px 0 14px;max-width:56ch;line-height:1.5}
#panel-costos svg{width:100%;height:auto;display:block;overflow:visible}
#panel-costos .cos-leg{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;
  font-size:11px;color:var(--text-muted)}
#panel-costos .cos-leg i{display:inline-block;width:13px;height:2.5px;border-radius:2px;
  margin-right:5px;vertical-align:middle}
#panel-costos .cos-bar{margin-bottom:10px}
#panel-costos .cos-bar-top{display:flex;justify-content:space-between;gap:10px;
  font-size:12px;margin-bottom:4px;color:var(--text-primary)}
#panel-costos .cos-bar-top span:last-child{font-family:var(--font-mono);
  color:var(--text-muted);font-size:11px;flex:none}
#panel-costos .cos-track{height:6px;background:var(--bg-elevated);border-radius:3px;overflow:hidden}
#panel-costos .cos-track i{display:block;height:100%;border-radius:3px}
#panel-costos .cos-blk{font-size:10px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--text-dim);margin:14px 0 9px;font-weight:700}
#panel-costos .cos-tbl{padding:18px 20px}
#panel-costos .cos-tbl-wrap{max-height:420px;overflow:auto;border:1px solid var(--border);border-radius:6px}
#panel-costos table{width:100%;border-collapse:collapse;font-size:12px}
#panel-costos thead th{position:sticky;top:0;background:var(--bg-elevated);text-align:left;
  padding:9px 11px;font-size:10px;letter-spacing:.5px;text-transform:uppercase;
  color:var(--text-muted);border-bottom:1px solid var(--border);cursor:pointer;
  white-space:nowrap;user-select:none}
#panel-costos thead th:hover{color:var(--text-primary)}
#panel-costos thead th.n,#panel-costos tbody td.n{text-align:right;font-family:var(--font-mono)}
#panel-costos tbody td{padding:8px 11px;border-bottom:1px solid var(--border-light);
  white-space:nowrap;color:var(--text-primary)}
#panel-costos tbody tr:hover{background:var(--bg-elevated)}
#panel-costos .cos-key{font-family:var(--font-mono);font-size:11px}
#panel-costos .cos-key a{color:var(--blue);text-decoration:none}
#panel-costos .cos-key a:hover{text-decoration:underline}
#panel-costos .cos-name{max-width:230px;overflow:hidden;text-overflow:ellipsis;display:block}
#panel-costos .cos-pill{display:inline-block;padding:2px 7px;border-radius:4px;font-size:10px;
  background:var(--bg-elevated);color:var(--text-muted);border:1px solid var(--border)}
#panel-costos .cos-dot{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:6px}
#panel-costos .cos-pos{color:var(--green)} #panel-costos .cos-neg{color:var(--red)}
#panel-costos .cos-foot{padding:14px 20px;border-top:1px solid var(--border);
  font-size:11px;color:var(--text-dim);max-width:70ch;line-height:1.6}
`;

  function inyectarCSS() {
    if (document.getElementById('cos-css')) return;
    const s = document.createElement('style');
    s.id = 'cos-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---------- formato ---------- */
  const num = n => (n === null || n === undefined || isNaN(n)) ? 0 : Number(n);
  const cv = n => USD ? n / TC : n;
  const sim = () => USD ? 'US$' : 'S/';
  const full = n => sim() + ' ' + Math.round(cv(n)).toLocaleString('es-PE');
  const bare = n => Math.round(cv(n)).toLocaleString('es-PE');
  const fmt = n => {
    const v = cv(n), a = Math.abs(v);
    return sim() + ' ' + (a >= 1e6 ? (v / 1e6).toFixed(2) + 'M'
      : a >= 1000 ? Math.round(v / 1000) + 'k' : Math.round(v));
  };
  const dec = n => num(n).toFixed(2);
  const el = id => document.getElementById(id);

  /* ---------- carga ---------- */
  async function cargar() {
    if (cargado) return;
    cargado = true;
    inyectarCSS();

    try {
      const r = await fetch(RUTA_JSON, { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      DATA = await r.json();
    } catch (e) {
      el('cos-aviso').innerHTML =
        `<div class="cos-msg err"><b>No se pudo leer ${RUTA_JSON}</b> — ${e.message}.
         Revisa que el job "Presupuestos desde Drive" haya publicado el archivo.</div>`;
      el('cos-metatxt').textContent = 'sin datos';
      cargado = false;
      return;
    }

    // Metadatos desde Jira. Reutiliza allEpics si el portafolio ya cargó.
    try {
      const fuente = (typeof window.allEpics !== 'undefined' && window.allEpics) ? window.allEpics : [];
      fuente.forEach(e => {
        JIRA[e.key] = {
          estado: e.estado || e.status || '',
          area: e.area || '',
          pais: e.pais || ''
        };
      });
    } catch (e) { /* sin metadatos: no bloquea */ }

    preparar();
    render();
  }

  function preparar() {
    const ps = DATA.proyectos || [];
    if (ps.length) TC = num(ps[0].tipo_cambio) || 3.75;

    DATA.filas = ps.map(p => {
      const meta = JIRA[p.key] || {};
      return {
        key: p.key,
        nombre: p.nombre_proyecto || p.codigo_proyecto || p.key,
        estado: meta.estado || '—',
        area: meta.area || '—',
        bac: num(p.linea_base_bac),
        reservas: num(p.reserva_contingencia) + num(p.reserva_gestion),
        total: num(p.presupuesto_total),
        ac: num(p.evm_ac), pv: num(p.evm_pv), ev: num(p.evm_ev),
        cpi: num(p.evm_cpi), spi: num(p.evm_spi),
        eac: num(p.evm_eac), vac: num(p.evm_vac),
        diagnostico: p.evm_diagnostico || '',
        categorias: p.categorias || {},
        curva: p.curva_s || {},
        url: p.url || ''
      };
    });

    const opts = (id, campo) => {
      const sel = el(id);
      sel.innerHTML = `<option value="">${campo === 'estado' ? 'Todos los estados' : 'Todas las áreas'}</option>`;
      [...new Set(DATA.filas.map(f => f[campo]))].filter(v => v && v !== '—').sort()
        .forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
      sel.onchange = () => { filtro[campo] = sel.value; render(); };
    };
    opts('cos-f-estado', 'estado');
    opts('cos-f-area', 'area');

    el('cos-moneda').onclick = ev => {
      USD = !USD;
      ev.target.setAttribute('aria-pressed', USD);
      ev.target.textContent = USD ? 'Ver en S/' : 'Ver en US$';
      render();
    };

    document.querySelectorAll('#panel-costos thead th').forEach(th => th.onclick = () => {
      const k = th.dataset.k;
      sortDir = (sortK === k) ? -sortDir : -1;
      sortK = k;
      render();
    });

    const gen = new Date(DATA.generado).toLocaleString('es-PE',
      { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    el('cos-metatxt').textContent =
      `${DATA.resumen.cargados} proyectos con presupuesto · actualizado ${gen} · TC ${TC}`;

    const rech = DATA.rechazos || [];
    el('cos-aviso').innerHTML = rech.length
      ? `<div class="cos-msg"><b>${rech.length} archivo(s) no se pudieron cargar:</b><br>` +
        rech.map(r => `${r.archivo} — ${r.motivo}`).join('<br>') + `</div>`
      : '';

    el('cos-foot').textContent =
      `Fuente: plantillas Excel en Drive (9. Costos), leídas cada noche por el job automático. ` +
      `Montos en soles; la conversión usa el tipo de cambio declarado en las plantillas (${TC}). ` +
      `Estados y áreas provienen de Jira.`;
  }

  const vista = () => DATA.filas.filter(f =>
    (!filtro.estado || f.estado === filtro.estado) &&
    (!filtro.area || f.area === filtro.area));

  /* ---------- KPIs ---------- */
  function kpis(r) {
    const s = c => r.reduce((a, f) => a + f[c], 0);
    const bac = s('bac'), total = s('total'), ac = s('ac'), ev = s('ev'), pv = s('pv');
    const cpi = ac ? ev / ac : 0, spi = pv ? ev / pv : 0;
    const eac = cpi ? bac / cpi : bac, vac = bac - eac;
    const riesgo = r.filter(f => f.cpi && f.cpi < 0.95).length;
    const col = (v, u) => v >= u ? 'var(--green)' : 'var(--red)';

    const k = [
      ['Presupuesto total', fmt(total), 'línea base más reservas', 'var(--border)', 'var(--text-primary)'],
      ['Línea base (BAC)', fmt(bac), 'sin reservas', 'var(--blue)', 'var(--blue)'],
      ['Costo real (AC)', fmt(ac), bac ? Math.round(ac / bac * 100) + '% del BAC' : '—', 'var(--orange)', 'var(--orange)'],
      ['Valor ganado (EV)', fmt(ev), bac ? Math.round(ev / bac * 100) + '% avance' : '—', 'var(--green)', 'var(--green)'],
      ['CPI', dec(cpi), cpi >= 1 ? 'dentro de costo' : 'sobrecosto', col(cpi, 1), col(cpi, 1)],
      ['SPI', dec(spi), spi >= 1 ? 'en cronograma' : 'atrasado', col(spi, 1), col(spi, 1)],
      ['EAC', fmt(eac), 'estimado al cierre', 'var(--orange)', 'var(--text-primary)'],
      ['VAC', (vac < 0 ? '−' : '+') + sim() + ' ' + bare(Math.abs(vac)),
        vac < 0 ? 'desvío proyectado' : 'holgura', col(vac, 0), col(vac, 0)],
      ['En riesgo', riesgo, 'CPI bajo 0.95',
        riesgo ? 'var(--red)' : 'var(--green)', riesgo ? 'var(--red)' : 'var(--text-primary)']
    ];
    el('cos-kpis').innerHTML = k.map(([l, v, n, borde, color]) =>
      `<div class="cos-kpi" style="border-left-color:${borde}">
         <div class="cos-kpi-lab">${l}</div>
         <div class="cos-kpi-val" style="color:${color}">${v}</div>
         <div class="cos-kpi-note">${n}</div></div>`).join('');
  }

  /* ---------- curva S agregada ---------- */
  function curva(r) {
    const M = 12;
    const sumar = campo => {
      const acc = new Array(M).fill(0);
      r.forEach(f => (f.curva[campo] || []).forEach((v, i) => { if (i < M) acc[i] += num(v); }));
      return acc;
    };
    const pv = sumar('curva_pv_acum'), ac = sumar('curva_ac_acum');
    const ev = new Array(M).fill(0);
    r.forEach(f => (f.curva.curva_avance_real || []).forEach((v, i) => {
      if (i < M) ev[i] += num(v) * f.bac;
    }));

    const ultimo = ac.reduce((idx, v, i) => v > 0 ? i : idx, -1);
    const max = Math.max(...pv, ...ac, ...ev, 1);
    const W = 580, H = 240, P = { t: 14, r: 16, b: 30, l: 62 };
    const x = i => P.l + (i / (M - 1)) * (W - P.l - P.r);
    const y = v => H - P.b - (v / max) * (H - P.t - P.b);

    const linea = (serie, color, cortar) => {
      const pts = serie.map((v, i) => (cortar && i > ultimo) ? null : [x(i), y(v)]).filter(Boolean);
      if (pts.length < 2) return '';
      return `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ',' + p[1]).join('')}"
        stroke="${color}" stroke-width="2" fill="none" stroke-linejoin="round"/>`;
    };

    let g = '';
    [0, .25, .5, .75, 1].forEach(f => {
      const v = max * f;
      g += `<line x1="${P.l}" y1="${y(v)}" x2="${W - P.r}" y2="${y(v)}" stroke="var(--border)"/>
        <text x="${P.l - 8}" y="${y(v) + 4}" fill="var(--text-dim)" font-size="9.5"
        font-family="var(--font-mono)" text-anchor="end">${fmt(v)}</text>`;
    });
    for (let i = 0; i < M; i++)
      g += `<text x="${x(i)}" y="${H - P.b + 16}" fill="var(--text-dim)" font-size="9.5"
        font-family="var(--font-mono)" text-anchor="middle">${i + 1}</text>`;
    if (ultimo >= 0)
      g += `<line x1="${x(ultimo)}" y1="${P.t}" x2="${x(ultimo)}" y2="${H - P.b}"
        stroke="var(--text-muted)" stroke-dasharray="3 3"/>
        <text x="${x(ultimo) + 7}" y="${P.t + 11}" fill="var(--text-muted)" font-size="10"
        font-family="var(--font-mono)">corte</text>`;

    el('cos-curva').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"
      aria-label="Curva S del portafolio: valor planificado, valor ganado y costo real acumulados">
      ${g}${linea(pv, 'var(--blue)', false)}${linea(ev, 'var(--green)', true)}${linea(ac, 'var(--orange)', true)}
      <text x="${(P.l + W - P.r) / 2}" y="${H - 2}" fill="var(--text-dim)" font-size="9.5"
        font-family="var(--font)" text-anchor="middle">mes del proyecto</text></svg>`;
  }

  /* ---------- categorías ---------- */
  function cats(r) {
    const suma = pref => {
      const m = {};
      r.forEach(f => Object.entries(f.categorias).forEach(([k, v]) => {
        if (!k.startsWith(pref) || k.endsWith('sin_categoria')) return;
        const et = k.replace(pref, '').replace(/_/g, ' ');
        m[et] = (m[et] || 0) + num(v);
      }));
      return m;
    };
    const bloque = (titulo, m, color) => {
      const items = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
      if (!items.length) return '';
      const tot = items.reduce((s, [, v]) => s + v, 0) || 1;
      return `<div class="cos-blk">${titulo}</div>` + items.map(([k, v]) =>
        `<div class="cos-bar"><div class="cos-bar-top">
           <span>${k[0].toUpperCase() + k.slice(1)}</span>
           <span>${fmt(v)} · ${Math.round(v / tot * 100)}%</span></div>
         <div class="cos-track"><i style="width:${v / tot * 100}%;background:${color}"></i></div></div>`).join('');
    };
    const sinCat = r.reduce((a, f) =>
      a + num(f.categorias.capex_sin_categoria) + num(f.categorias.opex_sin_categoria), 0);

    el('cos-cats').innerHTML =
      bloque('Inversión inicial (CAPEX)', suma('capex_'), 'var(--orange)') +
      bloque('Costos operativos (OPEX) · mensual', suma('opex_'), 'var(--blue)') +
      (sinCat > 0 ? `<div class="cos-msg err" style="margin:14px 0 0">
        <b>${fmt(sinCat)} sin categoría.</b> Revisa la columna Categoría en las plantillas.</div>` : '');
  }

  /* ---------- tabla ---------- */
  function tabla(r) {
    const s = [...r].sort((a, b) => {
      const x = a[sortK], y = b[sortK];
      return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sortDir;
    });
    const sem = f => (!f.cpi || !f.spi) ? 'var(--text-dim)'
      : (f.cpi >= 1 && f.spi >= 1) ? 'var(--green)'
        : (f.cpi < 0.9 || f.spi < 0.9) ? 'var(--red)' : 'var(--yellow)';

    el('cos-tbody').innerHTML = s.map(f => `<tr>
      <td class="cos-key">${f.url ? `<a href="${f.url}" target="_blank" rel="noopener">${f.key}</a>` : f.key}</td>
      <td><span class="cos-name" title="${f.nombre}">${f.nombre}</span></td>
      <td><span class="cos-pill">${f.estado}</span></td>
      <td class="n">${full(f.bac)}</td>
      <td class="n" style="color:var(--text-muted)">${full(f.reservas)}</td>
      <td class="n">${full(f.total)}</td>
      <td class="n" style="color:var(--orange)">${full(f.ac)}</td>
      <td class="n ${f.cpi >= 1 ? 'cos-pos' : 'cos-neg'}">${dec(f.cpi)}</td>
      <td class="n ${f.spi >= 1 ? 'cos-pos' : 'cos-neg'}">${dec(f.spi)}</td>
      <td class="n">${full(f.eac)}</td>
      <td class="n ${f.vac >= 0 ? 'cos-pos' : 'cos-neg'}">${f.vac < 0 ? '−' : '+'}${bare(Math.abs(f.vac))}</td>
      <td><span class="cos-dot" style="background:${sem(f)}"></span>${f.diagnostico || '—'}</td>
    </tr>`).join('');
  }

  function render() {
    const r = vista();
    kpis(r); curva(r); cats(r); tabla(r);
  }

  /* ---------- registro en la pestaña ---------- */
  document.querySelectorAll('.tabs .tab').forEach(tab => {
    if (tab.dataset.tab === 'costos') tab.addEventListener('click', cargar);
  });

  window.loadCostos = cargar;   // por si quieres invocarlo desde app.js
})();
