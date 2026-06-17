// ═══════════════════════════════════════════════════════════
//  PMO Dashboard — Efletexia  |  app.js  v3
// ═══════════════════════════════════════════════════════════
const JIRA_BASE = "https://efletexia.atlassian.net/browse/";
const TODAY = new Date(); TODAY.setHours(0,0,0,0);

// Data stores
let epics    = [];
let ventas   = [];
let recursos = [];
let activeRecIdx = -1;

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
                 'Conformidad','DocFuncional','Bloqueante'];
  const rows = data.map(e => [
    e.key, e.codigo, e.summary, e.categoria, e.area, e.sponsor, e.status,
    e.planPct!==null?Math.round(e.planPct*100):'',
    e.realPct!==null?Math.round(e.realPct*100):'',
    e.desvioPct!==null?Math.round(e.desvioPct*100):'',
    e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):'',
    e.pctPruebas!==null?Math.round(e.pctPruebas*100):'',
    e.fechaInicio||'', e.duedate||'',
    e.conformidad||'', e.docFuncional||'', e.bloqueante||''
  ]);
  downloadCSV([hdr,...rows], `portafolio_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportVentasCSV(){
  const data = sortedVentas(getVentasFiltered());
  const hdr  = ['Clave','Código','Proyecto','Área','País','Sponsor','Estado',
                 'Plan%','Real%','Desvío%','FechaInicio','FechaFin','Bloqueante'];
  const rows = data.map(e => [
    e.key, e.codigo, e.summary, e.area, e.pais, e.sponsor, e.status,
    e.planPct!==null?Math.round(e.planPct*100):'',
    e.realPct!==null?Math.round(e.realPct*100):'',
    e.desvioPct!==null?Math.round(e.desvioPct*100):'',
    e.fechaInicio||'', e.duedate||'', e.bloqueante||''
  ]);
  downloadCSV([hdr,...rows], `ventas_${new Date().toISOString().slice(0,10)}.csv`);
}

function exportRecursosCSV(){
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
  const hdr = ['Recurso','Área','País','Proyectos','Horas Pendientes','Horas Total','Horas Cerradas','Horas Libres','Entregas Pend.','Bloqueantes','Ocupación%'];
  const rows = filtered.map(r => {
    const totalH = r.horasCerr + r.horasPend + r.horasLibre;
    const ocup = totalH > 0 ? Math.round((r.horasCerr+r.horasPend)/totalH*100) : 0;
    return [r.nombre, r.area||'', r.pais||'', r.proyectos, r.horasPend, r.horasTotal, r.horasCerr, r.horasLibre, r.entregasPend, r.bloqueantes, ocup+'%'];
  });
  downloadCSV([hdr,...rows], `recursos_${new Date().toISOString().slice(0,10)}.csv`);
}

document.getElementById('btn-export-port').addEventListener('click', exportPortafolioCSV);
document.getElementById('btn-export-ven').addEventListener('click', exportVentasCSV);
document.getElementById('btn-export-rec').addEventListener('click', exportRecursosCSV);

// ── TABS ───────────────────────────────────────────────────
let recursosLoaded = false;
let ventasLoaded   = false;

document.querySelectorAll('.tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('panel-'+tab.dataset.tab);
    if(panel) panel.classList.add('active');
    if(tab.dataset.tab==='recursos' && !recursosLoaded) loadRecursos();
    if(tab.dataset.tab==='ventas'   && !ventasLoaded)   loadVentas();
    if(tab.dataset.tab==='dashboard' && epics.length)   renderDashboard();
  });
});

// ── PORTAFOLIO: parse & render ─────────────────────────────
function parseIssue(i){
  const f=i.fields||{};
  const planPct  = f.customfield_10725!=null ? parseFloat(f.customfield_10725) : null;
  const realPct  = f.customfield_10726!=null ? parseFloat(f.customfield_10726) : null;
  const desvioPct= f.customfield_10759!=null ? parseFloat(f.customfield_10759) : null;
  return {
    key        : i.key,
    summary    : f.summary||'',
    status     : f.status?.name||'',
    area       : f.customfield_10930||'',
    pais       : f.customfield_10592||'',
    sponsor    : f.customfield_10931||'',
    categoria  : f.customfield_10929||'',
    fechaInicio: f.customfield_10015||null,
    duedate    : f.duedate||null,
    planPct, realPct, desvioPct,
    pctAnalisis   : f.customfield_10895!=null?parseFloat(f.customfield_10895):null,
    pctDesarrollo : f.customfield_10928!=null?parseFloat(f.customfield_10928):null,
    pctPruebas    : f.customfield_10969!=null?parseFloat(f.customfield_10969):null,
    conformidad   : (()=>{ const v=f.customfield_10970; if(!v) return ''; if(typeof v==='string') return v; if(typeof v==='object'&&v.content) return adfToText(v).trim(); return String(v); })(),
    docFuncional  : (()=>{ const v=f.customfield_10934; if(!v) return ''; if(typeof v==='string') return v; if(typeof v==='object'&&v.content) return adfToText(v).trim(); return String(v); })(),
    bloqueante    : (()=>{ const v=f.customfield_11003; if(!v) return ''; if(typeof v==='string') return v; if(typeof v==='object'&&v.content) return adfToText(v).trim(); return String(v); })(),
    codigo        : f.customfield_10659||f.customfield_10829||'',
    prioridad     : f.customfield_11004!=null?parseFloat(f.customfield_11004):null,
    descripcion   : f.description||null,
    assignee      : f.assignee?.displayName||'',
    reporter      : f.reporter?.displayName||'',
  };
}

function updateKpis(data){
  const total=data.length;
  const enCurso=data.filter(e=>['Desarrollo','Pruebas','Análisis'].includes(e.status)).length;
  const produc =data.filter(e=>e.status==='Producción').length;
  const desvio =data.filter(e=>e.desvioPct!=null&&Math.abs(e.desvioPct)>0.17).length;
  const bloq   =data.filter(e=>e.bloqueante&&e.bloqueante.toLowerCase()!=='no'&&e.bloqueante!=='').length;
  const conBloq=data.filter(e=>['Sí','Si','sí','si','YES','Yes'].includes(e.bloqueante)).length;
  function setKpi(id,val){
    const el=document.getElementById(id);
    if(el) el.textContent=val;
  }
  setKpi('kpi-total',total); setKpi('kpi-encurso',enCurso);
  setKpi('kpi-produccion',produc); setKpi('kpi-desvio',desvio); setKpi('kpi-bloqueantes',conBloq||bloq);
}

function renderTable(data){
  const total=epics.length;
  const info=document.getElementById('table-info');
  if(info) info.textContent=`Mostrando ${data.length} de ${total} proyectos`;
  const tb=document.getElementById('table-body');
  if(!tb) return;
  if(!data.length){
    tb.innerHTML=`<tr><td colspan="15" style="padding:40px;text-align:center;color:var(--text-dim)">Sin resultados</td></tr>`;
    return;
  }
  tb.innerHTML=data.map(e=>{
    const desvC=e.desvioPct===null?'var(--text-muted)':Math.abs(e.desvioPct)>0.17?'var(--red)':Math.abs(e.desvioPct)>=0.05?'var(--yellow)':'var(--green)';
    const desvV=e.desvioPct!==null?Math.round(e.desvioPct*100)+'%':'—';
    const sbCls=sbClass(e.status);
    const codLink=e.codigo?`<a href="${JIRA_BASE}${e.key}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none" onclick="event.stopPropagation()">${esc(e.codigo)}</a>`:'—';
    return `<tr data-key="${esc(e.key)}">
      <td style="text-align:center;color:var(--text-muted)">${e.prioridad!=null?e.prioridad:'—'}</td>
      <td>${codLink}</td>
      <td style="max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(e.summary)}">${esc(e.summary)}</td>
      <td>${pill(e.categoria)}</td>
      <td>${esc(e.area)||'—'}</td>
      <td style="color:var(--text-muted)">${esc(e.sponsor)||'—'}</td>
      <td><span class="badge badge-${sbCls}">${esc(e.status)}</span></td>
      <td>${progCell(e.planPct)} ${progCell(e.realPct)}</td>
      <td style="font-weight:600;color:${desvC}">${desvV}</td>
      <td>${progCell(e.pctDesarrollo)} ${progCell(e.pctPruebas)}</td>
      <td style="color:var(--text-muted)">${fmtD(e.fechaInicio)||'—'}</td>
      <td style="color:var(--text-muted)">${fmtD(e.duedate)||'—'}</td>
      <td>${pill(e.conformidad)}</td>
      <td>${pill(e.docFuncional)}</td>
      <td><button class="btn-ver" onclick="openModal('${esc(e.key)}');event.stopPropagation()">···</button></td>
    </tr>`;
  }).join('');
}

// ── PORTAFOLIO FILTERS ────────────────────────────────────
let sortCol='', sortDir=1;

function getFiltered(){
  const search=(document.getElementById('s-search')?.value||'').toLowerCase();
  const pais  =document.getElementById('s-pais')?.value||'';
  const area  =document.getElementById('s-area')?.value||'';
  const spon  =document.getElementById('s-sponsor')?.value||'';
  const cat   =document.getElementById('s-cat')?.value||'';
  const checked=[...document.querySelectorAll('#panel-portafolio .estados-grid input:checked')].map(c=>c.value);
  return epics.filter(e=>{
    if(search && !e.summary.toLowerCase().includes(search) && !e.codigo.toLowerCase().includes(search)) return false;
    if(pais && e.pais!==pais) return false;
    if(area && e.area!==area) return false;
    if(spon && e.sponsor!==spon) return false;
    if(cat  && e.categoria!==cat) return false;
    if(checked.length && !checked.includes(e.status)) return false;
    return true;
  });
}

function sortedData(data){
  if(!sortCol) return data;
  return [...data].sort((a,b)=>{
    let va=a[sortCol],vb=b[sortCol];
    if(va===null||va===undefined) va=''; if(vb===null||vb===undefined) vb='';
    return (va<vb?-1:va>vb?1:0)*sortDir;
  });
}

['s-search','s-pais','s-area','s-sponsor','s-cat'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input',()=>renderTable(sortedData(getFiltered())));
  if(el) el.addEventListener('change',()=>renderTable(sortedData(getFiltered())));
});
document.querySelectorAll('#panel-portafolio .estados-grid input').forEach(cb=>{
  cb.addEventListener('change',()=>renderTable(sortedData(getFiltered())));
});
document.getElementById('btn-limpiar')?.addEventListener('click',()=>{
  document.querySelectorAll('#panel-portafolio .filter-input').forEach(el=>{ if(el.tagName==='INPUT') el.value=''; else el.value=''; });
  document.querySelectorAll('#panel-portafolio .estados-grid input').forEach(c=>c.checked=false);
  document.querySelectorAll('#panel-portafolio thead th').forEach(t=>{ sortCol=''; sortDir=1; t.querySelector('.sort-icon')&&(t.querySelector('.sort-icon').textContent=''); });
  renderTable(epics);
});

document.querySelectorAll('#panel-portafolio thead th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    if(sortCol===col) sortDir*=-1; else { sortCol=col; sortDir=1; }
    document.querySelectorAll('#panel-portafolio thead th').forEach(t=>{ if(t.querySelector('.sort-icon')) t.querySelector('.sort-icon').textContent=''; });
    if(th.querySelector('.sort-icon')) th.querySelector('.sort-icon').textContent=sortDir===1?' ↑':' ↓';
    renderTable(sortedData(getFiltered()));
  });
});

// ── LOAD PORTAFOLIO ────────────────────────────────────────
async function fetchAllEpics(){
  const resp=await fetch('/api/jira',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'epics'})});
  if(!resp.ok) throw new Error('HTTP '+resp.status);
  const j=await resp.json();
  return (j.issues||[]).map(parseIssue);
}

async function loadData(manual=false){
  const loadingScr = document.getElementById('loading-screen');
  const errorScr   = document.getElementById('error-screen');
  const loadingTxt = document.getElementById('loading-text');
  const refreshBtn = document.getElementById('btn-refresh');
  const info       = document.getElementById('table-info');

  if(manual){
    if(refreshBtn) refreshBtn.classList.add('spinning');
  } else {
    if(loadingScr) loadingScr.classList.remove('hidden');
    if(errorScr)   errorScr.classList.add('hidden');
  }
  if(loadingTxt) loadingTxt.textContent='Cargando épicas desde Jira...';

  try{
    epics=await fetchAllEpics();
    if(loadingTxt) loadingTxt.textContent=`Procesando ${epics.length} épicas...`;

    const now=new Date();
    const el=document.getElementById('last-update');
    if(el) el.textContent='Actualizado: '+now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});

    function populateSelect(id,values,allLabel){
      const sel=document.getElementById(id);
      if(!sel) return;
      const cur=sel.value;
      sel.innerHTML=`<option value="">${allLabel}</option>`+[...new Set(values.filter(Boolean))].sort().map(v=>`<option>${v}</option>`).join('');
      sel.value=cur||'';
    }
    populateSelect('s-pais',   epics.map(e=>e.pais),     'Todos');
    populateSelect('s-area',   epics.map(e=>e.area),     'Todas');
    populateSelect('s-sponsor',epics.map(e=>e.sponsor),  'Todos');
    populateSelect('s-cat',    epics.map(e=>e.categoria),'Todas');

    if(loadingScr) loadingScr.classList.add('hidden');
    if(errorScr)   errorScr.classList.add('hidden');
    if(refreshBtn) refreshBtn.classList.remove('spinning');

    updateKpis(epics);
    renderTable(epics);

    const dashTab = document.querySelector('.tab[data-tab="dashboard"]');
    if(dashTab && dashTab.classList.contains('active')) renderDashboard();

  }catch(err){
    console.error('Error portafolio:',err);
    if(loadingScr) loadingScr.classList.add('hidden');
    if(refreshBtn) refreshBtn.classList.remove('spinning');
    if(!manual){
      if(errorScr) errorScr.classList.remove('hidden');
      const errMsg=document.getElementById('error-msg');
      if(errMsg) errMsg.textContent=err.message;
    } else {
      const el=document.getElementById('last-update');
      if(el) el.textContent='⚠ Error al actualizar';
    }
    if(info) info.textContent='Error al cargar: '+err.message;
  }
}

document.getElementById('btn-refresh')?.addEventListener('click',()=>loadData(true));
loadData();

// ── VENTAS: parse & render ─────────────────────────────────
function parseVenta(i){ return parseIssue(i); } // misma estructura

let ventaSortCol='', ventaSortDir=1;

function getVentasFiltered(){
  const search=(document.getElementById('ven-search')?.value||'').toLowerCase();
  const pais  =document.getElementById('ven-pais')?.value||'';
  const area  =document.getElementById('ven-area')?.value||'';
  const spon  =document.getElementById('ven-sponsor')?.value||'';
  const status=document.getElementById('ven-status')?.value||'';
  return ventas.filter(v=>{
    if(search && !v.summary.toLowerCase().includes(search) && !v.codigo.toLowerCase().includes(search)) return false;
    if(pais   && v.pais!==pais)     return false;
    if(area   && v.area!==area)     return false;
    if(spon   && v.sponsor!==spon)  return false;
    if(status && v.status!==status) return false;
    return true;
  });
}

function sortedVentas(data){
  if(!ventaSortCol) return data;
  return [...data].sort((a,b)=>{
    let va=a[ventaSortCol],vb=b[ventaSortCol];
    if(va===null||va===undefined) va=''; if(vb===null||vb===undefined) vb='';
    return (va<vb?-1:va>vb?1:0)*ventaSortDir;
  });
}

function renderVentas(data){
  const total=ventas.length;
  const info=document.getElementById('ven-table-info');
  if(info) info.textContent=`Mostrando ${data.length} de ${total} ventas`;

  // KPIs
  const sk=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  const activas =data.filter(v=>!['Producción','Desestimado'].includes(v.status)).length;
  const ganadas =data.filter(v=>v.status==='Producción').length;
  const perdidas=data.filter(v=>v.status==='Desestimado').length;
  const desvCount=data.filter(v=>v.desvioPct!=null&&Math.abs(v.desvioPct)>0.17).length;
  const bloqCount=data.filter(v=>v.bloqueante&&v.bloqueante.toLowerCase()!=='no'&&v.bloqueante!=='').length;
  sk('ven-kpi-total',   total);
  sk('ven-kpi-activas', activas);
  sk('ven-kpi-ganadas', ganadas);
  sk('ven-kpi-perdidas',perdidas);
  sk('ven-kpi-desvio',  desvCount);
  sk('ven-kpi-bloq',    bloqCount);

  const tb=document.getElementById('ven-table-body');
  if(!tb) return;
  if(!data.length){
    tb.innerHTML=`<tr><td colspan="11" class="ven-empty">Sin resultados para los filtros aplicados</td></tr>`;
    return;
  }
  tb.innerHTML=data.map(v=>{
    const desvC=v.desvioPct===null?'var(--text-muted)':Math.abs(v.desvioPct)>0.17?'var(--red)':Math.abs(v.desvioPct)>=0.05?'var(--yellow)':'var(--green)';
    const desvV=v.desvioPct!==null?Math.round(v.desvioPct*100)+'%':'—';
    const sbCls=sbClass(v.status);
    const bloqColor=v.bloqueante&&v.bloqueante.toLowerCase()!=='no'?'var(--red)':'var(--green)';
    const bloqLabel=v.bloqueante&&v.bloqueante.toLowerCase()!=='no'?'⚠ Sí':'✓ No';
    return `<tr>
      <td><a href="${JIRA_BASE}${v.key}" target="_blank" rel="noopener" style="color:var(--blue);text-decoration:none">${esc(v.codigo||v.key)}</a></td>
      <td style="max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(v.summary)}">${esc(v.summary)}</td>
      <td>${esc(v.area)||'—'}</td>
      <td>${esc(v.pais)||'—'}</td>
      <td style="color:var(--text-muted)">${esc(v.sponsor)||'—'}</td>
      <td><span class="badge badge-${sbCls}">${esc(v.status)}</span></td>
      <td>${progCell(v.planPct)} ${progCell(v.realPct)}</td>
      <td style="font-weight:600;color:${desvC}">${desvV}</td>
      <td style="color:var(--text-muted)">${fmtD(v.fechaInicio)||'—'}</td>
      <td style="color:var(--text-muted)">${fmtD(v.duedate)||'—'}</td>
      <td style="font-weight:600;color:${bloqColor}">${bloqLabel}</td>
    </tr>`;
  }).join('');
}

// Ventas filter listeners
['ven-search','ven-pais','ven-area','ven-sponsor','ven-status'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input',()=>renderVentas(sortedVentas(getVentasFiltered())));
  if(el) el.addEventListener('change',()=>renderVentas(sortedVentas(getVentasFiltered())));
});
document.getElementById('ven-limpiar')?.addEventListener('click',()=>{
  document.querySelectorAll('#panel-ventas .filter-input').forEach(el=>{el.value='';});
  document.getElementById('ven-search').value='';
  ventaSortCol=''; ventaSortDir=1;
  document.querySelectorAll('#panel-ventas thead th').forEach(t=>{ if(t.querySelector('.sort-icon')) t.querySelector('.sort-icon').textContent=''; });
  renderVentas(ventas);
});
document.querySelectorAll('#panel-ventas thead th[data-vcol]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.vcol;
    if(ventaSortCol===col) ventaSortDir*=-1; else { ventaSortCol=col; ventaSortDir=1; }
    document.querySelectorAll('#panel-ventas thead th').forEach(t=>{ if(t.querySelector('.sort-icon')) t.querySelector('.sort-icon').textContent=''; });
    if(th.querySelector('.sort-icon')) th.querySelector('.sort-icon').textContent=ventaSortDir===1?' ↑':' ↓';
    renderVentas(sortedVentas(getVentasFiltered()));
  });
});

async function loadVentas(){
  ventasLoaded=true;
  const info=document.getElementById('ven-table-info');
  if(info) info.textContent='Cargando ventas desde Jira…';
  try{
    const resp=await fetch('/api/jira',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'ventas'})});
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    const j=await resp.json();
    ventas=(j.issues||[]).map(parseVenta);

    function populateSelect(id,values,allLabel){
      const sel=document.getElementById(id);
      if(!sel) return;
      sel.innerHTML=`<option value="">${allLabel}</option>`+[...new Set(values.filter(Boolean))].sort().map(v=>`<option>${v}</option>`).join('');
    }
    populateSelect('ven-pais',   ventas.map(v=>v.pais),    'Todos');
    populateSelect('ven-area',   ventas.map(v=>v.area),    'Todas');
    populateSelect('ven-sponsor',ventas.map(v=>v.sponsor), 'Todos');
    populateSelect('ven-status', ventas.map(v=>v.status),  'Todos');

    renderVentas(ventas);
  }catch(err){
    console.error('Error ventas:',err);
    if(info) info.textContent='Error al cargar ventas: '+err.message;
    const tb=document.getElementById('ven-table-body');
    if(tb) tb.innerHTML=`<tr><td colspan="11" class="ven-empty">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ── DASHBOARD ──────────────────────────────────────────────
const STATE_COLORS={
  'Backlog'    :'#6B7280',
  'Análisis'   :'#3B82F6',
  'Desarrollo' :'#8B5CF6',
  'Pruebas'    :'#F59E0B',
  'Producción' :'#10B981',
  'Planificado':'#06B6D4',
  'Stand by'   :'#EF4444',
  'Desestimado':'#374151',
};

function renderDashboard(){
  if(!epics.length) return;

  // ── Donut: por estado ──
  const stateCounts={};
  epics.forEach(e=>{ stateCounts[e.status]=(stateCounts[e.status]||0)+1; });
  const stateEntries=Object.entries(stateCounts).sort((a,b)=>b[1]-a[1]);
  const total=epics.length;
  const canvas=document.getElementById('dash-donut');
  if(canvas){
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,120,120);
    let angle=-Math.PI/2;
    stateEntries.forEach(([st,cnt])=>{
      const slice=(cnt/total)*Math.PI*2;
      ctx.beginPath();
      ctx.moveTo(60,60);
      ctx.arc(60,60,54,angle,angle+slice);
      ctx.closePath();
      ctx.fillStyle=STATE_COLORS[st]||'#6B7280';
      ctx.fill();
      angle+=slice;
    });
    // inner hole
    ctx.beginPath();
    ctx.arc(60,60,30,0,Math.PI*2);
    ctx.fillStyle='var(--bg-surface, #1e2025)';
    ctx.fill();
    // center count
    ctx.fillStyle='#f1f5f9';
    ctx.font='bold 18px system-ui';
    ctx.textAlign='center';
    ctx.textBaseline='middle';
    ctx.fillText(total,60,60);
  }
  const legend=document.getElementById('dash-donut-legend');
  if(legend) legend.innerHTML=stateEntries.map(([st,cnt])=>`
    <div class="dash-legend-item">
      <span class="dash-legend-dot" style="background:${STATE_COLORS[st]||'#6B7280'}"></span>
      <span class="dash-legend-lbl">${esc(st)}</span>
      <span class="dash-legend-val" style="margin-left:8px">${cnt}</span>
    </div>`).join('');

  // ── KPI grid ──
  const enCurso=epics.filter(e=>['Desarrollo','Pruebas','Análisis'].includes(e.status)).length;
  const produc =epics.filter(e=>e.status==='Producción').length;
  const conDesvio=epics.filter(e=>e.desvioPct!=null&&Math.abs(e.desvioPct)>0.17).length;
  const sinFechas=epics.filter(e=>!e.fechaInicio&&!e.duedate).length;
  const conBloq  =epics.filter(e=>e.bloqueante&&e.bloqueante.toLowerCase()!=='no'&&e.bloqueante!=='').length;
  const conConf  =epics.filter(e=>e.conformidad&&e.conformidad.toLowerCase()!=='no'&&e.conformidad!=='').length;
  const grid=document.getElementById('dash-kpi-grid');
  if(grid) grid.innerHTML=[
    [total,          'Total',          'var(--text-primary)'],
    [enCurso,        'En Curso',       'var(--cyan)'],
    [produc,         'Producción',     'var(--green)'],
    [conDesvio,      'Con Desvío>17%', 'var(--red)'],
    [conBloq,        'Bloqueantes',    'var(--yellow)'],
    [sinFechas,      'Sin Fechas',     'var(--text-muted)'],
  ].map(([v,l,c])=>`<div class="dash-stat"><div class="dash-stat-val" style="color:${c}">${v}</div><div class="dash-stat-lbl">${l}</div></div>`).join('');

  // ── Barras por Área ──
  const areaCounts={};
  epics.forEach(e=>{ if(e.area) areaCounts[e.area]=(areaCounts[e.area]||0)+1; });
  const areaMax=Math.max(...Object.values(areaCounts),1);
  const areaBars=document.getElementById('dash-area-bars');
  if(areaBars) areaBars.innerHTML=Object.entries(areaCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([a,n])=>`
    <div class="dash-prog-row">
      <span class="dash-prog-lbl" title="${esc(a)}">${esc(a)}</span>
      <div class="dash-prog-bar-wrap"><div class="dash-prog-fill" style="width:${Math.round(n/areaMax*100)}%;background:var(--blue)"></div></div>
      <span class="dash-prog-pct">${n}</span>
    </div>`).join('');

  // ── Proyectos desviados ──
  const desviados=epics.filter(e=>e.desvioPct!=null&&Math.abs(e.desvioPct)>0.17)
    .sort((a,b)=>Math.abs(b.desvioPct)-Math.abs(a.desvioPct)).slice(0,8);
  const desvEl=document.getElementById('dash-desviados');
  if(desvEl) desvEl.innerHTML=desviados.length
    ? desviados.map(e=>`<div class="dash-row">
        <span class="dash-row-lbl" title="${esc(e.summary)}" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(e.codigo||e.key)} — ${esc(e.summary)}</span>
        <span class="dash-row-val" style="color:var(--red)">${Math.round(e.desvioPct*100)}%</span>
      </div>`).join('')
    : '<div class="dash-empty">✓ Sin proyectos con desvío crítico</div>';

  // ── Próximos a vencer 30 días ──
  const in30=new Date(TODAY); in30.setDate(in30.getDate()+30);
  const vencen=epics.filter(e=>{
    if(!e.duedate||['Producción','Desestimado'].includes(e.status)) return false;
    const d=new Date(e.duedate+'T12:00:00');
    return d>=TODAY && d<=in30;
  }).sort((a,b)=>new Date(a.duedate)-new Date(b.duedate));
  const vencenEl=document.getElementById('dash-vencen');
  if(vencenEl) vencenEl.innerHTML=vencen.length
    ? vencen.map(e=>{
        const d=new Date(e.duedate+'T12:00:00');
        const dias=diffD(TODAY,d);
        const urg=dias<=7?'var(--red)':dias<=14?'var(--yellow)':'var(--cyan)';
        return `<div class="dash-row">
          <span class="dash-row-lbl">${esc(e.codigo||e.key)} — ${esc(e.summary)}</span>
          <span class="dash-row-val" style="color:${urg}">${dias}d · ${fmtD(e.duedate)}</span>
        </div>`;
      }).join('')
    : '<div class="dash-empty">✓ No hay proyectos por vencer en los próximos 30 días</div>';
}

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
  const pA=e.pctAnalisis!==null?Math.round(e.pctAnalisis*100):null;
  const pD=e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null;
  const pP=e.pctPruebas!==null?Math.round(e.pctPruebas*100):null;
  const pPlan=e.planPct!==null?Math.round(e.planPct*100):null;
  const pReal=e.realPct!==null?Math.round(e.realPct*100):null;
  const pDesv=e.desvioPct!==null?Math.round(e.desvioPct*100):null;
  const desvColor=pDesv===null?'var(--text-muted)':Math.abs(pDesv)>17?'var(--red)':Math.abs(pDesv)>=5?'var(--yellow)':'var(--green)';
  const bitHtml=e.bitacora?`<div class="log-box">${esc(e.bitacora)}</div>`:`<div class="log-box empty">Sin registros en bitácora</div>`;
  const proxHtml=e.proximosPasos?`<div class="log-box">${esc(e.proximosPasos)}</div>`:`<div class="log-box empty">Sin próximos pasos definidos</div>`;
  return `
    <div class="dsec">Asignación</div>
    <div class="drow"><span class="dlbl">Asignado</span><span class="dval ${e.asignado?'':'m'}">${esc(e.asignado)||'—'}</span></div>
    <div class="dsec">Fechas</div>
    <div class="drow"><span class="dlbl">Fecha de inicio</span><span class="dval">${fmtD(e.fechaInicio)||'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Fecha de vencimiento</span><span class="dval">${fmtD(e.duedate)?'📅 '+fmtD(e.duedate):'<span class="dval m">—</span>'}</span></div>
    <div class="dsec">Clasificación</div>
    <div class="drow"><span class="dlbl">País</span><span class="dval">${pill(e.pais)}</span></div>
    <div class="drow"><span class="dlbl">Área</span><span class="dval">${pill(e.area)}</span></div>
    <div class="drow"><span class="dlbl">Sponsor</span><span class="dval ${e.sponsor?'':'m'}">${esc(e.sponsor)||'—'}</span></div>
    <div class="drow"><span class="dlbl">Categoría</span><span class="dval">${pill(e.categoria)}</span></div>
    <div class="drow"><span class="dlbl">Prioridad</span><span class="dval">${e.prioridad?`<span class="pill">${e.prioridad}</span>`:'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Doc Funcional</span><span class="dval">${pill(e.docFuncional)}</span></div>
    <div class="drow"><span class="dlbl">Responsable DF</span><span class="dval ${e.responsableDF?'':'m'}">${esc(e.responsableDF)||'—'}</span></div>
    <div class="drow"><span class="dlbl">Bloqueante</span><span class="dval">${pill(e.bloqueante)}</span></div>
    <div class="drow"><span class="dlbl">Conformidad</span><span class="dval">${pill(e.conformidad)}</span></div>
    <div class="dsec">Progreso</div>
    <div class="drow"><span class="dlbl">% Análisis</span><span class="dval">${pA!==null?pA+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">% Desarrollo</span><span class="dval">${pD!==null?pD+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">% Pruebas</span><span class="dval">${pP!==null?pP+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Plan (%)</span><span class="dval">${pPlan!==null?pPlan+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Real (%)</span><span class="dval">${pReal!==null?pReal+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Desvío (%)</span><span class="dval" style="color:${desvColor}">${pDesv!==null?pDesv+' %':'<span class="dval m">—</span>'}</span></div>
    <div class="log-section">
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
        p.epicasMap[epicaKey].tareas.push({key:h.key,nombre:f.summary||h.key,status,isDone,horasEst,horasPend,fecha:f.customfield_10015||f.duedate||null});
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
    return `<tr>
      <td><span class="rec-name">${esc(r.nombre)}</span></td>
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
  const tareas=(p.tareas||[]).filter(t=>fmtD(t.fecha)!==null);
  const tareasHtml=tareas.length
    ?tareas.map(t=>`<div class="det-task-row"><span class="det-task-date">${fmtD(t.fecha)}</span><span class="det-task-name" title="${esc(t.nombre)}">${esc(t.nombre)}</span><span class="det-task-hrs">${t.horasEst}h</span><span class="det-task-status"><span class="det-badge ${t.isDone?'done':'open'}">${t.isDone?'Cerrado':'En proceso'}</span></span></div>`).join('')
    :'<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Sin actividades con fecha</div>';
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

