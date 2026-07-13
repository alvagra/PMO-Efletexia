const https = require('https');

// ── Una sola llamada a Jira REST ───────────────────────────
function jiraGet(auth, path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'efletexia.atlassian.net',
      path, method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' }
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
    });
    req.on('error', reject);
    req.end();
  });
}

// ── Resend ─────────────────────────────────────────────────
function sendEmail(apiKey, to, subject, html) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ from: 'PMO Efletexia <onboarding@resend.dev>', to, subject, html });
    const opts = {
      hostname: 'api.resend.com', path: '/emails', method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
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
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now); mon.setDate(now.getDate() + diff); mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const fmt = d => d.toLocaleDateString('es-PE',{day:'2-digit',month:'2-digit',year:'numeric'});
  const iso = d => d.toISOString().slice(0,10);
  return { desde: iso(mon), hasta: iso(sun), label: `${fmt(mon)} al ${fmt(sun)}` };
}

// ── ADF a texto ────────────────────────────────────────────
function adfText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const c = node.content || [];
  if (node.type === 'text') return node.text || '';
  return c.map(adfText).join('');
}

// ── Semáforo ───────────────────────────────────────────────
function dot(e) {
  const s = (e.status||'').toLowerCase();
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = e.duedate ? new Date(e.duedate+'T12:00:00') : null;
  if (!fin)                                     return '#6b7280';
  if (s==='producción'||s==='produccion')       return '#3B82F6';
  if (fin < hoy)                                return '#ef4444';
  if (e.replan)                                 return '#F5B800';
  return '#4ade80';
}

