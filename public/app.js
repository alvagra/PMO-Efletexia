

function sbClass(s){
  return({"Backlog":"backlog","Análisis":"analisis","Desarrollo":"desarrollo","Pruebas":"pruebas","Producción":"produccion","Planificado":"planificado","Stand by":"standby","Desestimado":"desestimado","En curso":"en-curso"}[s]||"backlog");
}
function fmtD(iso){
  if(!iso)return null;
  return new Date(iso+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
}
// Días calendario (para posicionamiento eje Gantt)
function diffD(a,b){return Math.round((b-a)/864e5)}
// Días hábiles lun-vie entre dos fechas (excluye sáb y dom)
function workDays(a,b){
  if(b<=a)return 0;
  let count=0;
  const d=new Date(a);d.setHours(0,0,0,0);
  const end=new Date(b);end.setHours(0,0,0,0);
  while(d<end){const dow=d.getDay();if(dow!==0&&dow!==6)count++;d.setDate(d.getDate()+1)}
  return count;
}
function progCell(pct){
  if(pct===null||pct===undefined)return '<span style="color:var(--text-muted)">—</span>';
  const w=Math.min(100,Math.round(pct*100)),cls=w>=100?" full":"";
  return `<div class="prog-cell"><div class="prog-bar"><div class="prog-fill${cls}" style="width:${w}%"></div></div><span class="prog-pct">${w}%</span></div>`;
}
function pill(v){return v?`<span class="pill">${v}</span>`:'<span class="dval m">—</span>'}
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function priClass(p){return p==="1"?"high":p==="3"?"low":p==="2"?"med":""}


// ── KPIs DINÁMICOS ──
function updateKpis(data){
  const t=data.length;
  const crit=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>0.17).length;
  const tol=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>=0.05&&Math.abs(e.desvioPct)<=0.17).length;
  const onT=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)<0.05).length;
  // Avance prom. = promedio de (% Análisis + % Desarrollo + % Pruebas) por épica
  const avgs=data.map(e=>{
    const vals=[e.pctAnalisis,e.pctDesarrollo,e.pctPruebas].filter(v=>v!==null);
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }).filter(v=>v!==null);
  const avg=avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length*100):0;
  const cj=data.filter(e=>e.duedate&&e.duedate.startsWith('2026-06')).length;
  const isFiltered=data.length<epics.length;
  // Animate values
  function setKpi(id,val){
    const el=document.getElementById(id);
    if(!el)return;
    const prev=el.dataset.val;
    if(prev!==String(val)){
      el.style.transition='opacity .15s';
      el.style.opacity='0.3';
      setTimeout(()=>{el.textContent=val;el.dataset.val=String(val);el.style.opacity='1'},150);
    }
  }
  setKpi('kpi-total', isFiltered?`${t}`:t);
  setKpi('kpi-crit', crit);
  setKpi('kpi-tol', tol);
  setKpi('kpi-ont', onT);
  setKpi('kpi-avg', avg+'%');
  setKpi('kpi-cj', cj);
  // Update header meta
  document.getElementById('hdr-meta').textContent=isFiltered
    ? `PMO TI · ${t} de ${epics.length} épicas`
    : `PMO TI · ${epics.length} épicas`;
}

// ── TABLE ──
function renderTable(data){
  updateKpis(data);
  document.getElementById('table-info').textContent=`Mostrando ${data.length} de ${epics.length} épicas`;
  const tb=document.getElementById('table-body');
  if(!data.length){tb.innerHTML='<tr><td colspan="17" style="text-align:center;padding:40px;color:var(--text-muted)">Sin resultados</td></tr>';return}
  tb.innerHTML=data.map(e=>`
    <tr data-key="${e.key}">
      <td><span class="priority-badge ${priClass(e.prioridad)}" title="Prioridad ${e.prioridad||'—'}"></span></td>
      <td class="code"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank" title="Abrir ${e.key} en Jira" onclick="event.stopPropagation()">${esc(e.codigo||e.key)}</a></td>
      <td class="proj" title="${esc(e.summary)}">${esc(e.summary)}</td>
      <td class="cat">${esc(e.categoria)||'<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="badge badge-${sbClass(e.status)}">${e.status}</span></td>
      <td>${progCell(e.pctAnalisis)}</td>
      <td>${progCell(e.pctDesarrollo)}</td>
      <td>${progCell(e.pctPruebas)}</td>
      <td class="muted">${fmtD(e.fechaInicio)||'—'}</td>
      <td class="muted">${fmtD(e.duedate)||'—'}</td>
      <td class="muted">${e.planPct!==null?Math.round(e.planPct*100)+'%':'—'}</td>
      <td class="muted">${e.realPct!==null?Math.round(e.realPct*100)+'%':'—'}</td>
      <td class="muted">${e.desvioPct!==null?Math.round(e.desvioPct*100)+'%':'—'}</td>
      <td class="muted">${esc(e.pais)||'—'}</td>
      <td class="muted">${esc(e.area)||'—'}</td>
      <td class="muted">${esc(e.sponsor)||'—'}</td>
      <td><button class="btn-action" type="button" title="Cronograma y detalles" onclick="openModal('${e.key}');event.stopPropagation()">···</button></td>
    </tr>
  `).join('');
  tb.querySelectorAll('tr[data-key]').forEach(tr=>tr.addEventListener('click',()=>openModal(tr.dataset.key)));
}

