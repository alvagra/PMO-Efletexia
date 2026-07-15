// ═══════════════════════════════════════════════════════════
//  PMO Dashboard — Efletexia  |  app.js  v2
// ═══════════════════════════════════════════════════════════
const JIRA_BASE = "https://efletexia.atlassian.net/browse/";
const TODAY = new Date(); TODAY.setHours(0,0,0,0);

// Épicas especiales excluidas de la bitácora principal
const SPECIAL_EPICS = {
  'PTS-327': { label: 'Soporte Requerimientos', icon: '🛠️' },
  'PTS-326': { label: 'Gestión PMO-TI',         icon: '📋' }
};
const SPECIAL_EPIC_KEYS = Object.keys(SPECIAL_EPICS);

// Data stores
let epics    = [];
let recursos = [];
let activeRecIdx = -1;


// ── SEMÁFORO PORTAFOLIO (columna Semaforización) ────────────
const WARN_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#F5B800" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';

function getSemaforoPortafolio(e) {
  // Stand By → ícono de advertencia (se mantiene)
  if ((e.status||'').toLowerCase() === 'stand by') return WARN_ICON;

  const statusLow = (e.status||'').toLowerCase();
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = e.duedate ? new Date(e.duedate+'T12:00:00') : null;

  // Sin fecha fin → gris
  if (!fin) return '<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle"><circle cx="9" cy="9" r="8" fill="#6b7280"/></svg>';

  // Producción → azul
  if (statusLow === 'producción' || statusLow === 'produccion')
    return '<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle"><circle cx="9" cy="9" r="8" fill="#3B82F6"/></svg>';

  // Vencido → rojo
  if (fin < hoy)
    return '<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle"><circle cx="9" cy="9" r="8" fill="#ef4444"/></svg>';

  // Replanificado → amarillo
  if (!!e.replanificacion)
    return '<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle"><circle cx="9" cy="9" r="8" fill="#F5B800"/></svg>';

  // En plazo → verde
  return '<svg width="18" height="18" viewBox="0 0 18 18" style="vertical-align:middle"><circle cx="9" cy="9" r="8" fill="#4ade80"/></svg>';
}

// ── UTILS ──────────────────────────────────────────────────
function sbClass(s){
  if(!s) return 'backlog';
  const map={
    "backlog":"backlog","análisis":"analisis","analisis":"analisis",
    "desarrollo":"desarrollo","pruebas":"pruebas",
    "producción":"produccion","produccion":"produccion",
    "planificado":"planificado","stand by":"standby","desestimado":"desestimado",
    "tareas por hacer":"backlog",
    "en curso":"en-curso","review":"en-curso",
    "blocked":"bloqueado","bloqueado":"bloqueado","bloqued":"bloqueado",
    "finalizada":"produccion"
  };
  return map[s.toLowerCase()]||'backlog';
}
function fmtD(iso){
  if(!iso) return null;
  const d = new Date(iso+'T12:00:00');
  if(isNaN(d.getTime())) return null;
  return d.toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
}
function diffD(a,b){ return Math.round((b-a)/864e5); }
function workDays(a,b){
  if(b<=a) return 0;
  let count=0;
  const d=new Date(a); d.setHours(0,0,0,0);
  const end=new Date(b); end.setHours(0,0,0,0);
  while(d<end){ const dow=d.getDay(); if(dow!==0&&dow!==6) count++; d.setDate(d.getDate()+1); }
  return count;
}
function progCell(pct){
  if(pct===null||pct===undefined) return '<span style="color:var(--text-muted)">—</span>';
  const w=Math.min(100,Math.round(pct*100)), cls=w>=100?" full":"";
  return `<div class="prog-cell"><div class="prog-bar"><div class="prog-fill${cls}" style="width:${w}%"></div></div><span class="prog-pct">${w}%</span></div>`;
}
function pill(v){ return v?`<span class="pill">${v}</span>`:'<span style="color:var(--text-muted)">—</span>'; }
function esc(s){ if(!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function extractReplanFromAdf(adf){
  // Extrae párrafos que empiezan con "Replanificación" del campo ADF
  if(!adf || typeof adf !== 'object') return null;
  const parrafos = (adf.content || []).filter(n => n.type === 'paragraph');
  for(const p of parrafos){
    const txt = p.content ? p.content.map(c => c.text||'').join('') : '';
    if(txt.toLowerCase().startsWith('replanificaci')) return txt.trim();
  }
  return null;
}

function adfToText(node){
  if(!node) return '';
  if(typeof node==='string') return node;
  const t=node.type||'', c=node.content||[];
  if(t==='text') return node.text||'';
  if(t==='hardBreak') return '\n';
  if(t==='paragraph') return c.map(adfToText).join('')+'\n';
  if(t==='bulletList'||t==='orderedList')
    return c.map((item,i)=>(t==='orderedList'?(i+1)+'. ':'• ')+adfToText(item).trim()).join('\n')+'\n';
  if(t==='listItem') return c.map(adfToText).join('');
  return c.map(adfToText).join('');
}

// ── CSV EXPORT ─────────────────────────────────────────────
function downloadCSV(rows, filename){
  const escape = v => {
    if(v===null||v===undefined) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? '"'+s.replace(/"/g,'""')+'"'
      : s;
  };
  const csv = rows.map(r => r.map(escape).join(',')).join('\n');
  const blob = new Blob(['\uFEFF'+csv], {type:'text/csv;charset=utf-8;'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href=url; a.download=filename; a.click();
  URL.revokeObjectURL(url);
}

function exportPortafolioCSV(){
  const data = sortedData(getFiltered());
  const hdr  = ['Clave','Código','Proyecto','Categoría','Área','Sponsor','Estado',
                 'Plan%','Real%','Desvío%','Des%','Pru%','FechaInicio','FechaFin',
                 'COND.','Conformidad','DocFuncional','Bloqueante'];
  const rows = data.map(e => [
    e.key, e.codigo, e.summary, e.categoria, e.area, e.sponsor, e.status,
    e.planPct!==null?Math.round(e.planPct*100):'',
    e.realPct!==null?Math.round(e.realPct*100):'',
    e.desvioPct!==null?Math.round(e.desvioPct*100):'',
    e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):'',
    e.pctPruebas!==null?Math.round(e.pctPruebas*100):'',
    e.fechaInicio||'', e.duedate||'',
    e.condicion||'', e.conformidad||'', e.docFuncional||'', e.bloqueante||''
  ]);
  downloadCSV([hdr,...rows], `portafolio_${new Date().toISOString().slice(0,10)}.csv`);
}

document.getElementById('btn-export-port').addEventListener('click', exportPortafolioCSV);


// ── TABS ───────────────────────────────────────────────────
let recursosLoaded = false;

document.querySelectorAll('.tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('panel-'+tab.dataset.tab);
    if(panel) panel.classList.add('active');
    if(tab.dataset.tab==='recursos' && !recursosLoaded) loadRecursos();
    if(tab.dataset.tab==='capacity' && !capacityLoaded) loadCapacity();
    if(tab.dataset.tab==='entregables') renderEntregables();
  });
});


// ── PORTAFOLIO: parse & render ─────────────────────────────
const JIRA_FIELDS = [
  "summary","status","assignee","reporter","labels","duedate","description",
  "customfield_10015","customfield_10592","customfield_10659",
  "customfield_10725","customfield_10726","customfield_10759",
  "customfield_10895","customfield_10928","customfield_10929",
  "customfield_10930","customfield_10931","customfield_10934",
  "customfield_10829","customfield_10862","customfield_10969",
  "customfield_10970","customfield_11003","customfield_11004",
  "customfield_11037","customfield_11070","customfield_11170","customfield_11269",
  "customfield_11203"
];

function parseIssue(i){
  const f=i.fields, rep=f.reporter;
  let bit=f.customfield_10829, prox=f.customfield_10862;
  const replanRaw = f.customfield_11269;
  const replanificacion = replanRaw ? (typeof replanRaw==='object' ? adfToText(replanRaw).trim() : replanRaw) : null;
  if(bit&&typeof bit==='object') bit=adfToText(bit).trim();
  if(prox&&typeof prox==='object') prox=adfToText(prox).trim();
  let desc=f.description;
  if(desc&&typeof desc==='object') desc=adfToText(desc).trim();
  else if(typeof desc!=='string') desc=null;
  return{
    key:i.key,
    codigo:f.customfield_10934||null,
    summary:f.summary,
    status:f.status.name,
    assignee:f.assignee?f.assignee.displayName:null,
    asignado:f.customfield_10970||null,
    responsableDF:f.customfield_10969||null,
    reporter:rep?rep.displayName:null,
    labels:f.labels||[],
    duedate:f.duedate||null,
    fechaInicio:f.customfield_10015||null,
    pais:f.customfield_10592?f.customfield_10592.value:null,
    area:f.customfield_10930?f.customfield_10930.value:null,
    categoria:f.customfield_10659?f.customfield_10659.value:null,
    aplicacion:f.customfield_11203?f.customfield_11203.value:null,
    planPct:f.customfield_10725!==undefined?f.customfield_10725:null,
    realPct:f.customfield_10726!==undefined?f.customfield_10726:null,
    desvioPct:f.customfield_10759!==undefined?f.customfield_10759:null,
    pctAnalisis:f.customfield_10895!==undefined?f.customfield_10895:null,
    pctDesarrollo:f.customfield_10928!==undefined?f.customfield_10928:null,
    pctPruebas:f.customfield_10929!==undefined?f.customfield_10929:null,
    docFuncional:f.customfield_10931?f.customfield_10931.value:null,
    bloqueante:f.customfield_11003?f.customfield_11003.value:null,
    conformidad:f.customfield_11004?f.customfield_11004.value:null,
    prioridad:f.customfield_11037?f.customfield_11037.value:null,
    sponsor:f.customfield_11070?f.customfield_11070.value:null,
    condicion:f.customfield_11170||null,
    bitacora:bit||null,
    proximosPasos:prox||null,
    replanificacion:replanificacion||null,
    descripcion:desc||null,
  };
}

function updateKpis(data){
  const t=data.length;
  const crit=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>0.17).length;
  const tol =data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>=0.05&&Math.abs(e.desvioPct)<=0.17).length;
  const onT =data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)<0.05).length;
  const avgs=data.map(e=>e.realPct!==null?e.realPct:null).filter(v=>v!==null);
  const avg =avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length*100):0;
  const cj  =data.filter(e=>e.duedate&&e.duedate.startsWith('2026-06')).length;
  const mainEpicsTotal=epics.filter(e=>!SPECIAL_EPIC_KEYS.includes(e.key)).length;
  const isFiltered=data.length<mainEpicsTotal;
  function setKpi(id,val){
    const el=document.getElementById(id); if(!el) return;
    const prev=el.dataset.val;
    if(prev!==String(val)){
      el.style.transition='opacity .15s'; el.style.opacity='0.3';
      setTimeout(()=>{ el.textContent=val; el.dataset.val=String(val); el.style.opacity='1'; },150);
    }
  }
  setKpi('kpi-total',isFiltered?`${t}`:t);
  setKpi('kpi-crit', crit);
  setKpi('kpi-tol',  tol);
  setKpi('kpi-ont',  onT);
  setKpi('kpi-avg',  avg+'%');
  setKpi('kpi-cj',   cj);
  document.getElementById('hdr-meta').textContent=isFiltered
    ?`PMO TI · ${t} de ${mainEpicsTotal} épicas`
    :`PMO TI · ${mainEpicsTotal} épicas`;
}

function renderTable(data){
  const mainData = data.filter(e=>!SPECIAL_EPIC_KEYS.includes(e.key));
  updateKpis(mainData);
  const info=document.getElementById('table-info');
  if(info) info.innerHTML=`Mostrando <strong>${mainData.length}</strong> de ${epics.filter(e=>!SPECIAL_EPIC_KEYS.includes(e.key)).length} épicas`;
  const data_=mainData;
  const tb=document.getElementById('table-body');
  if(!data_.length){ tb.innerHTML='<tr><td colspan="15" style="text-align:center;padding:40px;color:var(--text-muted)">Sin resultados</td></tr>'; return; }
  tb.innerHTML=data_.map(e=>{
    const semaforo = getSemaforoPortafolio(e);
    return `
    <tr data-key="${e.key}">
      <td style="text-align:center;font-size:16px">${semaforo}</td>
      <td style="text-align:center;font-weight:600;color:var(--text-primary)">${e.prioridad||'—'}</td>
      <td class="code"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank" onclick="event.stopPropagation()">${esc(e.codigo||e.key)}</a></td>
      <td class="proj" title="${esc(e.summary)}">${esc(e.summary)}</td>
      <td class="cat">${esc(e.categoria)||'<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="muted">${e.area?`<span class="pill">${esc(e.area)}</span>`:'—'}</td>
      <td class="muted">${esc(e.sponsor)||'—'}</td>
      <td><span class="badge badge-${sbClass(e.status)}">${e.status}</span></td>
      <td class="muted">${e.planPct!==null?Math.round(e.planPct*100)+'% / '+(e.realPct!==null?Math.round(e.realPct*100)+'%':'—'):'—'}</td>
      <td class="muted" style="color:${e.desvioPct!==null?(Math.abs(e.desvioPct)>0.17?'var(--red)':Math.abs(e.desvioPct)>=0.05?'var(--yellow)':'var(--green)'):'var(--text-muted)'}">
        ${e.desvioPct!==null?Math.round(e.desvioPct*100)+'%':'—'}</td>
      <td class="muted">${e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100)+'% / '+(e.pctPruebas!==null?Math.round(e.pctPruebas*100)+'%':'—'):'—'}</td>
      <td class="muted">${fmtD(e.fechaInicio)||'—'}</td>
      <td class="muted">${fmtD(e.duedate)||'—'}</td>
      <td style="max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text-muted)" title="${esc(e.condicion||'')}">${esc(e.condicion||'—')}</td>
      <td class="muted">${e.conformidad==='Si'?'<span style="color:var(--green);font-size:15px">✓</span>':'—'}</td>
      <td class="muted">${e.docFuncional==='Si'?'<span style="color:var(--green);font-size:15px">✓</span>':e.docFuncional==='No'?'<span style="color:var(--red);font-size:15px">✕</span>':'—'}</td>
      <td><button class="btn-action" type="button" title="Cronograma y detalles" onclick="openModal('${e.key}');event.stopPropagation()">···</button></td>
    </tr>`;
  }).join('');
}


// ── PORTAFOLIO FILTERS ────────────────────────────────────
let sortCol=null, sortDir=1;

function getFiltered(){
  const s  = document.getElementById('s-search').value.toLowerCase();
  const sp = document.getElementById('s-sponsor').value;
  const p  = document.getElementById('s-pais').value;
  const c  = document.getElementById('s-cat').value;
  const ap = document.getElementById('s-app').value;
  const a  = document.getElementById('s-area').value;
  const ck = [...document.querySelectorAll('.estados-grid input:checked')].map(x=>x.value);
  return epics.filter(e=>{
    if(SPECIAL_EPIC_KEYS.includes(e.key)) return false;
    if(s && !(e.codigo||'').toLowerCase().includes(s) && !e.summary.toLowerCase().includes(s) && !e.key.toLowerCase().includes(s)) return false;
    if(sp && e.sponsor!==sp) return false;
    if(p  && e.pais!==p)    return false;
    if(c  && e.categoria!==c) return false;
    if(ap && e.aplicacion!==ap) return false;
    if(a  && e.area!==a)    return false;
    if(ck.length && !ck.includes(e.status)) return false;
    return true;
  });
}

function sortedData(data){
  if(!sortCol) return data;
  return [...data].sort((a,b)=>{
    let av=a[sortCol], bv=b[sortCol];
    if(av===null||av===undefined) return 1;
    if(bv===null||bv===undefined) return -1;
    if(typeof av==='number'&&typeof bv==='number') return (av-bv)*sortDir;
    return String(av).localeCompare(String(bv),'es',{sensitivity:'base'})*sortDir;
  });
}