// ── getRecursosFiltered helper (used by exportRecursosCSV) ─
// NOTE: renderRecursos already has inline filter logic;
// this just exposes the same logic for CSV export.
// (added at end so no conflict with inline version above)

// ═══════════════════════════════════════════════════════════
//  CAPACITY TAB  — worklogs por fecha/persona
// ═══════════════════════════════════════════════════════════
let capacityLoaded = false;
let capRows = [];         // filas planas: {fecha, persona, horas, subtarea, comentario}
let capSortCol = 'fecha', capSortDir = -1; // más reciente primero por defecto

// ── Registro del tab en el listener central ────────────────
// El listener de tabs ya maneja la activación del panel;
// solo necesitamos enganchar la carga lazy:
document.querySelectorAll('.tabs .tab').forEach(tab => {
  if(tab.dataset.tab === 'capacity') {
    tab.addEventListener('click', () => {
      if(!capacityLoaded) loadCapacity();
    });
  }
});

// ── Carga desde API ────────────────────────────────────────
async function loadCapacity(){
  capacityLoaded = true;
  const info = document.getElementById('cap-table-info');
  if(info) info.textContent = 'Cargando registros de actividad desde Jira…';
  try {
    const resp = await fetch('/api/jira', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'capacity' })
    });
    if(!resp.ok) throw new Error('HTTP ' + resp.status);
    const j = await resp.json();

    // Aplanar: por cada subtarea, por cada worklog → una fila
    capRows = [];
    (j.issues || []).forEach(sub => {
      const f = sub.fields || {};
      const subtareaNom = f.summary || sub.key;
      const logs = f._worklogs || [];
      logs.forEach(wl => {
        // timeSpentSeconds → horas redondeadas a 2 decimales
        const horas = wl.timeSpentSeconds ? +(wl.timeSpentSeconds / 3600).toFixed(2) : 0;
        // started: "2026-06-10T14:00:00.000+0000"
        const fechaIso = wl.started ? wl.started.slice(0,10) : null;
        const persona  = wl.author?.displayName || wl.updateAuthor?.displayName || '—';
        // comentario: puede ser ADF o texto plano
        let comentario = '';
        if(wl.comment){
          if(typeof wl.comment === 'string') comentario = wl.comment;
          else if(wl.comment.content) comentario = adfToText(wl.comment).trim();
        }
        capRows.push({ fecha: fechaIso, persona, horas, subtarea: subtareaNom, comentario });
      });
    });

    // Poblar selector de personas
    const personas = [...new Set(capRows.map(r => r.persona).filter(Boolean))].sort();
    const sel = document.getElementById('cap-persona');
    if(sel) sel.innerHTML = '<option value="">Todas</option>' + personas.map(p => `<option>${esc(p)}</option>`).join('');

    renderCapacity();
  } catch(err) {
    console.error('Error capacity:', err);
    const info = document.getElementById('cap-table-info');
    if(info) info.textContent = 'Error al cargar registros: ' + err.message;
    const tb = document.getElementById('cap-table-body');
    if(tb) tb.innerHTML = `<tr><td colspan="5" class="cap-empty">Error: ${esc(err.message)}</td></tr>`;
  }
}