// ── GANTT ──
function buildGantt(e){
  if(!e.fechaInicio&&!e.duedate){
    return `<div class="gno-dates"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="margin-bottom:10px;opacity:.4;display:block;margin-left:auto;margin-right:auto"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Sin fechas definidas en Jira.<br><span style="font-size:11px;color:var(--text-dim)">Agrega Fecha de inicio y Fecha de vencimiento en la épica.</span></div>`;
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
    months.push({label:cur.toLocaleDateString('es-PE',{month:'short',year:'2-digit'}).toUpperCase(),lp:(diffD(aS,vS)/total)*100,wp:((diffD(vS,vE)+1)/total)*100});
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  const bL=Math.max(0,(diffD(aS,pS)/total)*100);
  const bR=Math.min(100,(diffD(aS,pE)/total)*100);
  const bW=Math.max(.5,bR-bL);
  const bc='gb-'+sbClass(e.status);
  const dur=diffD(pS,pE); // calendar days (for Gantt bar)
  const durWork=workDays(pS,pE); // business days (for % time)
  const grid=months.map(m=>`<div class="g-grid" style="left:${m.lp}%"></div>`).join('');
  const tp=(diffD(aS,TODAY)/total)*100;
  const tl=tp>=0&&tp<=100?`<div class="g-today" style="left:${tp.toFixed(2)}%"><div class="g-today-lbl">hoy</div></div>`:'';
  const elapsed=workDays(pS,TODAY);
  const remaining=workDays(TODAY,pE);
  const pctT=durWork>0?Math.min(100,Math.round((elapsed/durWork)*100)):0;
  const pctA=e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null;
  const advColor=pctA===null?'var(--text-muted)':pctA>=pctT?'var(--green)':pctA>=pctT-15?'var(--yellow)':'var(--red)';
  const label=esc(e.codigo||e.key);
  const phases=[
    {l:'Análisis',pct:e.pctAnalisis!==null?Math.round(e.pctAnalisis*100):null,cls:'gb-analisis',w:.20},
    {l:'Desarrollo',pct:e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null,cls:'gb-desarrollo',w:.60},
    {l:'Pruebas',pct:e.pctPruebas!==null?Math.round(e.pctPruebas*100):null,cls:'gb-pruebas',w:.20},
  ].filter(p=>p.pct!==null);
  let phRows='',off=bL;
  phases.forEach(p=>{const pw=bW*p.w;phRows+=`<div class="grow"><div class="grow-lbl">${p.l}</div><div class="grow-track">${grid}${tl}<div class="g-bar ${p.cls}" style="left:${off.toFixed(2)}%;width:${pw.toFixed(2)}%">${pw>8?p.pct+'%':''}</div></div></div>`;off+=pw;});
  return `
    <div class="gantt-meta">
      <div class="gm-item"><span class="gm-lbl">Fecha inicio</span><span class="gm-val">${fmtD(e.fechaInicio)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Fecha vencimiento</span><span class="gm-val">${fmtD(e.duedate)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Duración</span><span class="gm-val">${dur>=0?dur+' días':'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Estado</span><span class="gm-val"><span class="badge badge-${sbClass(e.status)}">${e.status}</span></span></div>
    </div>
    <div style="overflow-x:auto"><div class="gc">
      <div class="g-hdr"><div class="g-lc"></div><div class="g-months">${months.map(m=>`<div class="g-month" style="left:${m.lp.toFixed(2)}%;width:${m.wp.toFixed(2)}%">${m.label}</div>`).join('')}</div></div>
      <div class="grow"><div class="grow-lbl main">${label}</div><div class="grow-track">${grid}${tl}<div class="g-bar ${bc}" style="left:${bL.toFixed(2)}%;width:${bW.toFixed(2)}%">${bW>10?label:''}</div></div></div>
      ${phRows}
    </div></div>
    ${dur>0?`
    <div class="g-prog-row"><div class="g-prog-lbl"><span>Tiempo transcurrido</span><span>${pctT}%</span></div><div class="g-prog-track"><div class="g-prog-fill" style="width:${pctT}%;background:var(--text-dim)"></div></div></div>
    `:''}
    <div class="g-stats">
      <div class="g-stat"><div class="g-stat-lbl">Días transcurridos</div><div class="g-stat-val" style="color:var(--text-muted)">${elapsed}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">Días restantes</div><div class="g-stat-val" style="color:${remaining===0?'var(--red)':'var(--blue)'}">${remaining}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">% Desarrollo</div><div class="g-stat-val" style="color:${advColor}">${pctA!==null?pctA+'%':'—'}</div></div>
    </div>
    <div class="g-legend">
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#c85a00"></div>Desarrollo</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#1a7fa8"></div>Análisis</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#b8860b"></div>Pruebas</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:var(--red);width:2px;border-radius:0"></div>Hoy</div>
    </div>`;
}

// ── DETAIL ──
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
    <div class="dsec">Identificación</div>
    <div class="drow"><span class="dlbl">Código</span><span class="dval" style="font-family:var(--font-mono);font-weight:700;color:var(--blue)">${esc(e.codigo)||'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Clave Jira</span><span class="dval"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank">${e.key}</a></span></div>
    <div class="dsec">Asignación</div>
    <div class="drow"><span class="dlbl">Asignado</span><span class="dval ${e.asignado?'':' m'}">${esc(e.asignado)||'—'}</span></div>
    <div class="dsec">Fechas</div>
    <div class="drow"><span class="dlbl">Fecha de inicio</span><span class="dval">${fmtD(e.fechaInicio)||'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Fecha de vencimiento</span><span class="dval">${fmtD(e.duedate)?'📅 '+fmtD(e.duedate):'<span class="dval m">—</span>'}</span></div>
    <div class="dsec">Clasificación</div>
    <div class="drow"><span class="dlbl">País</span><span class="dval">${pill(e.pais)}</span></div>
    <div class="drow"><span class="dlbl">Área</span><span class="dval">${pill(e.area)}</span></div>
    <div class="drow"><span class="dlbl">Sponsor</span><span class="dval ${e.sponsor?'':'m'}'">${esc(e.sponsor)||'—'}</span></div>
    <div class="drow"><span class="dlbl">Categoría</span><span class="dval">${pill(e.categoria)}</span></div>
    <div class="drow"><span class="dlbl">Prioridad</span><span class="dval">${e.prioridad ? `<span class="pill">${e.prioridad}</span>` : '<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Doc Funcional</span><span class="dval">${pill(e.docFuncional)}</span></div>
    <div class="drow"><span class="dlbl">Responsable DF</span><span class="dval ${e.responsableDF?'':' m'}">${esc(e.responsableDF)||'—'}</span></div>
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

// ── MODAL ──
let activeEpic=null,activeTab='gantt';
function renderModalBody(){document.getElementById('modal-body').innerHTML=activeTab==='gantt'?buildGantt(activeEpic):buildDetail(activeEpic)}
function openModal(key){
  activeEpic=epics.find(e=>e.key===key);
  if(!activeEpic)return;
  activeTab='gantt';
  document.getElementById('modal-key').textContent=activeEpic.codigo||activeEpic.key;
  document.getElementById('modal-title').textContent=activeEpic.summary;
  document.getElementById('modal-panel').className='modal-panel w-gantt';
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.toggle('active',t.dataset.mtab==='gantt'));
  renderModalBody();
  document.getElementById('modal-overlay').classList.add('open');
}
document.querySelectorAll('.modal-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    activeTab=t.dataset.mtab;
    document.querySelectorAll('.modal-tab').forEach(x=>x.classList.toggle('active',x===t));
    document.getElementById('modal-panel').className='modal-panel '+(activeTab==='gantt'?'w-gantt':'w-detail');
    renderModalBody();
  });
});
document.getElementById('modal-close').addEventListener('click',()=>document.getElementById('modal-overlay').classList.remove('open'));
document.getElementById('modal-overlay').addEventListener('click',function(ev){if(ev.target===this)this.classList.remove('open')});