['s-search','s-sponsor','s-pais','s-cat','s-app','s-area'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input',()=>renderTable(sortedData(getFiltered())));
});
document.querySelectorAll('.estados-grid input').forEach(cb=>{
  cb.addEventListener('change',()=>renderTable(sortedData(getFiltered())));
});
document.getElementById('btn-limpiar').addEventListener('click',()=>{
  document.getElementById('s-search').value='';
  ['s-sponsor','s-pais','s-cat','s-app','s-area'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.querySelectorAll('.estados-grid input').forEach(cb=>cb.checked=false);
  sortCol=null; sortDir=1;
  document.querySelectorAll('#panel-portafolio thead th').forEach(t=>{
    t.classList.remove('sort-asc','sort-desc');
    const si=t.querySelector('.sort-icon'); if(si) si.textContent='';
  });
  renderTable(epics);
});

document.querySelectorAll('#panel-portafolio thead th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    if(sortCol===col){ sortDir*=-1; } else { sortCol=col; sortDir=1; }
    document.querySelectorAll('#panel-portafolio thead th').forEach(t=>{
      t.classList.remove('sort-asc','sort-desc');
      const si=t.querySelector('.sort-icon'); if(si) si.textContent='';
    });
    th.classList.add(sortDir===1?'sort-asc':'sort-desc');
    renderTable(sortedData(getFiltered()));
  });
});


// ── LOAD PORTAFOLIO ────────────────────────────────────────
async function fetchAllEpics(){
  const resp = await fetch('/api/jira',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ jql:'project = PTS AND issuetype = Epic ORDER BY created ASC', fields:JIRA_FIELDS })
  });
  if(!resp.ok){ const err=await resp.text(); throw new Error(`Jira ${resp.status}: ${err}`); }
  return resp.json();
}

async function loadData(manual=false){
  const loading    = document.getElementById('loading-screen');
  const errorScr   = document.getElementById('error-screen');
  const refreshBtn = document.getElementById('btn-refresh');
  if(manual){ refreshBtn.classList.add('spinning'); }
  else { loading.classList.remove('hidden'); errorScr.classList.add('hidden'); }
  document.getElementById('loading-text').textContent='Cargando épicas desde Jira...';
  try{
    const data   = await fetchAllEpics();
    const issues = data.issues||[];
    document.getElementById('loading-text').textContent=`Procesando ${issues.length} épicas...`;
    epics = issues.map(parseIssue);

    function populateSelect(id,values,allLabel){
      const sel=document.getElementById(id); if(!sel) return;
      const cur=sel.value;
      sel.innerHTML=`<option value="">${allLabel}</option>`+
        [...new Set(values)].sort().map(v=>`<option${v===cur?' selected':''}>${v}</option>`).join('');
    }
    populateSelect('s-sponsor', epics.map(e=>e.sponsor).filter(Boolean),'Todos');
    populateSelect('s-pais',    epics.map(e=>e.pais).filter(Boolean),'Todos');
    populateSelect('s-cat',     epics.map(e=>e.categoria).filter(Boolean),'Todas');
    populateSelect('s-app',     APLICACIONES_JIRA,'Todas');
    populateSelect('s-area',    epics.map(e=>e.area).filter(Boolean),'Todas');

    document.getElementById('last-update').textContent='Actualizado '+new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
    loading.classList.add('hidden');
    errorScr.classList.add('hidden');
    refreshBtn.classList.remove('spinning');

    document.getElementById('kpis-section').innerHTML=`
      <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value c-white" id="kpi-total"></div></div>
      <div class="kpi"><div class="kpi-label">Críticos</div><div class="kpi-value c-red" id="kpi-crit"></div><div class="kpi-sub">Desv &gt;17%</div></div>
      <div class="kpi"><div class="kpi-label">Tolerancia</div><div class="kpi-value c-yellow" id="kpi-tol"></div><div class="kpi-sub">Desv 5–17%</div></div>
      <div class="kpi"><div class="kpi-label">On Track</div><div class="kpi-value c-blue" id="kpi-ont"></div><div class="kpi-sub">Desv &lt;5%</div></div>
      <div class="kpi"><div class="kpi-label">Avance prom.</div><div class="kpi-value c-cyan" id="kpi-avg"></div></div>
      <div class="kpi"><div class="kpi-label">Cierre junio</div><div class="kpi-value c-green" id="kpi-cj"></div></div>
    `;
    sortCol=null; sortDir=1;
    const mainEpics=epics.filter(e=>!SPECIAL_EPIC_KEYS.includes(e.key));
    renderTable(mainEpics);
    updateKpis(mainEpics);
    renderSpecialSections();
  }catch(err){
    console.error(err);
    loading.classList.add('hidden');
    refreshBtn.classList.remove('spinning');
    if(!manual){
      errorScr.classList.remove('hidden');
      document.getElementById('error-msg').textContent=err.message;
    } else {
      document.getElementById('last-update').textContent='⚠ Error al actualizar';
    }
  }
}

loadData();


loadData();

document.getElementById('btn-export-rec')?.addEventListener('click', () => {
  const _s=(document.getElementById('rec-search')?.value||'').toLowerCase();
  const _ab=document.querySelector('.rec-area-btn.active');
  const _ar=_ab?_ab.dataset.area:'';
  const _pa=document.getElementById('rec-pais-sel')?.value||'';
  const filtered=recursos.filter(r=>{
    if(_s&&!r.nombre.toLowerCase().includes(_s)&&!r.proyectosDetalle.some(p=>p.nombre.toLowerCase().includes(_s))) return false;
    if(_ar&&r.area!==_ar) return false;
    if(_pa&&r.pais!==_pa) return false;
    return true;
  });
  const hdr=['Recurso','Área','País','Proyectos','Horas Pend.','Horas Total','Horas Cerradas','Horas Libres','Entregas Pend.','Bloqueantes'];
  const rows=filtered.map(r=>[r.nombre,r.area||'',r.pais||'',r.proyectos,r.horasPend,r.horasTotal,r.horasCerr,r.horasLibre,r.entregasPend,r.bloqueantes]);
  downloadCSV([hdr,...rows],`recursos_${new Date().toISOString().slice(0,10)}.csv`);
});

// ── VENTAS: parse & render ─────────────────────────────────

// ── GANTT & DETAIL (Portafolio) ────────────────────────────
function buildGantt(e, stories){
  if(!e.fechaInicio&&!e.duedate){
    return `<div class="gno-dates"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="margin-bottom:10px;opacity:.4;display:block;margin-left:auto;margin-right:auto"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Sin fechas definidas en Jira.</div>`;
  }
  const sRaw=e.fechaInicio||e.duedate, eRaw=e.duedate||e.fechaInicio;
  const pS=new Date(sRaw+'T12:00:00'), pE=new Date(eRaw+'T12:00:00');
  let aS=new Date(pS.getFullYear(),pS.getMonth(),1);
  let aE=new Date(pE.getFullYear(),pE.getMonth()+1,0);
  if(TODAY>aE) aE=new Date(TODAY.getFullYear(),TODAY.getMonth()+1,0);
  if(TODAY<aS) aS=new Date(aS.getFullYear(),aS.getMonth()-1,1);
  const total=diffD(aS,aE)+1;
  const months=[];
  let cur=new Date(aS);
  while(cur<=aE){
    const mS=new Date(cur.getFullYear(),cur.getMonth(),1);
    const mE=new Date(cur.getFullYear(),cur.getMonth()+1,0);
    const vS=mS<aS?aS:mS, vE=mE>aE?aE:mE;
    months.push({ label:cur.toLocaleDateString('es-PE',{month:'short',year:'2-digit'}).toUpperCase(), lp:(diffD(aS,vS)/total)*100, wp:((diffD(vS,vE)+1)/total)*100 });
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  const grid=months.map(m=>`<div class="g-grid" style="left:${m.lp}%"></div>`).join('');
  const tp=(diffD(aS,TODAY)/total)*100;
  const tl=tp>=0&&tp<=100?`<div class="g-today" style="left:${tp.toFixed(2)}%"><div class="g-today-lbl">hoy</div></div>`:'';
  function barPos(s,en){
    if(!s||!en) return null;
    const ds=new Date(s+'T12:00:00'), de=new Date(en+'T12:00:00');
    if(isNaN(ds.getTime())||isNaN(de.getTime())) return null;
    const l=Math.max(0,(diffD(aS,ds)/total)*100);
    const r=Math.min(100,(diffD(aS,de)/total)*100);
    return {l, w:Math.max(0.5,r-l)};
  }
  function pctHtml(plan,real){
    if(plan===null&&real===null) return `<span style="color:var(--text-dim)">—</span>`;
    const p=plan!==null?Math.round(plan*100):null;
    const r=real!==null?Math.round(real*100):null;
    const rColor=r===null?'var(--text-dim)':r>=100?'var(--green)':r>=50?'var(--yellow)':'var(--red)';
    const pStr=p!==null?`<span style="color:var(--text-muted)">${p}%</span>`:'—';
    const rStr=r!==null?`<span style="color:${rColor};font-weight:700">${r}%</span>`:'<span style="color:var(--text-dim)">0%</span>';
    return `${pStr} / ${rStr}`;
  }
  const bL=Math.max(0,(diffD(aS,pS)/total)*100);
  const bR=Math.min(100,(diffD(aS,pE)/total)*100);
  const bW=Math.max(.5,bR-bL);
  const bc='gb-'+sbClass(e.status);
  const dur=diffD(pS,pE);
  const durWork=workDays(pS,pE);
  const elapsed=workDays(pS,TODAY);
  const remaining=workDays(TODAY,pE);
  const pctT=durWork>0?Math.min(100,Math.round((elapsed/durWork)*100)):0;
  const pctDev=e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null;
  const advColor=pctDev===null?'var(--text-muted)':pctDev>=pctT?'var(--green)':pctDev>=pctT-15?'var(--yellow)':'var(--red)';
  const epicRow=`<div class="grow g-epic-row">
    <div class="grow-lbl" title="${esc(e.summary)}">${esc(e.summary)}</div>
    <div class="grow-track">${grid}${tl}<div class="g-bar ${bc}" style="left:${bL.toFixed(2)}%;width:${bW.toFixed(2)}%"></div></div>
    <div class="g-row-pct">${pctHtml(e.planPct,e.realPct)}</div>
  </div>`;
  let storyRows='';
  if(stories===undefined||stories===null){
    storyRows=`<div class="grow"><div class="grow-lbl" style="color:var(--text-dim);font-size:11px;font-style:italic">Cargando historias…</div><div class="grow-track">${grid}${tl}</div><div class="g-row-pct"></div></div>`;
  } else if(!stories.length){
    storyRows=`<div class="grow"><div class="grow-lbl" style="color:var(--text-dim);font-size:11px;font-style:italic">Sin historias con fechas</div><div class="grow-track">${grid}${tl}</div><div class="g-row-pct"></div></div>`;
  } else {
    // Helper: "Roxana Peralta" → "RP"
    function initials(name){
      if(!name) return '';
      return name.trim().split(/\s+/).map(w=>w[0]||'').join('').toUpperCase();
    }
    // Helper: "2026-06-04" → "04/06"
    function fmtShort(iso){
      if(!iso) return null;
      const d=new Date(iso+'T12:00:00');
      if(isNaN(d.getTime())) return null;
      return String(d.getDate()).padStart(2,'0')+'/'+(d.getMonth()+1).toString().padStart(2,'0');
    }
    // Build right-column: "IN · dd/mm → dd/mm" — single line
    function metaCol(assigneeName, startIso, endIso){
      const ini   = initials(assigneeName);
      const start = fmtShort(startIso);
      const end   = fmtShort(endIso);
      const dateRange = [start, end].filter(Boolean).join(' → ');
      const parts = [];
      if(ini)       parts.push(`<span style="color:var(--blue);font-weight:700;letter-spacing:.3px">${esc(ini)}</span>`);
      if(dateRange) parts.push(`<span style="color:var(--text-muted)">${dateRange}</span>`);
      return parts.join(' ');
    }

    stories.forEach(story=>{
      const sf=story.fields;
      const sNom=sf.summary||story.key;
      const sStatus=sf.status?sf.status.name:'', sCls='gb-'+sbClass(sStatus);
      const sStart=sf.customfield_10015||null, sEnd=sf.duedate||null;
      const sPos=barPos(sStart, sEnd);
      const sBarHtml=sPos?`<div class="g-bar ${sCls}" style="left:${sPos.l.toFixed(2)}%;width:${sPos.w.toFixed(2)}%"></div>`:'';

      // Historia: iniciales = union de asignados de subtareas (únicos, en orden de aparición)
      // Fechas = min(inicio subtareas) → max(fin subtareas)
      const subItems = sf._subtasks||[];
      let sRightCol;
      if(subItems.length){
        // Iniciales únicas preservando orden
        const seenIni = new Set();
        const subInits = [];
        subItems.forEach(sub=>{
          const name = sub.fields?.assignee?.displayName||'';
          const ini  = initials(name);
          if(ini && !seenIni.has(ini)){ seenIni.add(ini); subInits.push(ini); }
        });
        // Rango de fechas de subtareas
        const subStarts = subItems.map(s=>s.fields?.customfield_10015).filter(Boolean);
        const subEnds   = subItems.map(s=>s.fields?.duedate).filter(Boolean);
        const minStart  = subStarts.length ? subStarts.reduce((a,b)=>a<b?a:b) : sStart;
        const maxEnd    = subEnds.length   ? subEnds.reduce((a,b)=>a>b?a:b)   : sEnd;
        const inisHtml  = subInits.length
          ? `<span style="color:var(--blue);font-weight:700;letter-spacing:.3px">${subInits.join(', ')}</span>`
          : '';
        const dateRange = [fmtShort(minStart), fmtShort(maxEnd)].filter(Boolean).join(' → ');
        const dateHtml  = dateRange ? `<span style="color:var(--text-muted)">${dateRange}</span>` : '';
        sRightCol = [inisHtml, dateHtml].filter(Boolean).join(' ');
      } else {
        // Sin subtareas: usar asignado e fechas de la historia
        sRightCol = metaCol(sf.assignee?sf.assignee.displayName:'', sStart, sEnd);
      }
      storyRows+=`<div class="grow g-story-row">
        <div class="grow-lbl g-lbl-story" title="${esc(sNom)}">${esc(sNom)}</div>
        <div class="grow-track">${grid}${tl}${sBarHtml}</div>
        <div class="g-row-pct g-row-meta">${sRightCol}</div>
      </div>`;
      (sf._subtasks||[]).forEach(sub=>{
        const tf=sub.fields, tNom=tf.summary||sub.key, tAsig=tf.assignee?tf.assignee.displayName:'';
        const tStatus=tf.status?tf.status.name:'', tCls='gb-'+sbClass(tStatus);
        const tStart=tf.customfield_10015||null, tEnd=tf.duedate||null;
        const tPos=barPos(tStart, tEnd);
        const tBarHtml=tPos?`<div class="g-bar ${tCls}" style="left:${tPos.l.toFixed(2)}%;width:${tPos.w.toFixed(2)}%"></div>`:'';
        const tRightCol=metaCol(tAsig, tStart, tEnd);
        storyRows+=`<div class="grow g-subtask-row">
          <div class="grow-lbl g-lbl-subtask" title="${esc(tNom)}">${esc(tNom)}</div>
          <div class="grow-track">${grid}${tl}${tBarHtml}</div>
          <div class="g-row-pct g-row-meta">${tRightCol}</div>
        </div>`;
      });
    });
  }
  return `
    <div class="gantt-meta">
      <div class="gm-item"><span class="gm-lbl">Fecha inicio</span><span class="gm-val">${fmtD(e.fechaInicio)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Fecha vencimiento</span><span class="gm-val">${fmtD(e.duedate)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Duración</span><span class="gm-val">${dur>=0?dur+' días':'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Estado</span><span class="gm-val"><span class="badge badge-${sbClass(e.status)}">${e.status}</span></span></div>
    </div>
    <div style="overflow-x:auto"><div class="gc">
      <div class="g-hdr">
        <div class="g-lc"></div>
        <div class="g-months">${months.map(m=>`<div class="g-month" style="left:${m.lp.toFixed(2)}%;width:${m.wp.toFixed(2)}%">${m.label}</div>`).join('')}</div>
        <div class="g-rc" style="text-align:right;font-size:10px;color:var(--text-dim);padding-left:8px">Recursos · Fechas</div>
      </div>
      ${epicRow}
      ${storyRows}
    </div></div>
    ${dur>0?`<div class="g-prog-row"><div class="g-prog-lbl"><span>Tiempo transcurrido</span><span>${pctT}%</span></div><div class="g-prog-track"><div class="g-prog-fill" style="width:${pctT}%;background:var(--text-dim)"></div></div></div>`:''}
    <div class="g-stats">
      <div class="g-stat"><div class="g-stat-lbl">Días transcurridos</div><div class="g-stat-val" style="color:var(--text-muted)">${elapsed}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">Días restantes</div><div class="g-stat-val" style="color:${remaining===0?'var(--red)':'var(--blue)'}">${remaining}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">% Desarrollo</div><div class="g-stat-val" style="color:${advColor}">${pctDev!==null?pctDev+'%':'—'}</div></div>
    </div>
    <div class="g-legend">
      <div class="g-legend-item"><div class="g-legend-dot" style="background:var(--green)"></div>Completado</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#b8860b"></div>En curso</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:var(--text-dim)"></div>Pendiente</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#8b1a1a"></div>Bloqueado</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:var(--red);width:2px;border-radius:0"></div>Hoy</div>
    </div>
    ${(()=>{
      // Collect hours per assignee from all subtasks across all stories
      if(!stories||!stories.length) return '';
      const PART_COLORS=['#3fb950','#f0883e','#39c5f0','#f85149','#bc8cff','#58a6ff','#d29922','#ff7b72','#56d364','#ffa657'];
      const byPerson={};
      stories.forEach(story=>{
        const subs=story.fields._subtasks||[];
        subs.forEach(sub=>{
          const name=sub.fields?.assignee?.displayName||'';
          if(!name) return;
          const hrs=sub.fields?.customfield_11136||0;
          if(!byPerson[name]) byPerson[name]={name,hrs:0};
          byPerson[name].hrs+=hrs;
        });
        // Also count story-level hours if no subtasks
        if(!subs.length){
          const name=story.fields?.assignee?.displayName||'';
          if(!name) return;
          const hrs=story.fields?.customfield_11136||0;
          if(!byPerson[name]) byPerson[name]={name,hrs:0};
          byPerson[name].hrs+=hrs;
        }
      });
      const entries=Object.values(byPerson).filter(p=>p.hrs>0).sort((a,b)=>b.hrs-a.hrs);
      if(!entries.length) return '';
      const totalHrs=entries.reduce((s,p)=>s+p.hrs,0);
      const maxHrs=entries[0].hrs;
      const rows=entries.map((p,i)=>{
        const ini=p.name.trim().split(/\s+/).map(w=>w[0]||'').join('').toUpperCase();
        const pct=Math.round((p.hrs/totalHrs)*100);
        const barW=Math.round((p.hrs/maxHrs)*100);
        const col=PART_COLORS[i%PART_COLORS.length];
        return `<div class="gpart-row">
          <div class="gpart-ini" style="background:${col}22;color:${col}">${esc(ini)}</div>
          <div class="gpart-name">${esc(p.name)}</div>
          <div class="gpart-bar-wrap"><div class="gpart-bar" style="width:${barW}%;background:${col}"></div></div>
          <div class="gpart-pct">${pct}%</div>
          <div class="gpart-hrs">${p.hrs}h</div>
        </div>`;
      }).join('');
      return `<div class="gpart-section">
        <div class="gpart-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/><path d="M21 21v-2a4 4 0 0 0-3-3.87"/></svg>
          PARTICIPACIÓN DE RECURSOS
        </div>
        ${rows}
        <div class="gpart-total">Total: ${totalHrs}h</div>
      </div>`;
    })()}
  `;
}

function buildDetail(e){
  const bitHtml=e.bitacora?`<div class="log-box">${esc(e.bitacora)}</div>`:`<div class="log-box empty">Sin registros en bitácora</div>`;
  const proxHtml=e.proximosPasos?`<div class="log-box">${esc(e.proximosPasos)}</div>`:`<div class="log-box empty">Sin próximos pasos definidos</div>`;
  const descHtml=e.descripcion?`<div class="log-box" style="border-left-color:var(--blue)">${esc(e.descripcion)}</div>`:`<div class="log-box empty">Sin descripción definida</div>`;
  return `
    <div class="log-section">
      <div class="log-title"><div class="log-title-bar" style="background:var(--blue)"></div>Detalles clave</div>
      ${descHtml}
      <div class="log-spacer"></div>
      <div class="log-title"><div class="log-title-bar"></div>Bitácora</div>
      ${bitHtml}
      <div class="log-spacer"></div>
      <div class="log-title"><div class="log-title-bar"></div>Próximos pasos</div>
      ${proxHtml}
    </div>`;
}


// ── MODAL (Portafolio) ─────────────────────────────────────
let activeEpic=null, activeTab='gantt';
const epicStoriesCache={};

async function loadEpicStories(epicKey){
  if(epicStoriesCache[epicKey]!==undefined) return epicStoriesCache[epicKey];
  try{
    const resp=await fetch('/api/jira',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'stories',epicKey})});
    if(!resp.ok) return null;
    const data=await resp.json();
    epicStoriesCache[epicKey]=data.stories||[];
    return epicStoriesCache[epicKey];
  }catch(err){ console.error('Error historias:',err); return null; }
}