// ── HTML ───────────────────────────────────────────────────
function buildHtml(epics, weekLabel, desde, hasta) {
  const EXCL = ['backlog','desestimado','stand by','standby','planificado'];
  const active = epics.filter(e => !EXCL.includes((e.status||'').toLowerCase()) && e.duedate);
  const total = active.length;
  const byDot = c => active.filter(e => dot(e)===c).length;
  const enPlazo = byDot('#4ade80'), prod = byDot('#3B82F6');
  const replanN = byDot('#F5B800'), venc = byDot('#ef4444');
  const cumpl = total > 0 ? Math.round((enPlazo+prod)/total*100) : 0;
  const cumplColor = cumpl>=70?'#4ade80':cumpl>=50?'#F5B800':'#ef4444';
  const standby = epics.filter(e=>(e.status||'').toLowerCase()==='stand by').length;
  const backlog  = epics.filter(e=>(e.status||'').toLowerCase()==='backlog').length;

  const COLOR = {'#4ade80':'#4ade80','#3B82F6':'#3B82F6','#F5B800':'#F5B800','#ef4444':'#ef4444','#6b7280':'#6b7280'};
  const meses = {};
  active.forEach(e => {
    const k = new Date(e.duedate+'T12:00:00').toLocaleDateString('es-PE',{month:'long',year:'numeric'}).toUpperCase();
    (meses[k]=meses[k]||[]).push(e);
  });
  const resumen = Object.entries(meses).sort().map(([m,its])=>`<tr>
    <td style="padding:3px 12px 3px 0;font-size:11px;color:#64748b;white-space:nowrap">${m}</td>
    <td>${its.map(e=>`<span style="display:inline-block;width:13px;height:13px;border-radius:3px;background:${dot(e)};margin-right:2px;vertical-align:middle"></span>`).join('')}
    <span style="font-size:11px;color:#64748b;margin-left:3px">${its.length}</span></td></tr>`).join('');

  const week = active.filter(e=>e.duedate>=desde&&e.duedate<=hasta).sort((a,b)=>a.duedate.localeCompare(b.duedate));
  const rows = week.map(e=>{
    const d = dot(e);
    const plan = e.planPct!=null?e.planPct+'%':'—';
    const real = e.realPct!=null?e.realPct+'%':'—';
    const fin = new Date(e.duedate+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
    return `<tr style="border-bottom:1px solid #1e2d40">
      <td style="padding:8px"><span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${d}"></span></td>
      <td style="padding:8px;font-size:11px"><a href="https://efletexia.atlassian.net/browse/${e.key}" style="color:#60a5fa;text-decoration:none;font-weight:600">${e.codigo||e.key}</a></td>
      <td style="padding:8px;color:#e2e8f0;font-size:11px">${e.summary}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${e.sponsor||'—'}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${plan} / ${real}</td>
      <td style="padding:8px;color:#94a3b8;font-size:11px;white-space:nowrap">${fin}</td>
      <td style="padding:8px"><span style="background:${d}22;color:${d};padding:2px 6px;border-radius:3px;font-size:9px;font-weight:600">${e.status}</span></td></tr>`;
  }).join('') || `<tr><td colspan="7" style="padding:16px;text-align:center;color:#475569;font-size:12px">Sin entregables esta semana</td></tr>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#0d1117;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
<div style="max-width:800px;margin:0 auto;padding:20px 16px">
  <div style="border-bottom:1px solid #1e2d40;margin-bottom:16px;padding-bottom:10px;display:flex;justify-content:space-between">
    <span style="font-size:11px;color:#475569">PMO Dashboard — Efletexia &#8594; Entregables</span>
    <span style="font-size:11px;color:#475569">Semana: ${weekLabel}</span>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px"><tr style="vertical-align:top">
    <td style="width:55%;padding-right:20px">
      <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Resumen mensual de entregables</div>
      <table style="border-collapse:collapse">${resumen}</table>
    </td>
    <td style="background:#131c2b;border-radius:8px;padding:16px">
      <div style="font-size:10px;color:#3B82F6;text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">&#9646; Indicadores del portafolio</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <tr><td style="padding:4px 0;color:#94a3b8">&#9679; Total entregables</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${total}</td></tr>
        <tr><td style="padding:4px 0;color:#4ade80">&#9679; En plazo</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${enPlazo} <span style="color:#475569">${total?Math.round(enPlazo/total*100):0}%</span></td></tr>
        <tr><td style="padding:4px 0;color:#3B82F6">&#9679; Producción</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${prod} <span style="color:#475569">${total?Math.round(prod/total*100):0}%</span></td></tr>
        <tr><td style="padding:4px 0;color:#F5B800">&#9679; Replanificados</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${replanN} <span style="color:#475569">${total?Math.round(replanN/total*100):0}%</span></td></tr>
        <tr><td style="padding:4px 0;color:#ef4444">&#9679; Vencidos</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${venc} <span style="color:#475569">${total?Math.round(venc/total*100):0}%</span></td></tr>
        <tr><td style="padding:4px 0;color:#F5B800">&#9888; Proyectos con Bloqueantes</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${standby}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">&#9744; Backlog</td><td style="text-align:right;color:#f1f5f9;font-weight:600">${backlog}</td></tr>
      </table>
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid #1e2d40;text-align:center">
        <div style="font-size:10px;color:#64748b;margin-bottom:3px">Cumplimiento General</div>
        <div style="font-size:28px;font-weight:700;color:${cumplColor}">${cumpl}%</div>
      </div>
    </td>
  </tr></table>
  <div style="background:#131c2b;border-radius:8px;overflow:hidden;margin-bottom:12px">
    <div style="padding:10px 16px;border-bottom:1px solid #1e2d40">
      <span style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:.06em">Entregables · semana ${weekLabel}</span>
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead><tr style="background:#0d1117">
        <th style="padding:7px 8px;width:16px"></th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Cód.</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Proyecto</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Sponsor</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Plan/Real</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Fecha fin</th>
        <th style="padding:7px 8px;text-align:left;font-size:9px;color:#475569;text-transform:uppercase">Estado</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:11px;color:#475569;padding:4px 0">
    <span><span style="color:#ef4444">&#9679;</span> Vencido &nbsp;<span style="color:#F5B800">&#9679;</span> Replanificado &nbsp;<span style="color:#4ade80">&#9679;</span> En plazo &nbsp;<span style="color:#3B82F6">&#9679;</span> Producción</span>
    <a href="https://pmo-efletexia.vercel.app" style="color:#3B82F6;text-decoration:none">Ver dashboard &#8594;</a>
  </div>
</div></body></html>`;
}

// ── Handler ────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.headers['authorization'] !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const JIRA_EMAIL = process.env.JIRA_EMAIL;
    const JIRA_TOKEN = process.env.JIRA_TOKEN;
    const RESEND_KEY = process.env.RESEND_API_KEY;
    const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');

    // Una sola llamada a Jira con solo los campos mínimos
    const FIELDS = 'summary,status,duedate,customfield_10934,customfield_10725,customfield_10726,customfield_11070,customfield_11269';
    const jql = encodeURIComponent('project = PTS AND issuetype = Epic ORDER BY created ASC');
    const r = await jiraGet(auth, `/rest/api/3/search/jql?jql=${jql}&fields=${FIELDS}&maxResults=200`);

    const epics = (r.issues||[]).map(i => {
      const f = i.fields||{};
      const replanRaw = f.customfield_11269;
      const replan = replanRaw ? adfText(replanRaw).trim() : null;
      return {
        key: i.key,
        codigo: f.customfield_10934||i.key,
        summary: f.summary||'',
        status: f.status?.name||'',
        duedate: f.duedate||null,
        sponsor: f.customfield_11070?.value||'—',
        planPct: f.customfield_10725!=null ? Math.round(f.customfield_10725*100) : null,
        realPct: f.customfield_10726!=null ? Math.round(f.customfield_10726*100) : null,
        replan
      };
    });

    const { label, desde, hasta } = getWeekRange();
    const html = buildHtml(epics, label, desde, hasta);
    const mail = await sendEmail(RESEND_KEY, ['abel.alva@dtgrupo.com'], `📊 Reporte PMO — Semana ${label}`, html);

    console.log('Resend:', mail.status, mail.body);
    res.status(200).json({ ok: true, week: label, epics: epics.length, resend: mail.status });
  } catch(err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
};