// ── FILTERS ──
function getFiltered(){
  const s=document.getElementById('s-search').value.toLowerCase();
  const sp=document.getElementById('s-sponsor').value;
  const p=document.getElementById('s-pais').value;
  const c=document.getElementById('s-cat').value;
  const a=document.getElementById('s-area').value;
  const ck=[...document.querySelectorAll('.estados-grid input:checked')].map(x=>x.value);
  return epics.filter(e=>{
    if(s&&!(e.codigo||'').toLowerCase().includes(s)&&!e.summary.toLowerCase().includes(s)&&!e.key.toLowerCase().includes(s))return false;
    if(sp&&e.sponsor!==sp)return false;
    if(p&&e.pais!==p)return false;
    if(c&&e.categoria!==c)return false;
    if(a&&e.area!==a)return false;
    if(ck.length&&!ck.includes(e.status))return false;
    return true;
  });
}
['s-search','s-sponsor','s-pais','s-cat','s-area'].forEach(id=>document.getElementById(id).addEventListener('input',()=>renderTable(getFiltered())));
document.querySelectorAll('.estados-grid input').forEach(cb=>cb.addEventListener('change',()=>renderTable(getFiltered())));
document.getElementById('btn-limpiar').addEventListener('click',()=>{
  document.getElementById('s-search').value='';
  ['s-sponsor','s-pais','s-cat','s-area'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('.estados-grid input').forEach(cb=>cb.checked=false);
  renderTable(epics);
});
document.querySelectorAll('.tabs .tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const panel=document.getElementById('panel-'+tab.dataset.tab);
    if(panel)panel.classList.add('active');
  });
});
// ── SORT ──
let sortCol=null, sortDir=1;
function sortedData(data){
  if(!sortCol) return data;
  return [...data].sort((a,b)=>{
    let av=a[sortCol], bv=b[sortCol];
    // nulls last
    if(av===null||av===undefined) return 1;
    if(bv===null||bv===undefined) return -1;
    // numeric fields
    if(typeof av==='number'&&typeof bv==='number') return (av-bv)*sortDir;
    // string
    return String(av).localeCompare(String(bv),'es',{sensitivity:'base'})*sortDir;
  });
}
document.querySelectorAll('thead th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    if(sortCol===col){ sortDir*=-1; }
    else{ sortCol=col; sortDir=1; }
    // Update header classes
    document.querySelectorAll('thead th').forEach(t=>{
      t.classList.remove('sort-asc','sort-desc');
      const si=t.querySelector('.sort-icon');
      if(si) si.textContent='';
    });
    th.classList.add(sortDir===1?'sort-asc':'sort-desc');
    const si=th.querySelector('.sort-icon');
    if(si) si.textContent=sortDir===1?' ↑':' ↓';
    renderTable(sortedData(getFiltered()));
  });
});