function renderModalBody(){
  document.getElementById('modal-body').innerHTML =
    activeTab==='gantt' ? buildGantt(activeEpic) : buildDetail(activeEpic);
}

function openModal(key){
  activeEpic=epics.find(e=>e.key===key);
  if(!activeEpic) return;
  activeTab='gantt';
  document.getElementById('modal-key').textContent  = activeEpic.codigo||activeEpic.key;
  document.getElementById('modal-title').textContent = activeEpic.summary;
  document.getElementById('modal-panel').className  = 'modal-panel w-gantt';
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.toggle('active',t.dataset.mtab==='gantt'));
  renderModalBody();
  document.getElementById('modal-overlay').classList.add('open');
  loadEpicStories(key).then(stories=>{
    if(activeEpic&&activeEpic.key===key&&activeTab==='gantt')
      document.getElementById('modal-body').innerHTML=buildGantt(activeEpic,stories);
  });
}

document.querySelectorAll('.modal-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    activeTab=t.dataset.mtab;
    document.querySelectorAll('.modal-tab').forEach(x=>x.classList.toggle('active',x===t));
    document.getElementById('modal-panel').className='modal-panel '+(activeTab==='gantt'?'w-gantt':'w-detail');
    if(activeTab==='gantt'&&activeEpic){
      renderModalBody();
      const key=activeEpic.key;
      loadEpicStories(key).then(stories=>{
        if(activeEpic&&activeEpic.key===key&&activeTab==='gantt')
          document.getElementById('modal-body').innerHTML=buildGantt(activeEpic,stories);
      });
    } else { renderModalBody(); }
  });
});
document.getElementById('modal-close').addEventListener('click',()=>document.getElementById('modal-overlay').classList.remove('open'));
document.getElementById('modal-overlay').addEventListener('click',function(ev){ if(ev.target===this) this.classList.remove('open'); });


// ── RECURSOS ──────────────────────────────────────────────
(function initRecursos(){
  const today=new Date().toISOString().split('T')[0];
  const fi=document.getElementById('rec-fecha-corte');
  if(fi){ fi.value=today; fi.addEventListener('change',()=>{ if(recursos.length>0) renderRecursos(); }); }
  document.getElementById('rec-search').addEventListener('input', renderRecursos);
})();

async function loadRecursos(){
  recursosLoaded=true;
  const info=document.getElementById('rec-table-info');
  if(info) info.textContent='Cargando recursos desde Jira...';
  try{
    const respRec=await fetch('/api/jira',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'recursos'})});
    if(!respRec.ok) throw new Error('Error recursos '+respRec.status);
    const dataRec=await respRec.json();
    const historias=dataRec.issues||[];

    const CAPACITY=168;
    const today=new Date(); today.setHours(0,0,0,0);
    const fechaCorteEl=document.getElementById('rec-fecha-corte');
    const fechaCorte=fechaCorteEl&&fechaCorteEl.value?new Date(fechaCorteEl.value+'T12:00:00'):today;
    const mesActual=fechaCorte.getMonth();
    const anioActual=fechaCorte.getFullYear();
    const diasMes=new Date(anioActual,mesActual+1,0).getDate();
    const diaCorte=fechaCorte.getDate();
    const horasTranscurridas=Math.round((diaCorte/diasMes)*CAPACITY);
    const horasFuturas=CAPACITY-horasTranscurridas;
    const mesNombre=fechaCorte.toLocaleDateString('es-PE',{month:'long',year:'numeric'});
    const avanceMes=Math.round((diaCorte/diasMes)*100);
    const infoBar=document.getElementById('rec-corte-info');
    if(infoBar) infoBar.innerHTML=`<span style="color:var(--text-muted);font-size:12px">
      ${mesNombre} &nbsp;|&nbsp; Capacidad: <span style="color:var(--blue)">${CAPACITY}h</span>
      &nbsp;|&nbsp; Transcurridas: <span style="color:var(--text-muted)">${horasTranscurridas}h</span>
      &nbsp;|&nbsp; Futuras: <span style="color:var(--yellow)">${horasFuturas}h</span>
      &nbsp;|&nbsp; Avance mes: <span style="color:var(--green)">${avanceMes}%</span></span>`;

    const byPerson={};
    historias.forEach(h=>{
      const f=h.fields;
      const nombre=f.assignee?f.assignee.displayName:'Sin asignar';
      const horasEst=f.customfield_11136||0;
      const horasPend=f.customfield_11137||0;
      const horasCerr=Math.max(0,horasEst-horasPend);
      const epica=f._epicaParent||null;
      const epicaKey=epica?epica.key:null;
      const epicaNom=epica?(epica.summary||epica.key):'Sin épica';
      const area=f.customfield_10930?f.customfield_10930.value:null;
      const pais=f.customfield_10592?f.customfield_10592.value:null;
      const bloq=f.customfield_11003?f.customfield_11003.value:null;
      const status=f.status?f.status.name:'';
      const isDone=['Finalizada','Producción','En producción','Cerrado','Done','Closed'].includes(status);
      if(!byPerson[nombre]) byPerson[nombre]={nombre,area,pais,horasEst:0,horasPend:0,horasCerr:0,totalHistorias:0,entregasPend:0,bloqueantes:0,epicasMap:{}};
      const p=byPerson[nombre];
      p.horasEst+=horasEst; p.horasPend+=horasPend; p.horasCerr+=horasCerr;
      p.totalHistorias++;
      if(!isDone) p.entregasPend++;
      if(bloq==='Si') p.bloqueantes++;
      if(area&&!p.area) p.area=area;
      if(pais&&!p.pais) p.pais=pais;
      if(epicaKey){
        if(!p.epicasMap[epicaKey]) p.epicasMap[epicaKey]={key:epicaKey,nombre:epicaNom,horasEst:0,horasPend:0,actividades:0,pendientes:0,tareas:[]};
        p.epicasMap[epicaKey].horasEst+=horasEst; p.epicasMap[epicaKey].horasPend+=horasPend;
        p.epicasMap[epicaKey].actividades++;
        if(!isDone) p.epicasMap[epicaKey].pendientes++;
        p.epicasMap[epicaKey].tareas.push({key:h.key,nombre:f.summary||h.key,status,isDone,horasEst,horasPend,fecha:f.customfield_10015||f.duedate||null,updated:f.updated||null});
      }
    });

    recursos=Object.values(byPerson).map(p=>({
      nombre:p.nombre, area:p.area, pais:p.pais,
      proyectos:Object.keys(p.epicasMap).length,
      horasPend:p.horasPend, horasTotal:p.horasEst, horasCerr:p.horasCerr,
      horasLibre:Math.max(0,CAPACITY-p.horasEst),
      entregasPend:p.entregasPend, bloqueantes:p.bloqueantes,
      proyectosDetalle:Object.values(p.epicasMap).map(e=>({key:e.key,nombre:e.nombre,horasTotal:e.horasEst,horasPend:e.horasPend,actividades:e.actividades,pendientes:e.pendientes,tareas:e.tareas||[]})).sort((a,b)=>b.horasTotal-a.horasTotal),
    })).filter(r=>r.nombre!=='Sin asignar').sort((a,b)=>b.horasPend-a.horasPend);

    // Populate área pills
    const areas=[...new Set(recursos.map(r=>r.area).filter(Boolean))].sort();
    const areaWrap=document.getElementById('rec-area-btns');
    if(areaWrap){
      areaWrap.innerHTML=areas.map(a=>`<button class="rec-area-btn" data-area="${esc(a)}">${esc(a)}</button>`).join('');
      areaWrap.querySelectorAll('.rec-area-btn').forEach(btn=>{
        btn.addEventListener('click',()=>{
          const active=btn.classList.contains('active');
          areaWrap.querySelectorAll('.rec-area-btn').forEach(b=>b.classList.remove('active'));
          if(!active) btn.classList.add('active');
          renderRecursos();
        });
      });
    }
    // Populate país select
    const paises=[...new Set(recursos.map(r=>r.pais).filter(Boolean))].sort();
    const paisSel=document.getElementById('rec-pais-sel');
    if(paisSel) paisSel.innerHTML=`<option value="">Todos los países</option>`+paises.map(p=>`<option>${p}</option>`).join('');

    document.getElementById('rec-limpiar-btn').addEventListener('click',()=>{
      document.getElementById('rec-search').value='';
      document.querySelectorAll('.rec-area-btn').forEach(b=>b.classList.remove('active'));
      if(paisSel) paisSel.value='';
      renderRecursos();
    });
    document.getElementById('rec-pais-sel').addEventListener('change', renderRecursos);

    renderRecursos();
  }catch(err){
    console.error('Error recursos:', err);
    if(info) info.textContent='Error al cargar recursos: '+err.message;
  }
}

