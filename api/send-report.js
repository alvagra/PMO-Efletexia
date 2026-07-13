const https = require('https');

// Extender timeout de Vercel a 60 segundos
module.exports.config = { maxDuration: 60 };

// ── Helpers ────────────────────────────────────────────────
function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function jiraGet(auth, cloud, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${cloud}.atlassian.net`, path, method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAllPages(auth, cloud, jql, fields) {
  const fieldsStr = Array.isArray(fields) ? fields.join(',') : fields;
  let all = [], nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, fields: fieldsStr, maxResults: 100 });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const r = await jiraGet(auth, cloud, `/rest/api/3/search/jql?${params}`);
    all = all.concat(r.issues || []);
    nextPageToken = r.nextPageToken || null;
  } while (nextPageToken);
  return all;
}

// ── Semana actual (lunes–domingo) ─────────────────────────
function getWeekRange() {
  const now = new Date();
  const day = now.getDay(); // 0=dom, 1=lun...
  const diffToMonday = (day === 0) ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  monday.setHours(0,0,0,0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const fmt = d => d.toLocaleDateString('es-PE', { day:'2-digit', month:'2-digit', year:'numeric' });
  const iso = d => d.toISOString().slice(0,10);
  return { desde: iso(monday), hasta: iso(sunday), label: `${fmt(monday)} al ${fmt(sunday)}` };
}

// ── Parsear épica desde fields ────────────────────────────
function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const t = node.type || '', c = node.content || [];
  if (t === 'text') return node.text || '';
  if (t === 'hardBreak') return ' ';
  return c.map(adfToText).join('');
}

function parseEpic(i) {
  const f = i.fields || {};
  const status = f.status?.name || '';
  const duedate = f.duedate || null;
  const replan = f.customfield_11269 ? adfToText(f.customfield_11269).trim() : null;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = duedate ? new Date(duedate + 'T12:00:00') : null;
  const statusLow = status.toLowerCase();

  let semaforo, semaforoColor;
  if (statusLow === 'stand by') { semaforo = '⚠️'; semaforoColor = '#F5B800'; }
  else if (!fin)                { semaforo = '⚫'; semaforoColor = '#6b7280'; }
  else if (statusLow === 'producción' || statusLow === 'produccion') { semaforo = '🔵'; semaforoColor = '#3B82F6'; }
  else if (fin < hoy)           { semaforo = '🔴'; semaforoColor = '#ef4444'; }
  else if (replan)              { semaforo = '🟡'; semaforoColor = '#F5B800'; }
  else                          { semaforo = '🟢'; semaforoColor = '#4ade80'; }

  const planPct = f.customfield_10725 != null ? Math.round(f.customfield_10725 * 100) : null;
  const realPct = f.customfield_10726 != null ? Math.round(f.customfield_10726 * 100) : null;

  return {
    key: i.key,
    codigo: f.customfield_10934 || i.key,
    summary: f.summary || '',
    status,
    duedate,
    sponsor: f.customfield_11070?.value || '—',
    area: f.customfield_10930?.value || '—',
    planPct, realPct,
    semaforo, semaforoColor,
    replan
  };
}

// ── Generar HTML del correo (diseño = pestaña Entregables) ──
function buildEmailHtml(epics, entregables, weekLabel) {
  const EXCLUIR = ['backlog','desestimado','stand by','standby','planificado'];
  const active  = epics.filter(e => !EXCLUIR.includes((e.status||'').toLowerCase()) && e.duedate);

  const total    = active.length;
  const enPlazo  = active.filter(e => e.semaforo === '🟢').length;
  const prod     = active.filter(e => e.semaforo === '🔵').length;
  const replanN  = active.filter(e => e.semaforo === '🟡').length;
  const vencidos = active.filter(e => e.semaforo === '🔴').length;
  const cumpl    = total > 0 ? Math.round((enPlazo + prod) / total * 100) : 0;
  const cumplColor = cumpl >= 70 ? '#4ade80' : cumpl >= 50 ? '#F5B800' : '#ef4444';
  const standby  = epics.filter(e => (e.status||'').toLowerCase() === 'stand by').length;
  const backlog  = epics.filter(e => (e.status||'').toLowerCase() === 'backlog').length;

  // ── Resumen mensual: agrupar por mes ──
  const COLOR_MAP = {
    '🟢': '#4ade80', '🔵': '#3B82F6', '🟡': '#F5B800',
    '🔴': '#ef4444', '⚫': '#6b7280', '⚠️': '#F5B800'
  };
  const meses = {};
  active.forEach(e => {
    const d = new Date(e.duedate + 'T12:00:00');
    const key = d.toLocaleDateString('es-PE', { month: 'long', year: 'numeric' }).toUpperCase();
    if (!meses[key]) meses[key] = [];
    meses[key].push(e);
  });
  const resumenMensualHtml = Object.entries(meses).sort(([a],[b]) => a.localeCompare(b)).map(([mes, items]) => {
    const dots = items.map(e =>
      `<span style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${COLOR_MAP[e.semaforo]||'#6b7280'};margin-right:2px;vertical-align:middle"></span>`
    ).join('');
    return `<tr>
      <td style="padding:4px 0;font-size:11px;color:#64748b;white-space:nowrap;padding-right:12px">${mes}</td>
      <td style="padding:4px 0">${dots} <span style="font-size:11px;color:#64748b;margin-left:4px">${items.length}</span></td>
    </tr>`;
  }).join('');

  // ── Tabla de entregables de la semana ──
  const rows = entregables.map(e => {
    const plan = e.planPct != null ? e.planPct + '%' : '—';
    const real = e.realPct != null ? e.realPct + '%' : '—';
    const fin  = e.duedate ? new Date(e.duedate+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    const dotColor = COLOR_MAP[e.semaforo] || '#6b7280';
    return `<tr style="border-bottom:1px solid #1e2d40">
      <td style="padding:9px 8px">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dotColor};vertical-align:middle"></span>
      </td>
      <td style="padding:9px 8px;white-space:nowrap">
        <a href="https://efletexia.atlassian.net/browse/${e.key}" style="color:#60a5fa;text-decoration:none;font-size:12px;font-weight:600">${e.codigo}</a>
      </td>
      <td style="padding:9px 8px;color:#e2e8f0;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.summary}</td>
      <td style="padding:9px 8px;color:#94a3b8;font-size:11px;white-space:nowrap">${e.sponsor}</td>
      <td style="padding:9px 8px;color:#94a3b8;font-size:11px;white-space:nowrap">${plan} / ${real}</td>
      <td style="padding:9px 8px;color:#94a3b8;font-size:11px;white-space:nowrap">${fin}</td>
      <td style="padding:9px 8px">
        <span style="background:${dotColor}22;color:${dotColor};padding:2px 7px;border-radius:3px;font-size:10px;font-weight:600;white-space:nowrap">${e.status}</span>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<div style="max-width:860px;margin:0 auto;padding:20px 16px">

  <!-- Header -->
  <div style="padding:14px 0 10px;border-bottom:1px solid #1e2d40;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between">
    <div>
      <span style="font-size:11px;color:#475569;margin-right:8px">PMO Dashboard — Efletexia</span>
      <span style="font-size:11px;color:#475569">&#8594; Entregables</span>
    </div>
    <div style="font-size:11px;color:#475569">Semana: ${weekLabel}</div>
  </div>

  <!-- Cuerpo principal: resumen izq + indicadores der -->
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <tr style="vertical-align:top">

      <!-- Resumen mensual -->
      <td style="width:60%;padding-right:20px">
        <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Resumen mensual de entregables</div>
        <table style="border-collapse:collapse">${resumenMensualHtml}</table>
      </td>

      <!-- Indicadores del portafolio -->
      <td style="width:40%;background:#131c2b;border-radius:8px;padding:16px 18px">
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
    </tr>
  </table>

  <!-- Tabla entregables de la semana -->
  <div style="background:#131c2b;border-radius:8px;overflow:hidden;margin-bottom:16px">
    <div style="padding:12px 16px;border-bottom:1px solid #1e2d40;display:flex;align-items:center;gap:8px">
      <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Entregables · semana ${weekLabel}</span>
    </div>
    <div style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;min-width:560px">
        <thead>
          <tr style="background:#0d1117">
            <th style="padding:8px;width:20px"></th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Cód.</th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Proyecto</th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Sponsor</th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Plan/Real</th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Fecha fin</th>
            <th style="padding:8px;text-align:left;font-size:10px;color:#475569;font-weight:500;text-transform:uppercase">Estado</th>
          </tr>
        </thead>
        <tbody>${rows || `<tr><td colspan="7" style="padding:20px;text-align:center;color:#475569;font-size:12px">Sin entregables con fecha fin en esta semana</td></tr>`}</tbody>
      </table>
    </div>
  </div>

  <!-- Leyenda + footer -->
  <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:8px 0">
    <div style="display:flex;gap:14px;font-size:11px;color:#475569">
      <span><span style="color:#ef4444">&#9679;</span> Vencido</span>
      <span><span style="color:#F5B800">&#9679;</span> Replanificado</span>
      <span><span style="color:#4ade80">&#9679;</span> En plazo</span>
      <span><span style="color:#3B82F6">&#9679;</span> Producción</span>
    </div>
    <div style="font-size:11px;color:#334155">
      <a href="https://pmo-efletexia.vercel.app" style="color:#3B82F6;text-decoration:none">Ver dashboard &#8594;</a>
    </div>
  </div>

</div>
</body></html>`;
}

// ── Handler principal ─────────────────────────────────────
module.exports = async (req, res) => {
  // Verificar token de seguridad para el cron
  const cronSecret = req.headers['authorization'];
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const JIRA_USER  = process.env.JIRA_USER;
    const JIRA_TOKEN = process.env.JIRA_TOKEN;
    const JIRA_CLOUD = process.env.JIRA_CLOUD || 'efletexia';
    const RESEND_KEY = process.env.RESEND_API_KEY;

    const auth = Buffer.from(`${JIRA_USER}:${JIRA_TOKEN}`).toString('base64');

    // Traer épicas de Jira
    const issues = await fetchAllPages(auth, JIRA_CLOUD,
      'project = PTS AND issuetype = Epic ORDER BY created ASC',
      ['summary','status','duedate','customfield_10934','customfield_10725','customfield_10726',
       'customfield_10930','customfield_11070','customfield_11269']
    );

    const epics = issues.map(parseEpic);
    const { label, desde, hasta } = getWeekRange();

    // Mismos filtros que pestaña Entregables
    const EXCLUIR = ['backlog','desestimado','stand by','standby','stand-by','planificado'];
    const entregables = epics
      .filter(e => {
        if (!e.duedate) return false;
        if (EXCLUIR.includes((e.status||'').toLowerCase())) return false;
        if (e.duedate < desde || e.duedate > hasta) return false;
        return true;
      })
      .sort((a,b) => a.duedate.localeCompare(b.duedate));

    const html = buildEmailHtml(epics, entregables, label);

    // Enviar con Resend
    const resendRes = await httpsPost('api.resend.com', '/emails', {
      'Authorization': `Bearer ${RESEND_KEY}`
    }, {
      from: 'PMO Efletexia <onboarding@resend.dev>',
      to: ['abel.alva@dtgrupo.com'],
      subject: `📊 Reporte PMO — Semana ${label}`,
      html
    });

    console.log('Resend response:', resendRes.status, resendRes.body);
    res.status(200).json({ ok: true, week: label, resend: resendRes.status });

  } catch (err) {
    console.error('send-report error:', err);
    res.status(500).json({ error: err.message });
  }
};