// Wrap getFiltered to also apply sort
const _origGetFiltered=getFiltered;
function getFilteredSorted(){ return sortedData(_origGetFiltered()); }
// Override filter listeners to use sort
['s-search','s-sponsor','s-pais','s-cat','s-area'].forEach(id=>{
  const el=document.getElementById(id);
  if(el){ el.replaceWith(el.cloneNode(true)); } // remove old listener
});
document.getElementById('s-search').addEventListener('input',()=>renderTable(getFilteredSorted()));
document.getElementById('s-sponsor').addEventListener('input',()=>renderTable(getFilteredSorted()));
document.getElementById('s-pais').addEventListener('input',()=>renderTable(getFilteredSorted()));
document.getElementById('s-cat').addEventListener('input',()=>renderTable(getFilteredSorted()));
document.getElementById('s-area').addEventListener('input',()=>renderTable(getFilteredSorted()));
document.querySelectorAll('.estados-grid input').forEach(cb=>cb.addEventListener('change',()=>renderTable(getFilteredSorted())));
document.getElementById('btn-limpiar').addEventListener('click',()=>{
  document.getElementById('s-search').value='';
  ['s-sponsor','s-pais','s-cat','s-area'].forEach(id=>document.getElementById(id).value='');
  document.querySelectorAll('.estados-grid input').forEach(cb=>cb.checked=false);
  sortCol=null; sortDir=1;
  document.querySelectorAll('thead th').forEach(t=>{
    t.classList.remove('sort-asc','sort-desc');
    const si=t.querySelector('.sort-icon'); if(si) si.textContent='';
  });
  renderTable(epics);
});

renderTable(epics);


const JIRA_BASE = "https://efletexia.atlassian.net/browse/";
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
let epics = [];

// ── ADF parser ──
function adfToText(node){
  if(!node) return '';
  if(typeof node==='string') return node;
  const t=node.type||'', content=node.content||[];
  if(t==='text') return node.text||'';
  if(t==='hardBreak') return '\n';
  if(t==='paragraph') return content.map(adfToText).join('')+'\n';
  if(t==='bulletList'||t==='orderedList')
    return content.map((item,i)=>(t==='orderedList'?(i+1)+'. ':'• ')+adfToText(item).trim()).join('\n')+'\n';
  if(t==='listItem') return content.map(adfToText).join('');
  return content.map(adfToText).join('');
}