function renderRecursos(){
  const search=(document.getElementById('rec-search')?.value||'').toLowerCase();
  const activeAreaBtn=document.querySelector('.rec-area-btn.active');
  const area=activeAreaBtn?activeAreaBtn.dataset.area:'';
  const pais=document.getElementById('rec-pais-sel')?.value||'';

  let filtered=recursos.filter(r=>{
    if(search&&!r.nombre.toLowerCase().includes(search)&&!r.proyectosDetalle.some(p=>p.nombre.toLowerCase().includes(search))) return false;
    if(area&&r.area!==area) return false;
    if(pais&&r.pais!==pais) return false;
    return true;
  });

  const total=filtered.length;
  const alta=filtered.filter(r=>r.horasPend>=40).length;
  const media=filtered.filter(r=>r.horasPend>=20&&r.horasPend<40).length;
  const baja=filtered.filter(r=>r.horasPend<20).length;
  const totalH=filtered.reduce((a,r)=>a+r.horasPend,0);
  const totalE=filtered.reduce((a,r)=>a+r.entregasPend,0);
  const sk=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  sk('rec-kpi-total',total||'—'); sk('rec-kpi-alta',alta||'0'); sk('rec-kpi-media',media||'0');
  sk('rec-kpi-baja',baja||'0'); sk('rec-kpi-horas',totalH?totalH+'h':'—'); sk('rec-kpi-entregas',totalE||'—');

  const info=document.getElementById('rec-table-info');
  if(info) info.textContent=`Mostrando ${filtered.length} de ${recursos.length} recursos`;
  const tbody=document.getElementById('rec-table-body');
  if(!tbody) return;
  if(!filtered.length){
    tbody.innerHTML=`<tr><td colspan="9" class="rec-empty">
      ${recursos.length===0?'Los datos de recursos se cargarán al abrir esta pestaña':'Sin resultados para los filtros aplicados'}
    </td></tr>`;
    return;
  }

  // Área badge helper
  function areaClass(a){
    const m={'Desarrollo':'rec-area-desarrollo','Data':'rec-area-data','PMO':'rec-area-pmo','PM':'rec-area-pm','Torre de Control':'rec-area-torre','Soporte TI':'rec-area-soporte'};
    return m[a]||'rec-area-default';
  }

  tbody.innerHTML=filtered.map(r=>{
    const hClass=r.horasPend>=40?'rec-hours-high':r.horasPend>=20?'rec-hours-med':r.horasPend>0?'rec-hours-low':'rec-hours-zero';
    const eClass=r.entregasPend>10?'rec-entregas-high':'rec-entregas-low';
    const totalH2=r.horasCerr+r.horasPend+r.horasLibre;
    const pCerr=totalH2>0?(r.horasCerr/totalH2*100).toFixed(1):0;
    const pPend=totalH2>0?(r.horasPend/totalH2*100).toFixed(1):0;
    const ocupPct=totalH2>0?Math.round((r.horasCerr+r.horasPend)/totalH2*100):0;
    const ocupColor=ocupPct>=90?'var(--red)':ocupPct>=70?'var(--yellow)':'var(--green)';
    const areaBadge=r.area?`<span class="rec-area-badge ${areaClass(r.area)}">${esc(r.area)}</span>`:'—';
    const distBar=`<div class="rec-dist-cell">
      <div style="position:relative">
        <div class="rec-dist-bar-wrap">
          <div class="rec-dist-cerr" style="width:${pCerr}%"></div>
          <div class="rec-dist-pend" style="width:${pPend}%"></div>
        </div>
        <div style="position:absolute;right:4px;top:-1px;font-size:10px;font-weight:700;color:${ocupColor}">${ocupPct}%</div>
      </div>
      <div class="rec-dist-labels">
        <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--green)"></span>${r.horasCerr}h cerr.</span>
        <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--yellow)"></span>${r.horasPend}h pend.</span>
        <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--bg-elevated);border:1px solid var(--border)"></span>${r.horasLibre}h libre</span>
      </div>
    </div>`;
    const bloqHtml=r.bloqueantes>0?`<span class="rec-bloq rec-bloq-warn">⚠ ${r.bloqueantes}</span>`:`<span class="rec-bloq rec-bloq-ok">✓</span>`;
    const hoyIso = new Date().toISOString().slice(0,10);
    const enVacRec = estaDeVacaciones(r.nombre, hoyIso);
    const vacBadgeRec = enVacRec ? ' <span style="background:rgba(99,102,241,.2);color:#818cf8;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:4px">V</span>' : '';
    return `<tr${enVacRec ? ' style="opacity:.7"' : ''}>
      <td><span class="rec-name">${esc(r.nombre)}</span>${vacBadgeRec}</td>
      <td>${areaBadge}</td>
      <td style="text-align:center">${r.proyectos}</td>
      <td><span class="${hClass}">${r.horasPend}h</span></td>
      <td style="color:var(--text-muted)">${r.horasTotal}h</td>
      <td><span class="${eClass}">${r.entregasPend}</span></td>
      <td>${distBar}</td>
      <td>${bloqHtml}</td>
      <td><button class="rec-ver-btn" onclick="verRecurso('${esc(r.nombre)}')">Ver →</button></td>
    </tr>`;
  }).join('');
}

// ── RECURSO DETAIL MODAL ───────────────────────────────────
function verRecurso(nombre){
  const r=recursos.find(x=>x.nombre===nombre);
  if(!r) return;
  activeRecIdx=recursos.indexOf(r);
  document.getElementById('rec-modal-name').textContent=r.nombre;
  document.getElementById('rec-modal-area').textContent=r.area||'—';
  const proyectos=r.proyectosDetalle||[];
  const totalHrs=proyectos.reduce((a,p)=>a+(p.horasTotal||0),0);
  const statsHtml=`<div class="rec-modal-stats">
    <div class="rec-modal-stat"><div class="rec-modal-stat-val c-blue">${r.proyectos}</div><div class="rec-modal-stat-lbl">Proyectos</div></div>
    <div class="rec-modal-stat"><div class="rec-modal-stat-val" style="color:${r.horasPend>=40?'var(--red)':r.horasPend>=20?'var(--yellow)':'var(--green)'}">${r.horasPend}h</div><div class="rec-modal-stat-lbl">Horas Pend.</div></div>
    <div class="rec-modal-stat"><div class="rec-modal-stat-val" style="color:${r.entregasPend>10?'var(--red)':'var(--green)'}">${r.entregasPend}</div><div class="rec-modal-stat-lbl">Entregas Pend.</div></div>
  </div>`;
  let partRows=proyectos.length&&totalHrs>0
    ? proyectos.map(p=>{const pct=Math.round((p.horasTotal/totalHrs)*100);return`<div class="rec-part-row"><span class="rec-part-name" title="${esc(p.nombre)}">${esc(p.nombre)}</span><div class="rec-part-bar-wrap"><div class="rec-part-bar-fill" style="width:${pct}%"></div></div><span class="rec-part-pct">${pct}%</span><span class="rec-part-hrs">${p.horasTotal}h</span></div>`;}).join('')+`<div class="rec-part-total">Total: ${totalHrs}h</div>`
    : '<div style="color:var(--text-dim);font-size:12px">Sin datos</div>';
  let projCards=proyectos.length
    ? proyectos.map((p,i)=>`<div class="rec-proj-card">
        <div class="rec-proj-card-left">
          <div class="rec-proj-card-name">${esc(p.nombre)}</div>
          <div class="rec-proj-card-meta">${p.actividades} act · ${p.horasTotal}h · ${p.horasPend}h pend.</div>
        </div>
        <span class="rec-proj-pend-badge ${p.pendientes>0?'has-pend':'no-pend'}">${p.pendientes} pend.</span>
        <button class="rec-proj-link" title="Ver detalle" onclick="verProyecto(${i});event.stopPropagation()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
      </div>`).join('')
    : '<div style="color:var(--text-dim);font-size:12px">Sin proyectos registrados</div>';
  document.getElementById('rec-modal-body').innerHTML=`${statsHtml}
    <div style="margin-bottom:20px">
      <div class="rec-section-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>Participación por proyecto</div>
      ${partRows}
    </div>
    <div>
      <div class="rec-section-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Proyectos · Actividades</div>
      ${projCards}
    </div>`;
  document.getElementById('rec-modal-overlay').classList.add('open');
}

// Clasificación de estado de actividades en detalle de proyecto
function clsActStatus(status) {
  const s = (status||'').toLowerCase();
  if(['finalizada','producción','en producción','cerrado','done','closed'].includes(s)) return { label:'Cerrado',    cls:'done' };
  if(['blocked','bloqueado'].includes(s))                                               return { label:'Bloqueado',  cls:'bloq' };
  if(['en curso','review','en proceso'].includes(s))                                    return { label:'En proceso', cls:'open' };
  return { label:'Pendiente', cls:'pend' };
}

function verProyecto(epicIdx){
  const r=recursos[activeRecIdx]; if(!r) return;
  const p=(r.proyectosDetalle||[])[epicIdx]; if(!p) return;
  const epicaGlobal=epics.find(e=>e.key===p.key);
  const estado=epicaGlobal?epicaGlobal.status:'—';
  const area=epicaGlobal?epicaGlobal.area:(r.area||'—');
  const sponsor=epicaGlobal?epicaGlobal.sponsor:'—';
  const avance=epicaGlobal?(epicaGlobal.planPct!=null&&epicaGlobal.realPct!=null
    ?Math.round(epicaGlobal.realPct*100)+'% / Plan '+Math.round(epicaGlobal.planPct*100)+'%'
    :epicaGlobal.pctDesarrollo!=null?Math.round(epicaGlobal.pctDesarrollo*100)+'%':'—'):'—';
  const fin=epicaGlobal?fmtD(epicaGlobal.duedate):'—';
  const desvioPct=epicaGlobal&&epicaGlobal.desvioPct!=null?Math.round(epicaGlobal.desvioPct*100):null;
  const desvColor=desvioPct===null?'var(--text-muted)':Math.abs(desvioPct)>17?'var(--red)':Math.abs(desvioPct)>=5?'var(--yellow)':'var(--green)';
  const sbCls={'Backlog':'backlog','Análisis':'analisis','Desarrollo':'desarrollo','Pruebas':'pruebas','Producción':'produccion','Planificado':'planificado','Stand by':'standby','Desestimado':'desestimado'}[estado]||'backlog';
  const tareas=(p.tareas||[]).slice().sort((a,b)=>(b.updated||b.fecha||'').localeCompare(a.updated||a.fecha||''));
  const tareasHtml=tareas.length
    ?tareas.map(t=>{ const st=clsActStatus(t.status); return `<div class="det-task-row"><span class="det-task-date">${fmtD(t.fecha)||'—'}</span><span class="det-task-name" title="${esc(t.nombre)}">${esc(t.nombre)}</span><span class="det-task-hrs">${t.horasEst}h</span><span class="det-task-status"><span class="det-badge det-badge-${st.cls}">${st.label}</span></span></div>`; }).join('')
    :'<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Sin actividades registradas</div>';
  document.getElementById('det-title').textContent=p.nombre;
  document.getElementById('det-body').innerHTML=`
    <div class="det-stats">
      <div class="det-stat"><div class="det-stat-val" style="color:var(--blue)">${p.actividades}</div><div class="det-stat-lbl">Actividades</div></div>
      <div class="det-stat"><div class="det-stat-val" style="color:${p.horasPend>=40?'var(--red)':p.horasPend>=20?'var(--yellow)':'var(--green)'}">${p.horasPend}h</div><div class="det-stat-lbl">Horas Pend.</div></div>
      <div class="det-stat"><div class="det-stat-val" style="color:var(--blue)">${p.horasTotal}h</div><div class="det-stat-lbl">Horas Total</div></div>
    </div>
    <div class="det-sec">
      <div class="det-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Proyecto</div>
      <div class="det-field"><span class="det-lbl">Estado</span><span class="det-val"><span class="badge badge-${sbCls}">${esc(estado)}</span></span></div>
      <div class="det-field"><span class="det-lbl">Área</span><span class="det-val">${esc(area)||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Sponsor</span><span class="det-val">${esc(sponsor)||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Avance</span><span class="det-val">${avance}</span></div>
      <div class="det-field"><span class="det-lbl">Fin</span><span class="det-val">${fin||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Desvío</span><span class="det-val" style="color:${desvColor};font-weight:600">${desvioPct!==null?desvioPct+'%':'—'}</span></div>
    </div>
    <div class="det-sec">
      <div class="det-sec-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>Actividades de ${esc(r.nombre)}</div>
      ${tareasHtml}
    </div>`;
  document.getElementById('det-panel').classList.add('open');
}

function closeDetModal(){ document.getElementById('det-panel')?.classList.remove('open'); }
function closeRecModal(){ document.getElementById('rec-modal-overlay')?.classList.remove('open'); }

document.getElementById('det-close').addEventListener('click', ev=>{ ev.stopPropagation(); closeDetModal(); });
document.getElementById('rec-modal-close').addEventListener('click', ev=>{ ev.stopPropagation(); closeRecModal(); });
document.getElementById('rec-modal-overlay').addEventListener('click', function(ev){ if(ev.target===this) closeRecModal(); });

document.addEventListener('keydown', ev=>{
  if(ev.key!=='Escape') return;
  const det=document.getElementById('det-panel');
  if(det&&det.classList.contains('open')){ closeDetModal(); return; }
  const rec=document.getElementById('rec-modal-overlay');
  if(rec&&rec.classList.contains('open')){ closeRecModal(); return; }
  const mo=document.getElementById('modal-overlay');
  if(mo&&mo.classList.contains('open')) mo.classList.remove('open');
});

// ── ROW CLICK portafolio ────────────────────────────────────
document.getElementById('table-body').addEventListener('click', ev=>{
  const tr=ev.target.closest('tr[data-key]');
  if(tr&&!ev.target.closest('a,button')) openModal(tr.dataset.key);
});

// ═══════════════════════════════════════════════════════════
//  CAPACITY TAB  — Calendario de capacidad por recurso
// ═══════════════════════════════════════════════════════════

const NOMENCLATURA = {
  'AM':  { nombre: 'Andrés Medina',      pais: 'Mexico',    area: 'Desarrollo' },
  'JC':  { nombre: 'Javier Carrillo',    pais: 'Mexico',    area: 'Desarrollo' },
  'EC':  { nombre: 'Eric Cacho',         pais: 'Mexico',    area: 'Desarrollo' },
  'HS':  { nombre: 'Henry Salazar',      pais: 'Colombia',  area: 'Desarrollo' },
  'DV':  { nombre: 'Daniel Valencia',    pais: 'Colombia',  area: 'Desarrollo' },
  'SD':  { nombre: 'Steven Díaz',        pais: 'Colombia',  area: 'Desarrollo', alias: ['stiven d','stiven diaz','steven d'] },
  'AR':  { nombre: 'Alexander Romero',   pais: 'Peru',      area: 'Desarrollo' },
  'HR':  { nombre: 'Hamhner Remuzgo',    pais: 'Peru',      area: 'Soporte TI' },
  'AA':  { nombre: 'Abel Alva',          pais: 'Peru',      area: 'PMO' },
  'RP':  { nombre: 'Roxana Peralta',     pais: 'Peru',      area: 'PM' },
  'ALL': { nombre: 'Alberto Llosa',      pais: 'Peru',      area: 'PM' },
  'FF':  { nombre: 'Farah Fidel',        pais: 'Mexico',    area: 'Comercial' },
  'JM':  { nombre: 'Juan Menco',         pais: 'Colombia',  area: 'Comercial' },
  'CC':  { nombre: 'Cesar Castañeda',    pais: 'Peru',      area: 'TC' },
  'EN':  { nombre: 'Edgar Noriega',      pais: 'Colombia',  area: 'TC' },
  'JC2': { nombre: 'Jose Carlos Cautle', pais: 'Mexico',    area: 'TC' },
  'MA':  { nombre: 'Maria Aguilar',      pais: 'Guatemala', area: 'TC' },
  'NB':  { nombre: 'Nalia Blanco',       pais: 'Peru',      area: 'Comercial' },
  'DV2': { nombre: 'Daniela Velarde',    pais: 'Peru',      area: 'Data' },
  'LE':  { nombre: 'Lucia Escobar',      pais: 'Colombia',  area: 'Operación' },
};

// Vacaciones por persona: { 'Nombre': [['YYYY-MM-DD','YYYY-MM-DD'], ...] }
const VACACIONES = {
  'Eric Cacho': [
    ['2026-07-11', '2026-07-25'],
    ['2026-12-21', '2026-12-31']
  ],
  'Javier Carrillo': [
    ['2026-07-07', '2026-07-10']
  ]
};

function estaDeVacaciones(nombre, fecha) {
  const rangos = VACACIONES[nombre];
  if (!rangos) return false;
  return rangos.some(([ini, fin]) => fecha >= ini && fecha <= fin);
}

const APLICACIONES_JIRA = ['Qubo','Robots','Simulador','T1','T2','TC','Viax'];

