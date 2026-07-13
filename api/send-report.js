const https = require('https');

module.exports.config = { maxDuration: 60 };

// ── Llamar al propio endpoint /api/jira del dashboard ──────
function callJiraInternal(host, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      hostname: host,
      path: '/api/jira',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Enviar email via Resend ────────────────────────────────
function sendEmail(apiKey, to, subject, html) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ from: 'PMO Efletexia <onboarding@resend.dev>', to, subject, html });
    const opts = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Semana actual ──────────────────────────────────────────
function getWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = d => d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  const iso = d => d.toISOString().slice(0,10);
  return { desde: iso(monday), hasta: iso(sunday), label: `${fmt(monday)} al ${fmt(sunday)}` };
}

// ── Semáforo ───────────────────────────────────────────────
function getSemaforo(e) {
  const s = (e.status||'').toLowerCase();
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = e.duedate ? new Date(e.duedate+'T12:00:00') : null;
  if (s === 'stand by')                          return { dot:'#F5B800', label:'Stand By' };
  if (!fin)                                      return { dot:'#6b7280', label:e.status };
  if (s === 'producción' || s === 'produccion')  return { dot:'#3B82F6', label:'Producción' };
  if (fin < hoy)                                 return { dot:'#ef4444', label:'Vencido' };
  if (e.replanificacion)                         return { dot:'#F5B800', label:'Replanificado' };
  return                                                { dot:'#4ade80', label:'En plazo' };
}