// ── Parse one Jira issue ──
function parseIssue(i){
  const f=i.fields, rep=f.reporter;
  const initials=rep?rep.displayName.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase():'?';
  let bit=f.customfield_10829, prox=f.customfield_10862;
  if(bit&&typeof bit==='object')  bit  = adfToText(bit).trim();
  if(prox&&typeof prox==='object') prox = adfToText(prox).trim();
  return{
    key:           i.key,
    codigo:        f.customfield_10934||null,
    summary:       f.summary,
    status:        f.status.name,
    assignee:      f.assignee?f.assignee.displayName:null,
    asignado:      f.customfield_10970||null,
    responsableDF: f.customfield_10969||null,
    reporter:      rep?rep.displayName:null,
    reporterInitials: initials,
    labels:        f.labels||[],
    duedate:       f.duedate||null,
    fechaInicio:   f.customfield_10015||null,
    pais:          f.customfield_10592?f.customfield_10592.value:null,
    area:          f.customfield_10930?f.customfield_10930.value:null,
    categoria:     f.customfield_10659?f.customfield_10659.value:null,
    planPct:       f.customfield_10725!==undefined?f.customfield_10725:null,
    realPct:       f.customfield_10726!==undefined?f.customfield_10726:null,
    desvioPct:     f.customfield_10759!==undefined?f.customfield_10759:null,
    pctAnalisis:   f.customfield_10895!==undefined?f.customfield_10895:null,
    pctDesarrollo: f.customfield_10928!==undefined?f.customfield_10928:null,
    pctPruebas:    f.customfield_10929!==undefined?f.customfield_10929:null,
    docFuncional:  f.customfield_10931?f.customfield_10931.value:null,
    bloqueante:    f.customfield_11003?f.customfield_11003.value:null,
    conformidad:   f.customfield_11004?f.customfield_11004.value:null,
    prioridad:     f.customfield_11037?f.customfield_11037.value:null,
    sponsor:       f.customfield_11070?f.customfield_11070.value:null,
    bitacora:      bit||null,
    proximosPasos: prox||null,
  };
}

// ── Fetch one page via Vercel proxy ──
async function fetchPage(startAt=0){
  const FIELDS = [
    "summary","status","assignee","reporter","labels","duedate",
    "customfield_10015","customfield_10592","customfield_10659",
    "customfield_10725","customfield_10726","customfield_10759",
    "customfield_10895","customfield_10928","customfield_10929",
    "customfield_10930","customfield_10931","customfield_10934",
    "customfield_10829","customfield_10862","customfield_10969",
    "customfield_10970","customfield_11003","customfield_11004",
    "customfield_11037","customfield_11070"
  ];
  const resp = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jql: 'project = PTS AND issuetype = Epic ORDER BY created ASC',
      fields: FIELDS,
      maxResults: 100,
      startAt,
    })
  });
  if(!resp.ok){
    const err = await resp.text();
    throw new Error(`Jira respondió ${resp.status}: ${err}`);
  }
  return resp.json();
}

// ── Load all pages ──
async function loadData(manual=false){
  const loading    = document.getElementById('loading-screen');
  const errorScr   = document.getElementById('error-screen');
  const refreshBtn = document.getElementById('refresh-btn');

  if(manual){
    refreshBtn.classList.add('spinning');
  } else {
    loading.classList.remove('hidden');
    errorScr.classList.add('hidden');
  }
  document.getElementById('loading-text').textContent = 'Cargando épicas desde Jira...';

  try{
    // First page
    const page1 = await fetchPage(0);
    const total  = page1.total || 0;
    let issues   = page1.issues || [];

    // Fetch remaining pages in parallel if needed
    if(total > 100){
      const starts = [];
      for(let s=100; s<total; s+=100) starts.push(s);
      document.getElementById('loading-text').textContent =
        `Cargando ${total} épicas (${starts.length+1} páginas)...`;
      const rest = await Promise.all(starts.map(s=>fetchPage(s)));
      rest.forEach(p=>{ issues = issues.concat(p.issues||[]); });
    }

    epics = issues.map(parseIssue);

    // Populate filter selects
    function populateSelect(id, values, allLabel){
      const sel=document.getElementById(id); if(!sel)return;
      const cur=sel.value;
      sel.innerHTML=`<option value="">${allLabel}</option>`+
        [...new Set(values)].sort().map(v=>`<option${v===cur?' selected':''}>${v}</option>`).join('');
    }
    populateSelect('s-sponsor', epics.map(e=>e.sponsor).filter(Boolean),  'Todos');
    populateSelect('s-pais',    epics.map(e=>e.pais).filter(Boolean),      'Todos');
    populateSelect('s-cat',     epics.map(e=>e.categoria).filter(Boolean), 'Todas');
    populateSelect('s-area',    epics.map(e=>e.area).filter(Boolean),      'Todas');

    // Timestamp
    const now = new Date();
    document.getElementById('last-update').textContent =
      'Actualizado ' + now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});

    // Hide overlays
    loading.classList.add('hidden');
    errorScr.classList.add('hidden');
    refreshBtn.classList.remove('spinning');

    // Render
    sortCol=null; sortDir=1;
    renderTable(epics);
    updateKpis(epics);

  } catch(err){
    console.error(err);
    loading.classList.add('hidden');
    refreshBtn.classList.remove('spinning');
    if(!manual){
      errorScr.classList.remove('hidden');
      document.getElementById('error-msg').textContent =
        'No se pudo conectar con Jira.\n\n' + err.message +
        '\n\nVerifica que las variables de entorno JIRA_EMAIL y JIRA_TOKEN estén configuradas en Vercel.';
    } else {
      document.getElementById('last-update').textContent = '⚠ Error al actualizar';
    }
  }
}