const FERIADOS = {
  'Peru': new Set([
    '2025-01-01','2025-04-17','2025-04-18','2025-05-01','2025-06-07',
    '2025-06-29','2025-07-23','2025-07-28','2025-07-29','2025-08-06',
    '2025-08-30','2025-10-08','2025-11-01','2025-12-08','2025-12-09','2025-12-25',
    '2026-01-01','2026-04-02','2026-04-03','2026-05-01','2026-06-07',
    '2026-06-29','2026-07-23','2026-07-28','2026-07-29','2026-08-06',
    '2026-08-30','2026-10-08','2026-11-01','2026-12-08','2026-12-09','2026-12-25',
  ]),
  'Colombia': new Set([
    '2025-01-01','2025-01-06','2025-03-24','2025-04-17','2025-04-18',
    '2025-05-01','2025-06-02','2025-06-23','2025-06-30','2025-07-07',
    '2025-07-20','2025-08-07','2025-08-18','2025-10-13','2025-11-03',
    '2025-11-17','2025-12-08','2025-12-25',
    '2026-01-01','2026-01-12','2026-03-23','2026-04-02','2026-04-03',
    '2026-05-01','2026-05-18','2026-06-08','2026-06-15','2026-06-29',
    '2026-07-13','2026-07-20','2026-08-07','2026-08-17','2026-10-12','2026-11-02',
    '2026-11-16','2026-12-08','2026-12-25',
  ]),
  'Mexico': new Set([
    '2025-01-01','2025-02-03','2025-03-17','2025-05-01','2025-09-16',
    '2025-11-17','2025-12-25',
    '2026-01-01','2026-02-02','2026-03-16','2026-05-01','2026-09-16',
    '2026-11-16','2026-12-25',
  ]),
  'Guatemala': new Set([
    '2025-01-01','2025-04-17','2025-04-18','2025-04-19','2025-05-01',
    '2025-06-30','2025-09-15','2025-10-20','2025-11-01','2025-12-24','2025-12-25','2025-12-31',
    '2026-01-01','2026-04-02','2026-04-03','2026-04-04','2026-05-01',
    '2026-06-30','2026-09-15','2026-10-20','2026-11-01','2026-12-24','2026-12-25','2026-12-31',
  ]),
};

function resolveNombreDesdeJira(displayName) {
  if(!displayName) return null;
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  const dn = norm(displayName);
  // 1. Exacto normalizado
  for(const [ini, rec] of Object.entries(NOMENCLATURA)){
    if(norm(rec.nombre) === dn) return { ini, ...rec };
  }
  // 2. displayName contenido en nombre canónico o viceversa
  for(const [ini, rec] of Object.entries(NOMENCLATURA)){
    const cn = norm(rec.nombre);
    if(dn.includes(cn) || cn.includes(dn)) return { ini, ...rec };
  }
  // 3. Primera palabra + inicial de apellido (ej. "Henry S." → "Henry Salazar", "Stiven D" → "Steven Díaz")
  const parts = dn.split(/\s+/);
  if(parts.length >= 2){
    for(const [ini, rec] of Object.entries(NOMENCLATURA)){
      const cp = norm(rec.nombre).split(/\s+/);
      if(cp[0] === parts[0] && cp[1] && cp[1].startsWith(parts[1].replace('.',''))) return { ini, ...rec };
    }
  }
  return null;
}
function resolveNombreDesdeIni(ini) {
  if(!ini) return null;
  const key = ini.trim().toUpperCase();
  return NOMENCLATURA[key] ? { ini: key, ...NOMENCLATURA[key] } : null;
}
function distribuirHoras(horasTotal, fechaInicio, fechaFin, pais) {
  if(!horasTotal || !fechaInicio || !fechaFin) return [];
  const feriados = FERIADOS[pais] || new Set();
  const dias = [];
  const cur = new Date(fechaInicio + 'T12:00:00');
  const end = new Date(fechaFin   + 'T12:00:00');
  while(cur <= end){
    const dow = cur.getDay();
    const iso = cur.toISOString().slice(0,10);
    if(dow !== 0 && dow !== 6 && !feriados.has(iso)) dias.push(iso);
    cur.setDate(cur.getDate()+1);
  }
  if(!dias.length) return [];
  const hPorDia = +(horasTotal / dias.length).toFixed(2);
  return dias.map(fecha => ({ fecha, horas: hPorDia }));
}

// ── State ──────────────────────────────────────────────────
let capacityLoaded = false;
let capRows = [];  // {fecha, persona, horas, proyecto, subtarea, comentario, esPlaneado}
let capCalYear  = TODAY.getFullYear();
let capCalMonth = TODAY.getMonth(); // 0-based

// ── Tab lazy load ──────────────────────────────────────────
document.querySelectorAll('.tabs .tab').forEach(tab => {
  if(tab.dataset.tab === 'capacity') {
    tab.addEventListener('click', () => {
      if(!capacityLoaded) loadCapacity();
    });
  }
});

// ── Load from API ──────────────────────────────────────────
async function loadCapacity(){
  capacityLoaded = true;
  const wrap = document.getElementById('cap-cal-wrap');
  if(wrap) wrap.innerHTML = '<div class="cap-empty" style="padding:40px;text-align:center;color:var(--text-dim)">Cargando desde Jira…</div>';
  try {
    const resp = await fetch('/api/jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'capacity' })
    });
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();

    capRows = [];
    (j.issues || []).forEach(sub => {
      const f = sub.fields || {};
      const subtareaNom = f.summary || sub.key;
      const proyectoNom  = f._epicName   || '';
      const codigoProy   = f._epicCodigo || '';
      const logs = f._worklogs || [];

      // Solo mostrar subtareas con horas registradas en "Registro de actividad" de Jira
      // Si logs está vacío = el recurso no registró actividad → no aparece en el calendario
      if(logs.length > 0){
        logs.forEach(wl => {
          const horas    = wl.timeSpentSeconds ? +(wl.timeSpentSeconds / 3600).toFixed(2) : 0;
          const fechaIso = wl.started ? wl.started.slice(0,10) : null;
          const persona  = wl.author?.displayName || wl.updateAuthor?.displayName || '—';
          let comentario = '';
          if(wl.comment){
            if(typeof wl.comment === 'string') comentario = wl.comment;
            else if(wl.comment.content) comentario = adfToText(wl.comment).trim();
          }
          const recReal = resolveNombreDesdeJira(persona);
          const personaNom = recReal?.nombre || persona; // usar nombre canónico de NOMENCLATURA
          capRows.push({
            fecha: fechaIso, persona: personaNom, horas,
            proyecto: proyectoNom, codigoProy, subKey: sub.key, subtarea: subtareaNom,
            comentario, esPlaneado: false,
            area: recReal?.area || '', pais: recReal?.pais || ''
          });
        });
      }
    });

    // Populate selectors from actual data
    const selA = document.getElementById('cap-area');

    // Áreas desde NOMENCLATURA + las que haya en capRows
    const areasNom = [...new Set(Object.values(NOMENCLATURA).map(n=>n.area).filter(Boolean))].sort();
    const areasRows = [...new Set(capRows.map(r => r.area).filter(Boolean))];
    const areas = [...new Set([...areasNom, ...areasRows])].sort();
    if(selA) selA.innerHTML = '<option value="">Todas</option>' + areas.map(a => `<option>${esc(a)}</option>`).join('');

    // Países desde NOMENCLATURA (fuente de verdad) + los que haya en capRows
    const paisesNom = [...new Set(Object.values(NOMENCLATURA).map(n=>n.pais).filter(Boolean))].sort();
    const paisesRows = [...new Set(capRows.map(r => r.pais).filter(Boolean))];
    const paises = [...new Set([...paisesNom, ...paisesRows])].sort();
    const selP = document.getElementById('cap-pais');
    if(selP) selP.innerHTML = '<option value="">Todos</option>' + paises.map(p => `<option>${esc(p)}</option>`).join('');

    // Personas desde NOMENCLATURA + las que haya en capRows
    const personasNom = Object.values(NOMENCLATURA).map(n=>n.nombre).filter(Boolean);
    const personasRows = [...new Set(capRows.map(r => r.persona).filter(Boolean))];
    const personas = [...new Set([...personasNom, ...personasRows])].sort();
    const sel = document.getElementById('cap-persona');
    if(sel) sel.innerHTML = '<option value="">Todas</option>' + personas.map(p => `<option>${esc(p)}</option>`).join('');

    // Set calendar to month with most data
    if(capRows.length){
      const fechas = capRows.map(r => r.fecha).filter(Boolean).sort();
      const mid = fechas[Math.floor(fechas.length/2)];
      const d = new Date(mid + 'T12:00:00');
      capCalYear  = d.getFullYear();
      capCalMonth = d.getMonth();
    }

    initCalNav();
    renderCapacity();
  } catch(err) {
    console.error('Error capacity:', err);
    const wrap = document.getElementById('cap-cal-wrap');
    if(wrap) wrap.innerHTML = `<div class="cap-empty" style="padding:40px;text-align:center;color:var(--red)">Error: ${esc(err.message)}</div>`;
  }
}

// ── Calendar navigation ────────────────────────────────────
function initCalNav(){
  // Populate month/year selectors
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const mSel = document.getElementById('cap-cal-month');
  const ySel = document.getElementById('cap-cal-year');
  if(mSel) mSel.innerHTML = MONTHS.map((m,i) => `<option value="${i}">${m}</option>`).join('');
  if(ySel){
    const years = [...new Set(capRows.map(r => r.fecha?.slice(0,4)).filter(Boolean))].sort();
    if(!years.length) years.push(String(TODAY.getFullYear()));
    ySel.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  }
  syncCalNav();

  document.getElementById('cap-cal-prev')?.addEventListener('click', () => {
    capCalMonth--; if(capCalMonth < 0){ capCalMonth=11; capCalYear--; }
    syncCalNav(); renderCapacity();
  });
  document.getElementById('cap-cal-next')?.addEventListener('click', () => {
    capCalMonth++; if(capCalMonth > 11){ capCalMonth=0; capCalYear++; }
    syncCalNav(); renderCapacity();
  });
  document.getElementById('cap-cal-month')?.addEventListener('change', e => {
    capCalMonth = +e.target.value; renderCapacity();
  });
  document.getElementById('cap-cal-year')?.addEventListener('change', e => {
    capCalYear = +e.target.value; renderCapacity();
  });
}

function syncCalNav(){
  const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  const title = document.getElementById('cap-cal-title');
  if(title) title.textContent = `${MONTHS[capCalMonth]} ${capCalYear}`;
  const mSel = document.getElementById('cap-cal-month');
  const ySel = document.getElementById('cap-cal-year');
  if(mSel) mSel.value = capCalMonth;
  if(ySel) ySel.value = capCalYear;
}

// ── Filters ────────────────────────────────────────────────
function getCapFiltered(){
  const persona = document.getElementById('cap-persona')?.value || '';
  const area    = document.getElementById('cap-area')?.value    || '';
  const pais    = document.getElementById('cap-pais')?.value    || '';
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').trim();
  return capRows.filter(r => {
    if(persona && r.persona !== persona) return false;
    if(pais    && r.pais    !== pais)    return false;
    if(area) {
      // Resolver área desde NOMENCLATURA por nombre del recurso (fuente de verdad)
      const recNom = findNomenclaturaByNombre(r.persona);
      const areaRec = recNom?.area || r.area || '';
      if(areaRec !== area) return false;
    }
    return true;
  });
}

['cap-area','cap-pais','cap-persona','cap-orden'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('change', renderCapacity);
});
document.getElementById('cap-limpiar')?.addEventListener('click', () => {
  const a  = document.getElementById('cap-area');    if(a)  a.value='';
  const pa = document.getElementById('cap-pais');    if(pa) pa.value='';
  const p  = document.getElementById('cap-persona'); if(p)  p.value='';
  const o  = document.getElementById('cap-orden');   if(o)  o.value='nombre';
  renderCapacity();
});

// ── Main render: calendar ──────────────────────────────────
function renderCapacity(){
  const filtered = getCapFiltered();
  const orden    = document.getElementById('cap-orden')?.value || 'nombre';

  // Global KPIs — solo horas reales de Jira
  const totalHoras = filtered.reduce((s,r) => s+r.horas, 0);
  // Normalizar nombres: resolver alias/abreviados al nombre canónico de NOMENCLATURA
  let personasSet  = [...new Set(filtered.map(r => findNomenclaturaByNombre(r.persona)?.nombre || r.persona))];

  // Weekly utilization per persona (all time)
  function isoWeek(iso){
    if(!iso) return null;
    const d = new Date(iso+'T12:00:00');
    const jan1 = new Date(d.getFullYear(),0,1);
    const wk = Math.ceil(((d - jan1)/864e5 + jan1.getDay()+1)/7);
    return `${d.getFullYear()}-W${String(wk).padStart(2,'0')}`;
  }

  const weeksByPersona = {};
  filtered.forEach(r => {
    if(!r.fecha) return;
    const wk = isoWeek(r.fecha);
    if(!weeksByPersona[r.persona]) weeksByPersona[r.persona] = {};
    if(!weeksByPersona[r.persona][wk]) weeksByPersona[r.persona][wk] = 0;
    weeksByPersona[r.persona][wk] += r.horas;
  });

  // Total horas por persona para ordenamiento
  const horasPorPersona = {};
  personasSet.forEach(p => {
    horasPorPersona[p] = filtered.filter(r=>r.persona===p).reduce((s,r)=>s+r.horas,0);
  });

  // Avg weekly util
  const avgUtils = {};
  personasSet.forEach(p => {
    const wks = Object.values(weeksByPersona[p] || {});
    avgUtils[p] = wks.length ? +(wks.reduce((a,b)=>a+b,0)/wks.length/40*100).toFixed(1) : 0;
  });
  const avgUtilTotal = personasSet.length
    ? +(personasSet.reduce((s,p) => s + avgUtils[p], 0) / personasSet.length).toFixed(1)
    : 0;

  // Incluir recursos de NOMENCLATURA que coincidan con filtros aunque no tengan worklogs
  const paisFiltro    = document.getElementById('cap-pais')?.value    || '';
  const personaFiltro = document.getElementById('cap-persona')?.value || '';
  const areaFiltro    = document.getElementById('cap-area')?.value    || '';
  if(paisFiltro || personaFiltro || areaFiltro) {
    Object.values(NOMENCLATURA).forEach(n => {
      if(paisFiltro    && n.pais   !== paisFiltro)    return;
      if(personaFiltro && n.nombre !== personaFiltro) return;
      if(areaFiltro    && n.area   !== areaFiltro)    return;
      if(!personasSet.includes(n.nombre)) personasSet.push(n.nombre);
    });
  }

  // Sort personas
  personasSet.sort((a,b) => {
    const recA = Object.values(NOMENCLATURA).find(n=>n.nombre===a) || {};
    const recB = Object.values(NOMENCLATURA).find(n=>n.nombre===b) || {};
    if(orden==='horas_desc') return horasPorPersona[b] - horasPorPersona[a];
    if(orden==='horas_asc')  return horasPorPersona[a] - horasPorPersona[b];
    if(orden==='area')       return (recA.area||'').localeCompare(recB.area||'');
    if(orden==='pais')       return (recA.pais||'').localeCompare(recB.pais||'');
    return a.localeCompare(b); // nombre
  });

  const sk = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  sk('cap-kpi-personas', personasSet.length || '—');
  sk('cap-kpi-horas',    totalHoras ? totalHoras.toFixed(1)+'h' : '—');
  sk('cap-kpi-planeadas','—');
  sk('cap-kpi-util',     avgUtilTotal ? avgUtilTotal+'%' : '—');

  // Build calendar for capCalYear / capCalMonth
  renderCalendar(filtered, personasSet, weeksByPersona);
}