// ── Render ─────────────────────────────────────────────────
function getCapFiltered(){
  const search  = (document.getElementById('cap-search')?.value || '').toLowerCase();
  const desde   = document.getElementById('cap-desde')?.value || '';
  const hasta   = document.getElementById('cap-hasta')?.value || '';
  const persona = document.getElementById('cap-persona')?.value || '';
  return capRows.filter(r => {
    if(search && !r.persona.toLowerCase().includes(search) && !r.subtarea.toLowerCase().includes(search) && !r.comentario.toLowerCase().includes(search)) return false;
    if(desde && r.fecha && r.fecha < desde) return false;
    if(hasta && r.fecha && r.fecha > hasta) return false;
    if(persona && r.persona !== persona) return false;
    return true;
  });
}

function renderCapacity(){
  let filtered = getCapFiltered();

  // Ordenar
  filtered = [...filtered].sort((a,b) => {
    let va = a[capSortCol], vb = b[capSortCol];
    if(va === null || va === undefined) va = '';
    if(vb === null || vb === undefined) vb = '';
    return (va < vb ? -1 : va > vb ? 1 : 0) * capSortDir;
  });

  // KPIs
  const totalHoras   = filtered.reduce((s,r) => s + r.horas, 0);
  const personas     = new Set(filtered.map(r => r.persona)).size;
  const subtareasSet = new Set(filtered.map(r => r.subtarea)).size;
  const sk = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  sk('cap-kpi-registros',  filtered.length || '—');
  sk('cap-kpi-horas',      totalHoras ? totalHoras.toFixed(1)+'h' : '—');
  sk('cap-kpi-personas',   personas   || '—');
  sk('cap-kpi-subtareas',  subtareasSet || '—');

  const info = document.getElementById('cap-table-info');
  if(info) info.textContent = `Mostrando ${filtered.length} de ${capRows.length} registros`;

  const tb = document.getElementById('cap-table-body');
  if(!tb) return;

  if(!filtered.length){
    tb.innerHTML = `<tr><td colspan="5" class="cap-empty">${capRows.length === 0 ? 'Sin registros de actividad encontrados' : 'Sin resultados para los filtros aplicados'}</td></tr>`;
    return;
  }

  tb.innerHTML = filtered.map(r => {
    const horasCls = r.horas >= 8 ? 'cap-horas-high' : r.horas >= 4 ? 'cap-horas-med' : 'cap-horas-low';
    const fechaFmt = r.fecha ? fmtD(r.fecha) : '—';
    const coment   = r.comentario ? `<span style="color:var(--text-muted);max-width:300px;display:inline-block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.comentario)}">${esc(r.comentario)}</span>` : '<span style="color:var(--text-dim)">—</span>';
    return `<tr>
      <td style="color:var(--text-muted);white-space:nowrap">${fechaFmt}</td>
      <td><span style="font-weight:600">${esc(r.persona)}</span></td>
      <td><span class="cap-horas-badge ${horasCls}">${r.horas}h</span></td>
      <td style="max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(r.subtarea)}">${esc(r.subtarea)}</td>
      <td>${coment}</td>
    </tr>`;
  }).join('');
}