function sbClass(s){
  return({"Backlog":"backlog","Análisis":"analisis","Desarrollo":"desarrollo","Pruebas":"pruebas","Producción":"produccion","Planificado":"planificado","Stand by":"standby","Desestimado":"desestimado","En curso":"en-curso"}[s]||"backlog");
}
function fmtD(iso){
  if(!iso)return null;
  return new Date(iso+'T12:00:00').toLocaleDateString('es-PE',{day:'2-digit',month:'short',year:'numeric'});
}
// Días calendario (para posicionamiento eje Gantt)
function diffD(a,b){return Math.round((b-a)/864e5)}
// Días hábiles lun-vie entre dos fechas (excluye sáb y dom)
function workDays(a,b){
  if(b<=a)return 0;
  let count=0;
  const d=new Date(a);d.setHours(0,0,0,0);
  const end=new Date(b);end.setHours(0,0,0,0);
  while(d<end){const dow=d.getDay();if(dow!==0&&dow!==6)count++;d.setDate(d.getDate()+1)}
  return count;
}
function progCell(pct){
  if(pct===null||pct===undefined)return '<span style="color:var(--text-muted)">—</span>';
  const w=Math.min(100,Math.round(pct*100)),cls=w>=100?" full":"";
  return `<div class="prog-cell"><div class="prog-bar"><div class="prog-fill${cls}" style="width:${w}%"></div></div><span class="prog-pct">${w}%</span></div>`;
}
function pill(v){return v?`<span class="pill">${v}</span>`:'<span class="dval m">—</span>'}
function esc(s){if(!s)return '';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function priClass(p){return p==="1"?"high":p==="3"?"low":p==="2"?"med":""}

// ── KPIs ──
(function(){
  // Render KPI shell with stable IDs (values set by updateKpis)
  document.getElementById('kpis-section').innerHTML=`
    <div class="kpi"><div class="kpi-label">Total épicas</div><div class="kpi-value c-white" id="kpi-total"></div></div>
    <div class="kpi"><div class="kpi-label">Críticos</div><div class="kpi-value c-red" id="kpi-crit"></div><div class="kpi-sub">Desv &gt;17%</div></div>
    <div class="kpi"><div class="kpi-label">Tolerancia</div><div class="kpi-value c-yellow" id="kpi-tol"></div><div class="kpi-sub">Desv 5–17%</div></div>
    <div class="kpi"><div class="kpi-label">On Track</div><div class="kpi-value c-blue" id="kpi-ont"></div><div class="kpi-sub">Desv &lt;5%</div></div>
    <div class="kpi"><div class="kpi-label">Avance prom.</div><div class="kpi-value c-cyan" id="kpi-avg"></div></div>
    <div class="kpi"><div class="kpi-label">Cierre junio</div><div class="kpi-value c-green" id="kpi-cj"></div></div>
  `;
  updateKpis(epics);
  // Areas ya pobladas en el HTML desde Jira
})();

// ── KPIs DINÁMICOS ──
function updateKpis(data){
  const t=data.length;
  const crit=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>0.17).length;
  const tol=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)>=0.05&&Math.abs(e.desvioPct)<=0.17).length;
  const onT=data.filter(e=>e.desvioPct!==null&&Math.abs(e.desvioPct)<0.05).length;
  // Avance prom. = promedio de (% Análisis + % Desarrollo + % Pruebas) por épica
  const avgs=data.map(e=>{
    const vals=[e.pctAnalisis,e.pctDesarrollo,e.pctPruebas].filter(v=>v!==null);
    return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  }).filter(v=>v!==null);
  const avg=avgs.length?Math.round(avgs.reduce((a,b)=>a+b,0)/avgs.length*100):0;
  const cj=data.filter(e=>e.duedate&&e.duedate.startsWith('2026-06')).length;
  const isFiltered=data.length<epics.length;
  // Animate values
  function setKpi(id,val){
    const el=document.getElementById(id);
    if(!el)return;
    const prev=el.dataset.val;
    if(prev!==String(val)){
      el.style.transition='opacity .15s';
      el.style.opacity='0.3';
      setTimeout(()=>{el.textContent=val;el.dataset.val=String(val);el.style.opacity='1'},150);
    }
  }
  setKpi('kpi-total', isFiltered?`${t}`:t);
  setKpi('kpi-crit', crit);
  setKpi('kpi-tol', tol);
  setKpi('kpi-ont', onT);
  setKpi('kpi-avg', avg+'%');
  setKpi('kpi-cj', cj);
  // Update header meta
  document.getElementById('hdr-meta').textContent=isFiltered
    ? `PMO TI · ${t} de ${epics.length} épicas`
    : `PMO TI · ${epics.length} épicas`;
}