function findNomenclaturaByNombre(nombre) {
  if(!nombre) return null;
  const norm = s => (s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();
  const dn = norm(nombre);
  // 1. Exacto
  for(const [ini, rec] of Object.entries(NOMENCLATURA)){
    if(norm(rec.nombre) === dn) return { ini, ...rec };
  }
  // 2. Contenido
  for(const [ini, rec] of Object.entries(NOMENCLATURA)){
    const cn = norm(rec.nombre);
    if(dn.includes(cn) || cn.includes(dn)) return { ini, ...rec };
  }
  // 3. Primer nombre + inicial apellido (ej. "Henry S." → "Henry Salazar")
  const parts = dn.split(/\s+/);
  if(parts.length >= 2){
    for(const [ini, rec] of Object.entries(NOMENCLATURA)){
      const cp = norm(rec.nombre).split(/\s+/);
      if(cp[0] === parts[0] && cp[1] && cp[1].startsWith(parts[1].replace('.',''))) return { ini, ...rec };
    }
  }
  // 4. Alias explícitos (para nombres con ortografía distinta en Jira)
  for(const [ini, rec] of Object.entries(NOMENCLATURA)){
    if((rec.alias||[]).some(a => norm(a) === dn)) return { ini, ...rec };
  }
  return null;
}

// ── Calendar grid render ───────────────────────────────────
function renderCalendar(filtered, personas, weeksByPersona){
  const wrap = document.getElementById('cap-cal-wrap');
  if(!wrap) return;

  const year = capCalYear, month = capCalMonth;
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  const DOW_LABELS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];

  // Build array of all days in month
  const days = [];
  const cur = new Date(firstDay);
  while(cur <= lastDay){
    days.push(cur.toISOString().slice(0,10));
    cur.setDate(cur.getDate()+1);
  }

  // Index filtered rows by persona+date
  const idx = {}; // idx[persona][fecha] = [rows]
  filtered.forEach(r => {
    if(!r.fecha || !r.fecha.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)) return;
    const pNom = findNomenclaturaByNombre(r.persona)?.nombre || r.persona;
    if(!idx[pNom]) idx[pNom] = {};
    if(!idx[pNom][r.fecha]) idx[pNom][r.fecha] = [];
    idx[pNom][r.fecha].push(r);
  });

  // Personas in this month (those with data OR all if no filter)
  const personasInMonth = personas.length
    ? personas
    : [...new Set(filtered.map(r=>r.persona))].sort();

  if(!personasInMonth.length){
    wrap.innerHTML = '<div class="cap-empty" style="padding:40px;text-align:center;color:var(--text-dim)">Sin datos para este período</div>';
    return;
  }

  // Weekly util for month: persona → week → horas
  function isoWeek(iso){
    const d = new Date(iso+'T12:00:00');
    // Simple week key: Monday-based
    const dayOfWeek = (d.getDay() + 6) % 7; // Mon=0
    const mon = new Date(d); mon.setDate(d.getDate() - dayOfWeek);
    return mon.toISOString().slice(0,10);
  }

  // Compute weekly totals per persona for THIS month
  const weekTotals = {}; // persona → weekStartIso → horas
  const weekSet = new Set();
  filtered.forEach(r => {
    if(!r.fecha) return;
    const d = new Date(r.fecha+'T12:00:00');
    if(d.getFullYear() !== year || d.getMonth() !== month) return;
    const wk = isoWeek(r.fecha);
    weekSet.add(wk);
    const pNomWt = findNomenclaturaByNombre(r.persona)?.nombre || r.persona;
    if(!weekTotals[pNomWt]) weekTotals[pNomWt] = {};
    if(!weekTotals[pNomWt][wk]) weekTotals[pNomWt][wk] = 0;
    weekTotals[pNomWt][wk] += r.horas;
  });
  // Also collect weeks that span into this month from days array
  days.forEach(d => weekSet.add(isoWeek(d)));
  const sortedWeeks = [...weekSet].sort();

  // Group days by week
  const daysByWeek = {};
  days.forEach(d => {
    const wk = isoWeek(d);
    if(!daysByWeek[wk]) daysByWeek[wk] = [];
    daysByWeek[wk].push(d);
  });

  // ── Build table HTML ──────────────────────────────────────
  // Header row 1: week labels spanning their days
  let hdr1 = '<tr class="row-month"><th class="col-persona">Recurso</th>';
  sortedWeeks.forEach((wk, wi) => {
    const wdays = daysByWeek[wk] || [];
    const wkDate = new Date(wk+'T12:00:00');
    const wkLabel = `Sem ${wkDate.toLocaleDateString('es-PE',{day:'2-digit',month:'short'})}`;
    hdr1 += `<th colspan="${wdays.length}" class="col-week-sep">${wkLabel}</th>`;
    hdr1 += `<th class="col-total">Total</th><th class="col-util">Util%</th>`;
  });
  hdr1 += '</tr>';

  // Header row 2: day numbers + DOW
  let hdr2 = '<tr class="row-dow"><th class="col-persona"></th>';
  sortedWeeks.forEach(wk => {
    const wdays = daysByWeek[wk] || [];
    wdays.forEach(d => {
      const dt = new Date(d+'T12:00:00');
      const dow = dt.getDay(); // 0=Sun,6=Sat
      const dayNum = dt.getDate();
      const isWE = dow===0||dow===6;
      hdr2 += `<th style="${isWE?'color:var(--text-dim)':''}">${dayNum}<br><span style="font-size:8px">${DOW_LABELS[dow]}</span></th>`;
    });
    hdr2 += '<th class="col-total"></th><th class="col-util"></th>';
  });
  hdr2 += '</tr>';

  // Body rows: one per persona
  let body = '';
  personasInMonth.forEach(persona => {
    // Buscar en NOMENCLATURA: primero exacto, luego normalizado (sin tildes, minúsculas)
    const pRec = findNomenclaturaByNombre(persona);
    const pais = pRec?.pais || 'Peru';
    const ferPais = FERIADOS[pais] || new Set();

    body += `<tr><td class="col-persona">${esc(persona)}</td>`;
    sortedWeeks.forEach(wk => {
      const wdays = daysByWeek[wk] || [];
      let weekTotal = 0;
      wdays.forEach(d => {
        const dt = new Date(d+'T12:00:00');
        const dow = dt.getDay();
        const isWE = dow===0||dow===6;
        const isFer = ferPais.has(d);
        const rows = (idx[persona] && idx[persona][d]) || [];
        const hTotal = rows.reduce((s,r)=>s+r.horas,0);
        weekTotal += hTotal;

        const isVac = !isWE && estaDeVacaciones(persona, d);
        let cellClass, cellLabel;
        if(isWE){
          cellClass = 'c-weekend'; cellLabel = '—';
        } else if(isVac){
          cellClass = 'c-vacation'; cellLabel = 'V';
        } else if(isFer){
          cellClass = 'c-holiday'; cellLabel = 'F';
        } else if(!rows.length){
          cellClass = 'c-empty'; cellLabel = '-';
        } else if(hTotal === 0){
          cellClass = 'c-zero'; cellLabel = '0';
        } else if(hTotal <= 4){
          cellClass = 'c-low'; cellLabel = hTotal % 1 === 0 ? hTotal : hTotal.toFixed(1);
        } else if(hTotal <= 8){
          cellClass = 'c-med'; cellLabel = hTotal % 1 === 0 ? hTotal : hTotal.toFixed(1);
        } else {
          cellClass = 'c-over'; cellLabel = hTotal % 1 === 0 ? hTotal : hTotal.toFixed(1);
        }

        const clickable = !isWE && !isFer && !isVac && rows.length > 0;
        const cellAttr = clickable
          ? `onclick="openCapDetail('${esc(persona)}','${d}')"  title="${hTotal}h — clic para ver detalle"`
          : '';
        const weekSepClass = wdays[0] === d ? 'week-sep' : '';
        body += `<td class="${weekSepClass}"><div class="cap-cal-cell ${cellClass}" ${cellAttr}>${cellLabel}</div></td>`;
      });

      // Week total + util %
      const wt = weekTotals[persona] ? (weekTotals[persona][wk]||0) : 0;
      const util = wt > 0 ? +(wt/40*100).toFixed(1) : 0;
      const utilCls = util === 0 ? '' : util > 100 ? 'cap-util-over' : util >= 70 ? 'cap-util-ok' : 'cap-util-warn';
      body += `<td class="col-total">${wt > 0 ? wt.toFixed(1) : '—'}</td>`;
      body += `<td class="col-util"><span class="${utilCls}">${util > 0 ? util+'%' : '—'}</span></td>`;
    });
    body += '</tr>';
  });

  wrap.innerHTML = `
    <table class="cap-cal-table">
      <thead>${hdr1}${hdr2}</thead>
      <tbody>${body}</tbody>
    </table>`;
}

// ── Detail drawer ──────────────────────────────────────────
function openCapDetail(persona, fecha){
  const rows = capRows.filter(r => r.persona === persona && r.fecha === fecha);
  if(!rows.length) return;

  const dt = new Date(fecha+'T12:00:00');
  const fechaFmt = dt.toLocaleDateString('es-PE',{weekday:'long',day:'2-digit',month:'long',year:'numeric'});
  const totalH = rows.reduce((s,r)=>s+r.horas,0);

  document.getElementById('cap-detail-title').textContent = persona;
  document.getElementById('cap-detail-sub').textContent   = `${fechaFmt} · ${totalH.toFixed(2)}h total`;

  const tb = document.getElementById('cap-detail-body');
  if(!tb) return;
  tb.innerHTML = rows.map(r => {
    const horasCls = r.horas >= 8 ? 'cap-horas-high' : r.horas >= 4 ? 'cap-horas-med' : 'cap-horas-low';
    const comentario = r.comentario || '—';
    const codigoCell = r.codigoProy
      ? `<span style="font-weight:600;color:var(--blue)">${esc(r.codigoProy)}</span>`
      : '—';
    return `<tr>
      <td style="color:var(--text-muted);white-space:nowrap">${fmtD(r.fecha)||'—'}</td>
      <td><span class="cap-horas-badge ${horasCls}">${r.horas}h</span></td>
      <td style="white-space:nowrap">${codigoCell}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-muted)" title="${esc(r.proyecto||'')}">${esc(r.proyecto||'—')}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(r.subtarea)}">${esc(r.subtarea)}</td>
      <td style="color:var(--text-muted);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(comentario)}">${esc(comentario)}</td>
    </tr>`;
  }).join('');

  document.getElementById('cap-detail-overlay').style.display = 'flex';
}

function closeCapDetail(event){
  if(event && event.target !== document.getElementById('cap-detail-overlay')) return;
  document.getElementById('cap-detail-overlay').style.display = 'none';
}

// ── CSV export ─────────────────────────────────────────────
document.getElementById('btn-export-cap')?.addEventListener('click', () => {
  const filtered = getCapFiltered();
  const hdr  = ['Fecha','Persona','Horas','Proyecto','Actividad (Subtarea)','Comentario','Tipo'];
  const rows = filtered.map(r => [r.fecha||'', r.persona, r.horas, r.proyecto||'', r.subtarea, r.comentario, r.esPlaneado?'Planificado':'Real']);
  downloadCSV([hdr,...rows], `capacity_${new Date().toISOString().slice(0,10)}.csv`);
});

// ── SECCIONES ESPECIALES (Soporte Requerimientos / Gestión PMO-TI) ──────────

const specialStoriesCache = {};

async function fetchSpecialStories(epicKey) {
  if (specialStoriesCache[epicKey] !== undefined) return specialStoriesCache[epicKey];
  try {
    const resp = await fetch('/api/jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'stories', epicKey })
    });
    const data = await resp.json();
    specialStoriesCache[epicKey] = data.stories || [];
  } catch(e) {
    specialStoriesCache[epicKey] = [];
  }
  return specialStoriesCache[epicKey];
}

function parseSpecialStory(s) {
  const f = s.fields || {};
  const isDone = ['done','cerrado','closed','producción','produccion'].includes((f.status?.name||'').toLowerCase());
  const subtasks = f._subtasks || [];
  // HP = suma de customfield_11136 ("Horas estimadas") de subtareas (valor numérico directo)
  const horasPlan = subtasks.reduce((acc, sub) => {
    const sf = sub.fields || {};
    return acc + (sf.customfield_11136 || 0);
  }, 0);
  // HR = suma de timespent de subtareas (en segundos → horas)
  const horasReal = subtasks.reduce((acc, sub) => {
    const sf = sub.fields || {};
    return acc + ((sf.timespent || 0) / 3600);
  }, 0);
  // Plan/Real % de la HU (misma lógica que épicas en bitácora principal)
  const planPct = f.customfield_10725 !== undefined && f.customfield_10725 !== null ? f.customfield_10725 : null;
  const realPct = f.customfield_10726 !== undefined && f.customfield_10726 !== null ? f.customfield_10726 : null;
  // Subtareas parseadas para el Gantt
  const subtasksParsed = subtasks.map(sub => {
    const sf = sub.fields || {};
    return {
      key: sub.key,
      codigo: sf.customfield_10934 || sub.key,
      summary: sf.summary || '—',
      asignado: sf.assignee?.displayName || null,
      fechaInicio: sf.customfield_10015 || null,
      duedate: sf.duedate || null,
      horasPlan: sf.customfield_11136 || 0,
      horasReal: (sf.timespent || 0) / 3600,
      status: sf.status?.name || '—'
    };
  });
  return {
    key: s.key,
    codigo: f.customfield_10934 || s.key,
    summary: f.summary || '—',
    area: f.customfield_10930?.value || null,
    sponsor: f.customfield_11070?.value || null,
    asignado: f.assignee?.displayName || null,
    horasPlan: horasPlan,
    horasReal: horasReal,
    fechaInicio: f.customfield_10015 || null,
    duedate: f.duedate || null,
    status: f.status?.name || '—',
    conformidad: f.customfield_11004?.value || null,
    planPct: planPct,
    realPct: realPct,
    subtasksParsed: subtasksParsed,
    isDone
  };
}

function buildSpecialKpis(stories) {
  const total = stories.length;
  const cerradas = stories.filter(s => s.isDone).length;
  const pendientes = total - cerradas;
  const horasPlanTot = stories.reduce((a, s) => a + (s.horasPlan || 0), 0);
  const horasRealTot = stories.reduce((a, s) => a + (s.horasReal || 0), 0);
  return `
    <div class="sp-kpis">
      <div class="sp-kpi"><div class="sp-kpi-label">Total historias</div><div class="sp-kpi-val c-white">${total}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-label">HP Totales</div><div class="sp-kpi-val c-cyan">${horasPlanTot > 0 ? horasPlanTot.toFixed(1) : '—'}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-label">HR Totales</div><div class="sp-kpi-val c-blue">${horasRealTot > 0 ? horasRealTot.toFixed(1) : '—'}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-label">Cerradas</div><div class="sp-kpi-val c-green">${cerradas}</div></div>
      <div class="sp-kpi"><div class="sp-kpi-label">Pendientes</div><div class="sp-kpi-val c-yellow">${pendientes}</div></div>
    </div>`;
}

function buildSpecialTable(stories, sectionId) {
  if (!stories.length) return '<div style="padding:16px 20px;color:var(--text-muted);font-size:13px">Sin historias encontradas.</div>';

  const searchId = `sp-search-${sectionId}`;
  const tbodyId  = `sp-tbody-${sectionId}`;
  const infoId   = `sp-info-${sectionId}`;

  // AJUSTE 3: Soporte Requerimientos (PTS_327) → columna Plan/Real
  // AJUSTE 4: Gestión PMO-TI (PTS_326) → sin columna % Avance
  const isSoporte = sectionId === 'PTS_327';
  const extraHeader = isSoporte ? '<th>Plan / Real</th>' : '';

  return `
    <div class="sp-table-controls">
      <input id="${searchId}" class="filter-input" placeholder="Buscar historia..." autocomplete="off" style="max-width:260px"
        oninput="filterSpecialTable('${sectionId}')"/>
      <span id="${infoId}" class="sp-info">${stories.length} historias</span>
    </div>
    <div class="table-wrap" style="margin:0">
      <table>
        <thead>
          <tr>
            <th>Código</th>
            <th>Historia</th>
            <th>Área</th>
            <th>Sponsor</th>
            <th>Asignado</th>
            <th>HP</th>
            <th>HR</th>
            <th>Inicio</th>
            <th>Fin</th>
            <th>Estado</th>
            <th>Conform.</th>
            ${extraHeader}
            <th></th>
          </tr>
        </thead>
        <tbody id="${tbodyId}">
          ${renderSpecialRows(stories, isSoporte)}
        </tbody>
      </table>
    </div>`;
}