// ── Construir HTML del correo ──────────────────────────────
function buildHtml(epics, weekLabel) {
  const EXCLUIR = ['backlog','desestimado','stand by','standby','planificado'];
  const { desde, hasta } = getWeekRange();

  const active = epics.filter(e => !EXCLUIR.includes((e.status||'').toLowerCase()) && e.duedate);
  const total    = active.length;
  const enPlazo  = active.filter(e => getSemaforo(e).label === 'En plazo').length;
  const prod     = active.filter(e => getSemaforo(e).label === 'Producción').length;
  const replanN  = active.filter(e => getSemaforo(e).label === 'Replanificado').length;
  const vencidos = active.filter(e => getSemaforo(e).label === 'Vencido').length;
  const cumpl    = total > 0 ? Math.round((enPlazo + prod) / total * 100) : 0;
  const cumplColor = cumpl >= 70 ? '#4ade80' : cumpl >= 50 ? '#F5B800' : '#ef4444';
  const standby  = epics.filter(e => (e.status||'').toLowerCase() === 'stand by').length;
  const backlog  = epics.filter(e => (e.status||'').toLowerCase() === 'backlog').length;

  // Resumen mensual
  const COLOR_MAP = { 'En plazo':'#4ade80','Producción':'#3B82F6','Replanificado':'#F5B800','Vencido':'#ef4444','Stand By':'#F5B800' };
  const meses = {};
  active.forEach(e => {
    const d = new Date(e.duedate+'T12:00:00');
    const key = d.toLocaleDateString('es-PE',{month:'long',year:'numeric'}).toUpperCase();
    if(!meses[key]) meses[key] = [];
    meses[key].push(e);
  });
  const resumenHtml = Object.entries(meses).sort(([a],[b])=>a.localeCompare(b)).map(([mes,items])=>{
    const dots = items.map(e=>{
      const c = COLOR_MAP[getSemaforo(e).label]||'#6b7280';
      return `<span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:${c};margin-right:2px;vertical-align:middle"></span>`;
    }).join('');
    return `<tr><td style="padding:4px 12px 4px 0;font-size:11px;color:#64748b;white-space:nowrap">${mes}</td><td style="padding:4px 0">${dots}<span style="font-size:11px;color:#64748b;margin-left:4px">${items.length}</span></td></tr>`;
  }).join('');

  // Entregables de la semana
  const entregables = active
    .filter(e => e.duedate >= desde && e.duedate <= hasta)
    .sort((a,b)=>a.duedate.localeCompare(b.duedate));

  const rows = entregables.map(e => {
    const sem = getSemaforo(e);
    const plan = e.planPct != null ? e.planPct+'%' : '—';
    const real = e.realPct != null ? e.realPct+'%' : '—';
    const fin  = new Date(e.duedate+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
    return `<tr style="border-bottom:1px solid #1e2d40">
      <td style="padding:8px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${sem.dot}"></span></td>
      <td style="padding:8px;font-size:11px"><a href="https://efletexia.atlassian.net/browse/${e.key}" style="color:#60a5fa;text-decoration:none;font-weight:600">${e.codigo||e.key}</a></td>
      <td style="padding:8px;color:#e2e8f0;font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.summary}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${e.sponsor||'—'}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${plan} / ${real}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${fin}</td>
      <td style="padding:8px"><span style="background:${sem.dot}22;color:${sem.dot};padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600">${e.status}</span></td>
    </tr>`;
  }).join('');

  const emptyRow = `<tr><td colspan="7" style="padding:20px;text-align:center;color:#475569;font-size:12px">Sin entregables con fecha fin esta semana</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:820px;margin:0 auto;padding:20px 16px">
  <div style="padding:10px 0 10px;border-bottom:1px solid #1e2d40;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
    <div style="font-size:11px;color:#475569">PMO Dashboard — Efletexia &nbsp;&#8594;&nbsp; Entregables</div>
    <div style="font-size:11px;color:#475569">Semana: ${weekLabel}</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr style="vertical-align:top">
    <td style="width:58%;padding-right:20px">
      <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Resumen mensual de entregables</div>
      <table style="border-collapse:collapse">${resumenHtml}</table>
    </td>
    <td style="width:42%;background:#131c2b;border-radius:8px;padding:16px 18px">
      <div style="font-size:10px;color:#3B82F6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">&#9646; Indicadores del portafolio</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td style="padding:5px 0;color:#94a3b8">&#9679; Total entregables</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${total}</td></tr>
        <tr><td style="padding:5px 0;color:#4ade80">&#9679; En plazo</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${enPlazo} <span style="color:#475569;font-weight:400">${total>0?Math.round(enPlazo/total*100):0}%</span></td></tr>
        <tr><td style="padding:5px 0;color:#3B82F6">&#9679; Producción</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${prod} <span style="color:#475569;font-weight:400">${total>0?Math.round(prod/total*100):0}%</span></td></tr>
        <tr><td style="padding:5px 0;color:#F5B800">&#9679; Replanificados</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${replanN} <span style="color:#475569;font-weight:400">${total>0?Math.round(replanN/total*100):0}%</span></td></tr>
        <tr><td style="padding:5px 0;color:#ef4444">&#9679; Vencidos</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${vencidos} <span style="color:#475569;font-weight:400">${total>0?Math.round(vencidos/total*100):0}%</span></td></tr>
        <tr><td style="padding:5px 0;color:#F5B800">&#9888; Proyectos con Bloqueantes</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${standby}</td></tr>
        <tr><td style="padding:5px 0;color:#64748b">&#9744; Backlog</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${backlog}</td></tr>
      </table>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid #1e2d40;text-align:center">
        <div style="font-size:10px;color:#64748b;margin-bottom:4px">Cumplimiento General</div>
        <div style="font-size:30px;font-weight:700;color:${cumplColor}">${cumpl}%</div>
      </div>
    </td>
  </tr></table>
  <div style="background:#131c2b;border-radius:8px;overflow:hidden;margin-bottom:14px">
    <div style="padding:11px 16px;border-bottom:1px solid #1e2d40">
      <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Entregables · semana ${weekLabel}</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#0d1117">
        <th style="padding:7px 8px;width:18px"></th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Cód.</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Proyecto</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Sponsor</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Plan/Real</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Fecha fin</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;font-weight:500;text-transform:uppercase">Estado</th>
      </tr></thead>
      <tbody>${rows || emptyRow}</tbody>
    </table>
  </div>
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:6px 0">
    <div style="display:flex;gap:14px;font-size:11px;color:#475569">
      <span><span style="color:#ef4444">&#9679;</span> Vencido</span>
      <span><span style="color:#F5B800">&#9679;</span> Replanificado</span>
      <span><span style="color:#4ade80">&#9679;</span> En plazo</span>
      <span><span style="color:#3B82F6">&#9679;</span> Producción</span>
    </div>
    <a href="https://pmo-efletexia.vercel.app" style="font-size:11px;color:#3B82F6;text-decoration:none">Ver dashboard &#8594;</a>
  </div>
</div></body></html>`;
}

// ── Handler ────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const host = req.headers.host || 'pmo-efletexia.vercel.app';

    // Usar el endpoint /api/jira que ya existe y funciona rápido
    const data = await callJiraInternal(host, { type: 'epics' });
    const epics = (data.issues || []).map(i => {
      const f = i.fields || {};
      const planPct = f.customfield_10725 != null ? Math.round(f.customfield_10725 * 100) : null;
      const realPct = f.customfield_10726 != null ? Math.round(f.customfield_10726 * 100) : null;
      const replanRaw = f.customfield_11269;
      const replanificacion = replanRaw ? (typeof replanRaw === 'object'
        ? (replanRaw.content||[]).flatMap(p=>(p.content||[]).map(c=>c.text||'')).join('').trim()
        : replanRaw) : null;
      return {
        key: i.key,
        codigo: f.customfield_10934 || i.key,
        summary: f.summary || '',
        status: f.status?.name || '',
        duedate: f.duedate || null,
        sponsor: f.customfield_11070?.value || '—',
        planPct, realPct, replanificacion
      };
    });

    const { label } = getWeekRange();
    const html = buildHtml(epics, label);

    const r = await sendEmail(RESEND_KEY, ['abel.alva@dtgrupo.com'],
      `📊 Reporte PMO — Semana ${label}`, html);

    console.log('Resend:', r.status, r.body);
    res.status(200).json({ ok: true, week: label, resend: r.status });
  } catch(err) {
    console.error('send-report error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