// ── TABLE ──
function renderTable(data){
  updateKpis(data);
  document.getElementById('table-info').textContent=`Mostrando ${data.length} de ${epics.length} épicas`;
  const tb=document.getElementById('table-body');
  if(!data.length){tb.innerHTML='<tr><td colspan="17" style="text-align:center;padding:40px;color:var(--text-muted)">Sin resultados</td></tr>';return}
  tb.innerHTML=data.map(e=>`
    <tr data-key="${e.key}">
      <td><span class="priority-badge ${priClass(e.prioridad)}" title="Prioridad ${e.prioridad||'—'}"></span></td>
      <td class="code"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank" title="Abrir ${e.key} en Jira" onclick="event.stopPropagation()">${esc(e.codigo||e.key)}</a></td>
      <td class="proj" title="${esc(e.summary)}">${esc(e.summary)}</td>
      <td class="cat">${esc(e.categoria)||'<span style="color:var(--text-muted)">—</span>'}</td>
      <td><span class="badge badge-${sbClass(e.status)}">${e.status}</span></td>
      <td>${progCell(e.pctAnalisis)}</td>
      <td>${progCell(e.pctDesarrollo)}</td>
      <td>${progCell(e.pctPruebas)}</td>
      <td class="muted">${fmtD(e.fechaInicio)||'—'}</td>
      <td class="muted">${fmtD(e.duedate)||'—'}</td>
      <td class="muted">${e.planPct!==null?Math.round(e.planPct*100)+'%':'—'}</td>
      <td class="muted">${e.realPct!==null?Math.round(e.realPct*100)+'%':'—'}</td>
      <td class="muted">${e.desvioPct!==null?Math.round(e.desvioPct*100)+'%':'—'}</td>
      <td class="muted">${esc(e.pais)||'—'}</td>
      <td class="muted">${esc(e.area)||'—'}</td>
      <td class="muted">${esc(e.sponsor)||'—'}</td>
      <td><button class="btn-action" type="button" title="Cronograma y detalles" onclick="openModal('${e.key}');event.stopPropagation()">···</button></td>
    </tr>
  `).join('');
  tb.querySelectorAll('tr[data-key]').forEach(tr=>tr.addEventListener('click',()=>openModal(tr.dataset.key)));
}