function renderSpecialRows(stories, isSoporte) {
  const colCount = isSoporte ? 12 : 11;
  return stories.map((s, idx) => {
    const planRealCell = isSoporte
      ? `<td class="muted">${s.planPct !== null ? Math.round(s.planPct * 100) + '% / ' + (s.realPct !== null ? Math.round(s.realPct * 100) + '%' : '—') : '—'}</td>`
      : '';
    const ganttId = `sp-gantt-${s.key.replace('-','_')}`;
    const hasSubtasks = s.subtasksParsed && s.subtasksParsed.length > 0;
    const ganttToggle = hasSubtasks
      ? `<button class="btn-action" type="button" title="Ver subtareas" onclick="toggleSpGantt('${ganttId}')">···</button>`
      : '';
    const ganttRows = hasSubtasks ? s.subtasksParsed.map(sub => `
      <div class="sp-gantt-row">
        <span class="sp-gantt-code"><a class="jlink" href="${JIRA_BASE}${sub.key}" target="_blank">${esc(sub.codigo)}</a></span>
        <span class="sp-gantt-name" title="${esc(sub.summary)}">${esc(sub.summary)}</span>
        <span class="sp-gantt-cell muted">${esc(sub.asignado) || '—'}</span>
        <span class="sp-gantt-cell muted">${fmtD(sub.fechaInicio) || '—'}</span>
        <span class="sp-gantt-cell muted">${fmtD(sub.duedate) || '—'}</span>
        <span class="sp-gantt-cell muted">HP: ${sub.horasPlan > 0 ? sub.horasPlan.toFixed(1)+'h' : '—'}</span>
        <span class="sp-gantt-cell muted">HR: ${sub.horasReal > 0 ? sub.horasReal.toFixed(1)+'h' : '—'}</span>
        <span class="sp-gantt-cell"><span class="badge badge-${sbClass(sub.status)}">${esc(sub.status)}</span></span>
      </div>`).join('') : '';
    const ganttBlock = hasSubtasks ? `
      <tr id="${ganttId}" style="display:none">
        <td colspan="${colCount}" style="padding:0;background:var(--bg-base)">
          <div class="sp-gantt-wrap">${ganttRows}</div>
        </td>
      </tr>` : '';
    return `
    <tr>
      <td class="code"><a class="jlink" href="${JIRA_BASE}${s.key}" target="_blank">${esc(s.codigo)}</a></td>
      <td class="proj" title="${esc(s.summary)}">${esc(s.summary)}</td>
      <td class="muted">${s.area ? `<span class="pill">${esc(s.area)}</span>` : '—'}</td>
      <td class="muted">${esc(s.sponsor) || '—'}</td>
      <td class="muted">${esc(s.asignado) || '—'}</td>
      <td class="muted">${s.horasPlan > 0 ? s.horasPlan.toFixed(1) : '—'}</td>
      <td class="muted">${s.horasReal > 0 ? s.horasReal.toFixed(1) : '—'}</td>
      <td class="muted">${fmtD(s.fechaInicio) || '—'}</td>
      <td class="muted">${fmtD(s.duedate) || '—'}</td>
      <td><span class="badge badge-${sbClass(s.status)}">${esc(s.status)}</span></td>
      <td class="muted">${s.conformidad === 'Si' ? '<span style="color:var(--green);font-size:15px">✓</span>' : '—'}</td>
      ${planRealCell}
      <td style="text-align:center">${ganttToggle}</td>
    </tr>${ganttBlock}`;
  }).join('');
}