// ── Filtros listeners ──────────────────────────────────────
['cap-search','cap-desde','cap-hasta','cap-persona'].forEach(id => {
  const el = document.getElementById(id);
  if(el) el.addEventListener('input',  renderCapacity);
  if(el) el.addEventListener('change', renderCapacity);
});
document.getElementById('cap-limpiar')?.addEventListener('click', () => {
  document.getElementById('cap-search').value = '';
  document.getElementById('cap-desde').value  = '';
  document.getElementById('cap-hasta').value  = '';
  document.getElementById('cap-persona').value = '';
  capSortCol = 'fecha'; capSortDir = -1;
  document.querySelectorAll('#panel-capacity thead th').forEach(t => { if(t.querySelector('.sort-icon')) t.querySelector('.sort-icon').textContent = ''; });
  renderCapacity();
});

// ── Ordenamiento de columnas ───────────────────────────────
document.querySelectorAll('#panel-capacity thead th[data-ccol]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.ccol;
    if(capSortCol === col) capSortDir *= -1; else { capSortCol = col; capSortDir = 1; }
    document.querySelectorAll('#panel-capacity thead th').forEach(t => { if(t.querySelector('.sort-icon')) t.querySelector('.sort-icon').textContent = ''; });
    if(th.querySelector('.sort-icon')) th.querySelector('.sort-icon').textContent = capSortDir === 1 ? ' ↑' : ' ↓';
    renderCapacity();
  });
});

// ── Exportar CSV ───────────────────────────────────────────
document.getElementById('btn-export-cap')?.addEventListener('click', () => {
  const filtered = getCapFiltered().sort((a,b) => {
    const va = a[capSortCol]||'', vb = b[capSortCol]||'';
    return (va < vb ? -1 : va > vb ? 1 : 0) * capSortDir;
  });
  const hdr  = ['Fecha','Persona','Horas','Actividad (Subtarea)','Comentario'];
  const rows = filtered.map(r => [r.fecha||'', r.persona, r.horas, r.subtarea, r.comentario]);
  downloadCSV([hdr,...rows], `capacity_${new Date().toISOString().slice(0,10)}.csv`);
});