// ── GANTT ──
function buildGantt(e){
  if(!e.fechaInicio&&!e.duedate){
    return `<div class="gno-dates"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="margin-bottom:10px;opacity:.4;display:block;margin-left:auto;margin-right:auto"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Sin fechas definidas en Jira.<br><span style="font-size:11px;color:var(--text-dim)">Agrega Fecha de inicio y Fecha de vencimiento en la épica.</span></div>`;
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
    months.push({label:cur.toLocaleDateString('es-PE',{month:'short',year:'2-digit'}).toUpperCase(),lp:(diffD(aS,vS)/total)*100,wp:((diffD(vS,vE)+1)/total)*100});
    cur=new Date(cur.getFullYear(),cur.getMonth()+1,1);
  }
  const bL=Math.max(0,(diffD(aS,pS)/total)*100);
  const bR=Math.min(100,(diffD(aS,pE)/total)*100);
  const bW=Math.max(.5,bR-bL);
  const bc='gb-'+sbClass(e.status);
  const dur=diffD(pS,pE); // calendar days (for Gantt bar)
  const durWork=workDays(pS,pE); // business days (for % time)
  const grid=months.map(m=>`<div class="g-grid" style="left:${m.lp}%"></div>`).join('');
  const tp=(diffD(aS,TODAY)/total)*100;
  const tl=tp>=0&&tp<=100?`<div class="g-today" style="left:${tp.toFixed(2)}%"><div class="g-today-lbl">hoy</div></div>`:'';
  const elapsed=workDays(pS,TODAY);
  const remaining=workDays(TODAY,pE);
  const pctT=durWork>0?Math.min(100,Math.round((elapsed/durWork)*100)):0;
  const pctA=e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null;
  const advColor=pctA===null?'var(--text-muted)':pctA>=pctT?'var(--green)':pctA>=pctT-15?'var(--yellow)':'var(--red)';
  const label=esc(e.codigo||e.key);
  const phases=[
    {l:'Análisis',pct:e.pctAnalisis!==null?Math.round(e.pctAnalisis*100):null,cls:'gb-analisis',w:.20},
    {l:'Desarrollo',pct:e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100):null,cls:'gb-desarrollo',w:.60},
    {l:'Pruebas',pct:e.pctPruebas!==null?Math.round(e.pctPruebas*100):null,cls:'gb-pruebas',w:.20},
  ].filter(p=>p.pct!==null);
  let phRows='',off=bL;
  phases.forEach(p=>{const pw=bW*p.w;phRows+=`<div class="grow"><div class="grow-lbl">${p.l}</div><div class="grow-track">${grid}${tl}<div class="g-bar ${p.cls}" style="left:${off.toFixed(2)}%;width:${pw.toFixed(2)}%">${pw>8?p.pct+'%':''}</div></div></div>`;off+=pw;});
  return `
    <div class="gantt-meta">
      <div class="gm-item"><span class="gm-lbl">Fecha inicio</span><span class="gm-val">${fmtD(e.fechaInicio)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Fecha vencimiento</span><span class="gm-val">${fmtD(e.duedate)||'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Duración</span><span class="gm-val">${dur>=0?dur+' días':'—'}</span></div>
      <div class="gm-item"><span class="gm-lbl">Estado</span><span class="gm-val"><span class="badge badge-${sbClass(e.status)}">${e.status}</span></span></div>
    </div>
    <div style="overflow-x:auto"><div class="gc">
      <div class="g-hdr"><div class="g-lc"></div><div class="g-months">${months.map(m=>`<div class="g-month" style="left:${m.lp.toFixed(2)}%;width:${m.wp.toFixed(2)}%">${m.label}</div>`).join('')}</div></div>
      <div class="grow"><div class="grow-lbl main">${label}</div><div class="grow-track">${grid}${tl}<div class="g-bar ${bc}" style="left:${bL.toFixed(2)}%;width:${bW.toFixed(2)}%">${bW>10?label:''}</div></div></div>
      ${phRows}
    </div></div>
    ${dur>0?`
    <div class="g-prog-row"><div class="g-prog-lbl"><span>Tiempo transcurrido</span><span>${pctT}%</span></div><div class="g-prog-track"><div class="g-prog-fill" style="width:${pctT}%;background:var(--text-dim)"></div></div></div>
    `:''}
    <div class="g-stats">
      <div class="g-stat"><div class="g-stat-lbl">Días transcurridos</div><div class="g-stat-val" style="color:var(--text-muted)">${elapsed}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">Días restantes</div><div class="g-stat-val" style="color:${remaining===0?'var(--red)':'var(--blue)'}">${remaining}</div></div>
      <div class="g-stat"><div class="g-stat-lbl">% Desarrollo</div><div class="g-stat-val" style="color:${advColor}">${pctA!==null?pctA+'%':'—'}</div></div>
    </div>
    <div class="g-legend">
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#c85a00"></div>Desarrollo</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#1a7fa8"></div>Análisis</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:#b8860b"></div>Pruebas</div>
      <div class="g-legend-item"><div class="g-legend-dot" style="background:var(--red);width:2px;border-radius:0"></div>Hoy</div>
    </div>`;
}

// ── DETAIL ──
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
    <div class="dsec">Identificación</div>
    <div class="drow"><span class="dlbl">Código</span><span class="dval" style="font-family:var(--font-mono);font-weight:700;color:var(--blue)">${esc(e.codigo)||'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Clave Jira</span><span class="dval"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank">${e.key}</a></span></div>
    <div class="dsec">Asignación</div>
    <div class="drow"><span class="dlbl">Asignado</span><span class="dval ${e.asignado?'':' m'}">${esc(e.asignado)||'—'}</span></div>
    <div class="dsec">Fechas</div>
    <div class="drow"><span class="dlbl">Fecha de inicio</span><span class="dval">${fmtD(e.fechaInicio)||'<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Fecha de vencimiento</span><span class="dval">${fmtD(e.duedate)?'📅 '+fmtD(e.duedate):'<span class="dval m">—</span>'}</span></div>
    <div class="dsec">Clasificación</div>
    <div class="drow"><span class="dlbl">País</span><span class="dval">${pill(e.pais)}</span></div>
    <div class="drow"><span class="dlbl">Área</span><span class="dval">${pill(e.area)}</span></div>
    <div class="drow"><span class="dlbl">Sponsor</span><span class="dval ${e.sponsor?'':'m'}'">${esc(e.sponsor)||'—'}</span></div>
    <div class="drow"><span class="dlbl">Categoría</span><span class="dval">${pill(e.categoria)}</span></div>
    <div class="drow"><span class="dlbl">Prioridad</span><span class="dval">${e.prioridad ? `<span class="pill">${e.prioridad}</span>` : '<span class="dval m">—</span>'}</span></div>
    <div class="drow"><span class="dlbl">Doc Funcional</span><span class="dval">${pill(e.docFuncional)}</span></div>
    <div class="drow"><span class="dlbl">Responsable DF</span><span class="dval ${e.responsableDF?'':' m'}">${esc(e.responsableDF)||'—'}</span></div>
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


loadData();