function toggleSpGantt(ganttId) {
  const row = document.getElementById(ganttId);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

// Cache de stories parseadas por sección para el filtro
const specialParsedCache = {};

function filterSpecialTable(sectionId) {
  const input = document.getElementById(`sp-search-${sectionId}`);
  const tbody = document.getElementById(`sp-tbody-${sectionId}`);
  const info  = document.getElementById(`sp-info-${sectionId}`);
  if (!input || !tbody) return;
  const q = input.value.toLowerCase();
  const all = specialParsedCache[sectionId] || [];
  const filtered = q ? all.filter(s =>
    s.summary.toLowerCase().includes(q) ||
    s.codigo.toLowerCase().includes(q) ||
    (s.asignado||'').toLowerCase().includes(q) ||
    (s.area||'').toLowerCase().includes(q)
  ) : all;
  tbody.innerHTML = renderSpecialRows(filtered, sectionId === 'PTS_327');
  if (info) info.textContent = `${filtered.length} de ${all.length} historias`;
}

function toggleSpecialSection(sectionId) {
  const body = document.getElementById(`sp-body-${sectionId}`);
  const icon = document.getElementById(`sp-icon-${sectionId}`);
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.textContent = isOpen ? '▶' : '▼';

  // Lazy load: cargar datos al expandir por primera vez
  if (!isOpen && !specialParsedCache[sectionId]) {
    const epicKey = body.dataset.epickey;
    const loadingEl = document.getElementById(`sp-loading-${sectionId}`);
    fetchSpecialStories(epicKey).then(rawStories => {
      const stories = rawStories.map(parseSpecialStory);
      specialParsedCache[sectionId] = stories;
      const container = document.getElementById(`sp-content-${sectionId}`);
      if (container) {
        container.innerHTML = buildSpecialKpis(stories) + buildSpecialTable(stories, sectionId);
      }
    });
  }
}

async function renderSpecialSections() {
  const container = document.getElementById('special-sections-container');
  if (!container) return;

  const entries = Object.entries(SPECIAL_EPICS); // [[key, {label,icon}], ...]
  container.innerHTML = entries.map(([epicKey, meta]) => {
    const sId = epicKey.replace('-', '_');
    return `
      <div class="sp-section">
        <div class="sp-header" onclick="toggleSpecialSection('${sId}')">
          <span class="sp-icon" id="sp-icon-${sId}">▶</span>
          <span class="sp-title">${meta.icon} ${meta.label}</span>
          <span class="sp-hint">Clic para expandir</span>
        </div>
        <div class="sp-body" id="sp-body-${sId}" style="display:none" data-epickey="${epicKey}">
          <div id="sp-content-${sId}">
            <div id="sp-loading-${sId}" style="padding:16px 20px;color:var(--text-muted);font-size:13px">Cargando historias...</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── PESTAÑA ENTREGABLES ─────────────────────────────────────

function getSemaforoEnt(e) {
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const fin = e.duedate ? new Date(e.duedate+'T12:00:00') : null;
  const vencido = fin && fin < hoy;
  const tieneReplan = !!e.replanificacion;
  // 1. Producción (prioridad máxima)
  const statusLow = (e.status||'').toLowerCase();
  if (statusLow === 'producción' || statusLow === 'produccion') return { color:'#3B82F6', label:'Producción', textColor:'#fff', border:'#1D4ED8' };
  // 2. Vencido
  if (vencido)     return { color:'#ef4444', label:'Vencido',       textColor:'#fff' };
  // 3. Replanificado
  if (tieneReplan) return { color:'#F5B800', label:'Replanificado', textColor:'#1a1a1a' };
  // 4. En plazo
  return             { color:'#4ade80', label:'En plazo',      textColor:'#1a1a1a' };
}




// ── TARJETAS STAND BY Y BACKLOG EN ENTREGABLES ──────────────

function renderEntKpiCards() {
  // Reutiliza el mismo renderKpiEjecutivo existente ya en ent-kpi-wrap
  // Agrega tarjetas Stand By y Backlog en ent-cards-wrap
  const wrap = document.getElementById('ent-cards-wrap');
  if (!wrap) return;

  const allEpics = (epics || []).filter(e => !SPECIAL_EPIC_KEYS.includes(e.key));
  const standbyList = allEpics.filter(e => (e.status||'').toLowerCase() === 'stand by');
  const backlogList = allEpics.filter(e => (e.status||'').toLowerCase() === 'backlog');

  // Calcular días promedio en Stand By (desde fechaInicio si existe)
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const diasSB = standbyList.map(e => {
    if (!e.fechaInicio) return null;
    const d = new Date(e.fechaInicio+'T12:00:00');
    return Math.max(0, Math.round((hoy - d) / 86400000));
  }).filter(v => v !== null);
  const avgSB = diasSB.length ? Math.round(diasSB.reduce((a,b)=>a+b,0)/diasSB.length) : null;

  const diasBL = backlogList.map(e => {
    if (!e.fechaInicio) return null;
    const d = new Date(e.fechaInicio+'T12:00:00');
    return Math.max(0, Math.round((hoy - d) / 86400000));
  }).filter(v => v !== null);
  const avgBL = diasBL.length ? Math.round(diasBL.reduce((a,b)=>a+b,0)/diasBL.length) : null;

  wrap.innerHTML = `
    <div class="kpi ent-kpi-clickable" onclick="openEntDrawer('standby')" style="cursor:pointer" title="Ver proyectos Stand By">
      <div class="kpi-label" style="display:flex;align-items:center;gap:5px">
        ${WARN_ICON} Proyectos con Bloqueantes
      </div>
      <div class="kpi-value" style="color:#F5B800">${standbyList.length}</div>
      <div class="kpi-sub">Stand By${avgSB!==null?' · Prom: '+avgSB+'d':''}</div>
    </div>
    <div class="kpi ent-kpi-clickable" onclick="openEntDrawer('backlog')" style="cursor:pointer" title="Ver proyectos Backlog">
      <div class="kpi-label" style="display:flex;align-items:center;gap:5px">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
        Backlog
      </div>
      <div class="kpi-value c-white">${backlogList.length}</div>
      <div class="kpi-sub">Pendientes de iniciar${avgBL!==null?' · Prom: '+avgBL+'d':''}</div>
    </div>`;
}

// Drawer propio para Stand By y Backlog
function openEntDrawer(tipo) {
  const allEpics = (epics || []).filter(e => !SPECIAL_EPIC_KEYS.includes(e.key));
  const lista = tipo === 'standby'
    ? allEpics.filter(e => (e.status||'').toLowerCase() === 'stand by')
    : allEpics.filter(e => (e.status||'').toLowerCase() === 'backlog');

  const titulo = tipo === 'standby' ? 'Proyectos Stand By' : 'Proyectos Backlog';
  const icono = tipo === 'standby'
    ? WARN_ICON
    : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>';

  const epicIcon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#818cf8" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
  const items = lista.map(e => `
    <div class="det-proj-card" onclick="openEntDetalle('${e.key}')" style="cursor:pointer">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        ${epicIcon}
        <a href="${JIRA_BASE}${e.key}" target="_blank" onclick="event.stopPropagation()" style="font-size:11px;font-weight:600;color:var(--blue);text-decoration:none">${esc(e.codigo||e.key)}</a>
      </div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:13px;font-weight:600;color:var(--text-primary)">${esc(e.summary)}</span>
      </div>
      <div style="font-size:11px;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap">
        <span><span class="badge badge-${sbClass(e.status)}">${esc(e.status)}</span></span>
        ${e.sponsor?`<span>Sponsor: ${esc(e.sponsor)}</span>`:''}
        ${e.asignado?`<span>Resp: ${esc(e.asignado)}</span>`:''}
        ${e.duedate?`<span>Fin: ${fmtD(e.duedate)}</span>`:''}
      </div>
    </div>`).join('');

  document.getElementById('ent-drawer-title').textContent = titulo;
  document.getElementById('ent-drawer-body').innerHTML =
    items || '<div style="padding:20px;color:var(--text-muted)">No hay proyectos en este estado.</div>';
  const ov = document.getElementById('ent-drawer-overlay');
  ov.style.display = 'flex';
}

function closeEntDrawer(event) {
  if (event && event.target !== document.getElementById('ent-drawer-overlay')) return;
  document.getElementById('ent-drawer-overlay').style.display = 'none';
  document.getElementById('ent-det-overlay').style.display = 'none';
}

// Panel de detalle dentro del drawer (bitácora, próximos pasos, etc.)
function openEntDetalle(key) {
  const e = (epics||[]).find(x => x.key === key);
  if (!e) return;
  const hoy = new Date(); hoy.setHours(0,0,0,0);

  // Calcular días en estado actual desde fechaInicio
  const diasEst = e.fechaInicio
    ? Math.max(0, Math.round((hoy - new Date(e.fechaInicio+'T12:00:00')) / 86400000))
    : null;

  const bitHtml = e.bitacora
    ? `<div class="log-box">${esc(e.bitacora)}</div>`
    : `<div class="log-box empty">Sin bitácora registrada</div>`;
  const proxHtml = e.proximosPasos
    ? `<div class="log-box">${esc(e.proximosPasos)}</div>`
    : `<div class="log-box empty">Sin próximos pasos definidos</div>`;
  const condHtml = e.condicion
    ? `<div class="log-box">${esc(e.condicion)}</div>`
    : `<div class="log-box empty">Sin información</div>`;

  const ov = document.getElementById('ent-det-overlay');
  document.getElementById('ent-det-nombre').textContent = e.summary;
  document.getElementById('ent-det-body').innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--border-light);margin-bottom:16px;border-radius:6px;overflow:hidden">
      <div style="background:var(--bg-surface);padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Estado</div>
        <span class="badge badge-${sbClass(e.status)}">${esc(e.status)}</span>
      </div>
      <div style="background:var(--bg-surface);padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Días en estado</div>
        <div style="font-size:20px;font-weight:700;color:var(--yellow)">${diasEst!==null?diasEst:'—'}</div>
      </div>
      <div style="background:var(--bg-surface);padding:12px;text-align:center">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;margin-bottom:4px">Fecha Fin</div>
        <div style="font-size:13px;font-weight:600;color:var(--text-primary)">${fmtD(e.duedate)||'—'}</div>
      </div>
    </div>
    <div class="gm-section">
      <div class="gm-item"><span class="gm-lbl">Área</span><span class="gm-val">${esc(e.area)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Sponsor</span><span class="gm-val">${esc(e.sponsor)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Responsable</span><span class="gm-val">${esc(e.asignado)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Fecha Inicio</span><span class="gm-val">${fmtD(e.fechaInicio)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">COND.</span><span class="gm-val">${esc(e.condicion)||'—'}</span></div>
    </div>
    <div class="log-section" style="margin-top:12px">
      <div class="log-title"><div class="log-title-bar" style="background:var(--blue)"></div>Detalles clave</div>
      ${condHtml}
      <div class="log-spacer"></div>
      <div class="log-title"><div class="log-title-bar"></div>Bitácora</div>
      ${bitHtml}
      <div class="log-spacer"></div>
      <div class="log-title"><div class="log-title-bar"></div>Próximos pasos</div>
      ${proxHtml}
    </div>`;
  ov.style.display = 'flex';
  ov.style.flexDirection = 'column';
}

// ── TARJETA KPI EJECUTIVO ENTREGABLES ───────────────────────
function renderKpiEjecutivo() {
  const wrap = document.getElementById('ent-kpi-wrap');
  if (!wrap) return;

  const desde = document.getElementById('ent-desde')?.value || '';
  const hasta  = document.getElementById('ent-hasta')?.value  || '';

  const allEpics = (epics || []).filter(e => !SPECIAL_EPIC_KEYS.includes(e.key));
  const excluded = ['stand by','backlog','desestimado','planificado'];
  const data = allEpics.filter(e => {
    if (!e.duedate) return false;
    if (excluded.includes((e.status||'').toLowerCase())) return false;
    if (desde && e.duedate < desde) return false;
    if (hasta && e.duedate > hasta) return false;
    return true;
  });
  const total = data.length;
  const nStandby = allEpics.filter(e => (e.status||'').toLowerCase()==='stand by').length;
  const nBacklog  = allEpics.filter(e => (e.status||'').toLowerCase()==='backlog').length;

  let nPlazo=0, nProd=0, nReplan=0, nVencido=0;
  data.forEach(e => {
    const s = getSemaforoEnt(e).label;
    if (s==='En plazo')        nPlazo++;
    else if (s==='Producción') nProd++;
    else if (s==='Replanificado') nReplan++;
    else if (s==='Vencido')    nVencido++;
  });

  const pct = n => total ? Math.round(n/total*100) : 0;
  const cumplimiento = pct(nPlazo + nProd);
  const cumColor = cumplimiento>=80?'var(--green)':cumplimiento>=60?'var(--yellow)':'var(--red)';

  const rowInteractive = (onclick, icon, label, num, numColor) =>
    `<div class="ent-kpi-row ent-kpi-btn" onclick="${onclick}" title="Ver proyectos">
      <span class="ent-kpi-lbl">${icon} ${label}</span>
      <div class="ent-kpi-vals"><span class="ent-kpi-num" style="color:${numColor||'var(--text-primary)'}">${num}</span></div>
    </div>`;

  wrap.innerHTML = `
    <div class="ent-kpi-card">
      <div class="ent-kpi-card-title">📊 Indicadores del Portafolio</div>
      <div class="ent-kpi-row">
        <span class="ent-kpi-lbl">📦 Total entregables</span>
        <div class="ent-kpi-vals"><span class="ent-kpi-num">${total}</span></div>
      </div>
      <div class="ent-kpi-row">
        <span class="ent-kpi-lbl"><span style="color:#4ade80">●</span> En plazo</span>
        <div class="ent-kpi-vals"><span class="ent-kpi-num" style="color:#4ade80">${nPlazo}</span><span class="ent-kpi-pct">${pct(nPlazo)}%</span></div>
      </div>
      <div class="ent-kpi-row">
        <span class="ent-kpi-lbl"><span style="color:#3B82F6">●</span> Producción</span>
        <div class="ent-kpi-vals"><span class="ent-kpi-num" style="color:#14B8A6">${nProd}</span><span class="ent-kpi-pct">${pct(nProd)}%</span></div>
      </div>
      <div class="ent-kpi-row">
        <span class="ent-kpi-lbl"><span style="color:#F5B800">●</span> Replanificados</span>
        <div class="ent-kpi-vals"><span class="ent-kpi-num" style="color:#F5B800">${nReplan}</span><span class="ent-kpi-pct">${pct(nReplan)}%</span></div>
      </div>
      <div class="ent-kpi-row">
        <span class="ent-kpi-lbl"><span style="color:#ef4444">●</span> Vencidos</span>
        <div class="ent-kpi-vals"><span class="ent-kpi-num" style="color:#ef4444">${nVencido}</span><span class="ent-kpi-pct">${pct(nVencido)}%</span></div>
      </div>
      ${rowInteractive("openEntDrawer('standby')", WARN_ICON, 'Proyectos con Bloqueantes', nStandby, '#F5B800')}
      ${rowInteractive("openEntDrawer('backlog')", '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>', 'Backlog', nBacklog, 'var(--text-primary)')}
      <hr class="ent-kpi-divider">
      <div class="ent-kpi-cumplimiento">
        <div class="ent-kpi-cum-lbl">📈 Cumplimiento General</div>
        <div class="ent-kpi-cum-val" style="color:${cumColor}">${cumplimiento}%</div>
      </div>
    </div>`;
}

// ── RESUMEN MENSUAL ENTREGABLES ──────────────────────────────
function renderResumenMensual() {
  renderKpiEjecutivo();
  const wrap = document.getElementById('ent-resumen-wrap');
  if (!wrap) return;

  // Todos los entregables sin filtro de fechas, excluyendo Stand By, Backlog y Desestimado
  const EXCLUIR_RESUMEN = ['stand by','standby','stand-by','backlog','desestimado'];
  const data = (epics || []).filter(e => !SPECIAL_EPIC_KEYS.includes(e.key) && e.duedate && !EXCLUIR_RESUMEN.includes((e.status||'').toLowerCase()));
  if (!data.length) { wrap.innerHTML = ''; return; }

  // Rango de meses: desde el mínimo hasta el máximo de fechas fin
  const fechas = data.map(e => e.duedate).sort();
  const dMin = new Date(fechas[0]+'T12:00:00');
  const dMax = new Date(fechas[fechas.length-1]+'T12:00:00');
  dMin.setDate(1); dMax.setDate(1);

  // Agrupar por mes
  const byMonth = {};
  data.forEach(e => {
    const d = new Date(e.duedate+'T12:00:00');
    const mk = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    if (!byMonth[mk]) byMonth[mk] = [];
    byMonth[mk].push(e);
  });

  // Orden de estados para mostrar bloques
  const ORDEN = ['En plazo','Replanificado','Vencido','Producción'];
  const COLORS = {
    'En plazo':      '#4ade80',
    'Replanificado': '#F5B800',
    'Vencido':       '#ef4444',
    'Producción':    '#3B82F6'
  };

  // Generar todas las filas de meses en el rango
  let html = '<div class="ent-resumen-title">Resumen mensual de entregables</div><div class="ent-resumen-grid">';

  let cur = new Date(dMin);
  while (cur <= dMax) {
    const mk = `${cur.getFullYear()}-${String(cur.getMonth()+1).padStart(2,'0')}`;
    const mesLabel = cur.toLocaleDateString('es-PE', { month:'long', year:'numeric' });
    const items = byMonth[mk] || [];

    html += `<div class="ent-mes-row">
      <span class="ent-mes-label">${mesLabel.charAt(0).toUpperCase()+mesLabel.slice(1)}</span>`;

    if (!items.length) {
      html += '<span class="ent-mes-vacio">Sin entregables</span>';
    } else {
      // Agrupar por estado
      const grupos = {};
      items.forEach(e => {
        const sem = getSemaforoEnt(e);
        if (!grupos[sem.label]) grupos[sem.label] = [];
        grupos[sem.label].push(e);
      });

      html += '<div class="ent-mes-bloques">';
      ORDEN.forEach(estado => {
        const grupo = grupos[estado] || [];
        if (!grupo.length) return;
        const col = COLORS[estado];
        html += `<div class="ent-grupo">`;
        grupo.forEach(e => {
          const bit = esc(e.bitacora || 'Sin bitácora').replace(/"/g,'&quot;');
          const tip = `${esc(e.codigo||e.key)} · ${esc(e.summary)}&#10;Fin: ${fmtD(e.duedate)||e.duedate}&#10;Estado: ${estado}&#10;${bit}`;
          html += `<div class="ent-bloque" style="background:${col}" title="${tip}" onclick="showEntDetalle(event,'${e.key}')"></div>`;
        });
        html += `<span class="ent-grupo-count">${grupo.length}</span></div>`;
      });
      html += '</div>';
    }

    html += '</div>';
    cur.setMonth(cur.getMonth()+1);
  }

  html += '</div>';
  wrap.innerHTML = html;
}

function limpiarEntFiltros() {
  document.getElementById('ent-desde').value = '';
  document.getElementById('ent-hasta').value = '';
  const s = document.getElementById('ent-search'); if(s) s.value = '';
  renderEntregables();
}

function renderEntregables() {
  renderResumenMensual();
  const wrap = document.getElementById('ent-gantt-wrap');
  if (!wrap) return;

  const desde = document.getElementById('ent-desde')?.value || '';
  const hasta = document.getElementById('ent-hasta')?.value || '';
  const search = (document.getElementById('ent-search')?.value || '').toLowerCase().trim();

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const hoyIso = hoy.toISOString().slice(0,10);

  const EXCLUIR_GANTT = ['backlog','desestimado','stand by','standby','stand-by','bloqueado','blocked'];
  let data = (epics || []).filter(e => {
    if (SPECIAL_EPIC_KEYS.includes(e.key)) return false;
    if (!e.duedate) return false;
    if (EXCLUIR_GANTT.includes((e.status||'').toLowerCase())) return false;
    if (desde && e.duedate < desde) return false;
    if (hasta && e.duedate > hasta) return false;
    if (search && !(e.codigo||'').toLowerCase().includes(search) && !e.summary.toLowerCase().includes(search) && !e.key.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a,b) => a.duedate.localeCompare(b.duedate));

  if (!data.length) {
    wrap.innerHTML = '<div class="ent-empty">No hay entregables con fecha fin en el rango seleccionado.</div>';
    return;
  }

  // Rango del Gantt: desde hoy (o la más temprana si ya venció) hasta la más lejana + 7 días
  const fechas = data.map(e => e.duedate);
  const minFin = fechas.reduce((a,b) => a<b?a:b);
  const maxFin = fechas.reduce((a,b) => a>b?a:b);
  const ganttStart = new Date(Math.min(hoy, new Date(minFin+'T12:00:00')));
  ganttStart.setHours(0,0,0,0);
  const ganttEnd = new Date(maxFin+'T12:00:00');
  ganttEnd.setDate(ganttEnd.getDate() + 10);
  ganttEnd.setHours(0,0,0,0);

  const totalDays = Math.round((ganttEnd - ganttStart) / 86400000);
  const COL_W = 28; // px por día
  const ROW_H = 36;
  const LABEL_W = 220;
  const ganttW = totalDays * COL_W;

  // Construir cabeceras: meses y días
  let months = [];
  let days = [];
  let cur = new Date(ganttStart);
  while (cur <= ganttEnd) {
    const iso = cur.toISOString().slice(0,10);
    const dow = cur.getDay();
    const isWE = dow === 0 || dow === 6;
    const isHoy = iso === hoyIso;
    days.push({ iso, day: cur.getDate(), dow, isWE, isHoy });
    // mes
    const mKey = `${cur.getFullYear()}-${cur.getMonth()}`;
    if (!months.length || months[months.length-1].key !== mKey) {
      months.push({ key: mKey, label: cur.toLocaleDateString('es-PE',{month:'short',year:'numeric'}), count: 1 });
    } else {
      months[months.length-1].count++;
    }
    cur.setDate(cur.getDate()+1);
  }

  // Función para calcular posición X de una fecha
  function xOf(isoDate) {
    const d = new Date(isoDate+'T12:00:00'); d.setHours(0,0,0,0);
    return Math.round((d - ganttStart) / 86400000) * COL_W;
  }

  let html = `<div style="overflow-x:auto;overflow-y:auto;max-height:calc(100vh - 180px)">
  <table class="ent-gantt-tbl" style="border-collapse:collapse;table-layout:fixed">
  <colgroup>
    <col style="width:${LABEL_W}px;min-width:${LABEL_W}px">
    <col style="width:${ganttW}px;min-width:${ganttW}px">
  </colgroup>
  <thead>
    <tr class="ent-hdr-months">
      <th style="background:var(--bg-base);border-bottom:1px solid var(--border-light);border-right:1px solid var(--border-light);padding:4px 10px;font-size:11px;color:var(--text-muted);text-align:left">Proyecto</th>
      <th style="padding:0;background:var(--bg-base);border-bottom:1px solid var(--border-light)">
        <div style="display:flex">`;
  months.forEach(m => {
    html += `<div style="width:${m.count*COL_W}px;min-width:${m.count*COL_W}px;padding:4px 6px;font-size:10px;font-weight:700;color:var(--text-muted);text-transform:uppercase;border-right:1px solid var(--border-light);overflow:hidden;white-space:nowrap">${m.label}</div>`;
  });
  html += `</div></th></tr>
    <tr class="ent-hdr-days">
      <th style="background:var(--bg-base);border-bottom:1px solid var(--border-light);border-right:1px solid var(--border-light)"></th>
      <th style="padding:0;background:var(--bg-base);border-bottom:1px solid var(--border-light)">
        <div style="display:flex">`;
  days.forEach(d => {
    const bg = d.isHoy ? 'rgba(59,130,246,.25)' : d.isWE ? 'rgba(255,255,255,.03)' : 'transparent';
    const col = d.isHoy ? '#60a5fa' : d.isWE ? 'var(--text-dim)' : 'var(--text-muted)';
    html += `<div style="width:${COL_W}px;min-width:${COL_W}px;text-align:center;font-size:9px;padding:3px 0;background:${bg};color:${col};border-right:1px solid rgba(255,255,255,.04)">${d.day}</div>`;
  });
  html += `</div></th></tr>
  </thead>
  <tbody>`;

  // Línea de hoy (posición)
  const hoyX = xOf(hoyIso);

  data.forEach((e, i) => {
    const sem = getSemaforoEnt(e);
    const fin = new Date(e.duedate+'T12:00:00'); fin.setHours(0,0,0,0);
    const vencido = fin < hoy;

    // Barra: SOLO la columna de la Fecha Fin (1 día de ancho = hito)
    const bx = xOf(e.duedate);
    const bw = COL_W;

    const bg = i%2===0 ? 'transparent' : 'rgba(255,255,255,.015)';

    html += `<tr style="height:${ROW_H}px;background:${bg}">
      <td style="padding:4px 10px;border-right:1px solid var(--border-light);border-bottom:1px solid rgba(255,255,255,.05);overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:${LABEL_W}px">
        <div style="font-size:11px;font-weight:600;color:var(--blue)"><a href="${JIRA_BASE}${e.key}" target="_blank" onclick="event.stopPropagation()" style="color:var(--blue);text-decoration:none">${esc(e.codigo||e.key)}</a></div>
        <div style="font-size:11px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.summary)}">${esc(e.summary)}</div>
      </td>
      <td style="padding:0;border-bottom:1px solid rgba(255,255,255,.05);position:relative">
        <!-- grid lines fin de semana -->
        <div style="display:flex;height:100%;position:absolute;inset:0">`;
    days.forEach(d => {
      const colBg = d.isHoy ? 'rgba(59,130,246,.08)' : d.isWE ? 'rgba(255,255,255,.025)' : 'transparent';
      html += `<div style="width:${COL_W}px;min-width:${COL_W}px;height:100%;background:${colBg};border-right:1px solid rgba(255,255,255,.035)"></div>`;
    });
    html += `</div>
        <!-- barra -->
        <div style="position:absolute;top:50%;transform:translateY(-50%);left:${bx}px;width:${bw}px;height:22px;background:${sem.color};border-radius:4px;display:flex;align-items:center;padding:0 8px;cursor:pointer;box-sizing:border-box;overflow:hidden;white-space:nowrap"
             onclick="showEntDetalle(event,'${e.key}')" title="${esc(e.summary)} · ${fmtD(e.duedate)}">

        </div>
        <!-- línea de hoy -->
        <div style="position:absolute;top:0;bottom:0;left:${hoyX}px;width:2px;background:#3b82f6;opacity:.6;pointer-events:none"></div>
      </td>
    </tr>`;
  });

  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

function showEntDetalle(event, key) {
  event.stopPropagation();
  const e = (epics||[]).find(x => x.key === key);
  if (!e) return;
  const sem = getSemaforoEnt(e);
  const tt = document.getElementById('ent-tooltip');
  document.getElementById('ent-tooltip-title').textContent = `${e.codigo||e.key} · ${e.summary}`;
  document.getElementById('ent-tooltip-fecha').textContent = `Fecha Fin: ${fmtD(e.duedate)||'—'} · ${sem.label}`;
  document.getElementById('ent-tooltip-bit').textContent = e.replanificacion || e.bitacora || 'Sin información registrada.';
  const x = Math.min(event.clientX + 12, window.innerWidth - 380);
  const y = Math.min(event.clientY + 12, window.innerHeight - 300);
  tt.style.left = x + 'px';
  tt.style.top  = y + 'px';
  tt.style.display = 'block';
}

document.addEventListener('click', e => {
  const tt = document.getElementById('ent-tooltip');
  if (tt && !tt.contains(e.target)) tt.style.display = 'none';
});
