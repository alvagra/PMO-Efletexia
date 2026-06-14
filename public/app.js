const JIRA_BASE = "https://efletexia.atlassian.net/browse/";
const TODAY = new Date(); TODAY.setHours(0,0,0,0);
let epics = [];



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
      <td style="text-align:center;font-weight:600;color:var(--text-primary)">${e.prioridad||'—'}</td>
      <td class="code"><a class="jlink" href="${JIRA_BASE}${e.key}" target="_blank" title="Abrir en Jira" onclick="event.stopPropagation()">${esc(e.codigo||e.key)}</a></td>
      <td class="proj" title="${esc(e.summary)}">${esc(e.summary)}</td>
      <td class="cat">${esc(e.categoria)||'<span style="color:var(--text-muted)">—</span>'}</td>
      <td class="muted">${e.area?`<span class="pill">${esc(e.area)}</span>`:'—'}</td>
      <td><span class="badge badge-${sbClass(e.status)}">${e.status}</span></td>
      <td>${progCell(e.pctDesarrollo)}</td>
      <td class="muted" style="color:${e.desvioPct!==null?(Math.abs(e.desvioPct)>0.17?'var(--red)':Math.abs(e.desvioPct)>=0.05?'var(--yellow)':'var(--green)'):'var(--text-muted)'}">${e.desvioPct!==null?Math.round(e.desvioPct*100)+'%':'—'}</td>
      <td class="muted">${e.pctDesarrollo!==null?Math.round(e.pctDesarrollo*100)+'% / '+(e.pctPruebas!==null?Math.round(e.pctPruebas*100)+'%':'—'):'—'}</td>
      <td class="muted">${fmtD(e.fechaInicio)||'—'}</td>
      <td class="muted">${fmtD(e.duedate)||'—'}</td>
      <td class="muted">—</td>
      <td class="muted">${e.conformidad==='Si'?'<span style="color:var(--green);font-size:15px">✓</span>':'—'}</td>
      <td class="muted">${e.planPct!==null?Math.round(e.planPct*100)+'% / '+(e.realPct!==null?Math.round(e.realPct*100)+'%':'—'):'—'}</td>
      <td class="muted">${e.docFuncional==='Si'?'<span style="color:var(--green);font-size:15px">✓</span>':e.docFuncional==='No'?'<span style="color:var(--red);font-size:15px">✕</span>':'—'}</td>
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


const JIRA_FIELDS = [
  "summary","status","assignee","reporter","labels","duedate",
  "customfield_10015","customfield_10592","customfield_10659",
  "customfield_10725","customfield_10726","customfield_10759",
  "customfield_10895","customfield_10928","customfield_10929",
  "customfield_10930","customfield_10931","customfield_10934",
  "customfield_10829","customfield_10862","customfield_10969",
  "customfield_10970","customfield_11003","customfield_11004",
  "customfield_11037","customfield_11070"
];

function adfToText(node){
  if(!node)return'';
  if(typeof node==='string')return node;
  const t=node.type||'',c=node.content||[];
  if(t==='text')return node.text||'';
  if(t==='hardBreak')return'\n';
  if(t==='paragraph')return c.map(adfToText).join('')+'\n';
  if(t==='bulletList'||t==='orderedList')
    return c.map((item,i)=>(t==='orderedList'?(i+1)+'. ':'• ')+adfToText(item).trim()).join('\n')+'\n';
  if(t==='listItem')return c.map(adfToText).join('');
  return c.map(adfToText).join('');
}

function parseIssue(i){
  const f=i.fields,rep=f.reporter;
  const initials=rep?rep.displayName.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase():'?';
  let bit=f.customfield_10829,prox=f.customfield_10862;
  if(bit&&typeof bit==='object')bit=adfToText(bit).trim();
  if(prox&&typeof prox==='object')prox=adfToText(prox).trim();
  return{
    key:i.key,
    codigo:f.customfield_10934||null,
    summary:f.summary,
    status:f.status.name,
    assignee:f.assignee?f.assignee.displayName:null,
    asignado:f.customfield_10970||null,
    responsableDF:f.customfield_10969||null,
    reporter:rep?rep.displayName:null,
    reporterInitials:initials,
    labels:f.labels||[],
    duedate:f.duedate||null,
    fechaInicio:f.customfield_10015||null,
    pais:f.customfield_10592?f.customfield_10592.value:null,
    area:f.customfield_10930?f.customfield_10930.value:null,
    categoria:f.customfield_10659?f.customfield_10659.value:null,
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
    bitacora:bit||null,
    proximosPasos:prox||null,
  };
}

async function fetchAllEpics(){
  const resp=await fetch('/api/jira',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({
      jql:'project = PTS AND issuetype = Epic ORDER BY created ASC',
      fields:JIRA_FIELDS,
      maxResults:100,
      startAt:0,
    })
  });
  if(!resp.ok){const err=await resp.text();throw new Error(`Jira ${resp.status}: ${err}`);}
  return resp.json();
}

async function loadData(manual=false){
  const loading=document.getElementById('loading-screen');
  const errorScr=document.getElementById('error-screen');
  const refreshBtn=document.getElementById('refresh-btn');
  if(manual){refreshBtn.classList.add('spinning');}
  else{loading.classList.remove('hidden');errorScr.classList.add('hidden');}
  document.getElementById('loading-text').textContent='Cargando épicas desde Jira...';
  try{
    const data=await fetchAllEpics();
    const issues=data.issues||[];
    document.getElementById('loading-text').textContent=`Procesando ${issues.length} épicas...`;
    epics=issues.map(parseIssue);

    function populateSelect(id,values,allLabel){
      const sel=document.getElementById(id);if(!sel)return;
      const cur=sel.value;
      sel.innerHTML=`<option value="">${allLabel}</option>`+
        [...new Set(values)].sort().map(v=>`<option${v===cur?' selected':''}>${v}</option>`).join('');
    }
    populateSelect('s-sponsor',epics.map(e=>e.sponsor).filter(Boolean),'Todos');
    populateSelect('s-pais',epics.map(e=>e.pais).filter(Boolean),'Todos');
    populateSelect('s-cat',epics.map(e=>e.categoria).filter(Boolean),'Todas');
    populateSelect('s-area',epics.map(e=>e.area).filter(Boolean),'Todas');

    const now=new Date();
    document.getElementById('last-update').textContent='Actualizado '+now.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
    loading.classList.add('hidden');
    errorScr.classList.add('hidden');
    refreshBtn.classList.remove('spinning');
    // Render KPI shell with IDs
    document.getElementById('kpis-section').innerHTML=`
      <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-value c-white" id="kpi-total"></div></div>
      <div class="kpi"><div class="kpi-label">Críticos</div><div class="kpi-value c-red" id="kpi-crit"></div><div class="kpi-sub">Desv &gt;17%</div></div>
      <div class="kpi"><div class="kpi-label">Tolerancia</div><div class="kpi-value c-yellow" id="kpi-tol"></div><div class="kpi-sub">Desv 5–17%</div></div>
      <div class="kpi"><div class="kpi-label">On Track</div><div class="kpi-value c-blue" id="kpi-ont"></div><div class="kpi-sub">Desv &lt;5%</div></div>
      <div class="kpi"><div class="kpi-label">Avance prom.</div><div class="kpi-value c-cyan" id="kpi-avg"></div></div>
      <div class="kpi"><div class="kpi-label">Cierre junio</div><div class="kpi-value c-green" id="kpi-cj"></div></div>
    `;
    sortCol=null;sortDir=1;
    renderTable(epics);
    updateKpis(epics);
  }catch(err){
    console.error(err);
    loading.classList.add('hidden');
    refreshBtn.classList.remove('spinning');
    if(!manual){
      errorScr.classList.remove('hidden');
      document.getElementById('error-msg').textContent=err.message;
    }else{
      document.getElementById('last-update').textContent='⚠ Error al actualizar';
    }
  }
}


loadData();

// ── MODAL ──
let activeEpic=null, activeTab='gantt';

function renderModalBody(){
  document.getElementById('modal-body').innerHTML =
    activeTab==='gantt' ? buildGantt(activeEpic) : buildDetail(activeEpic);
}

function openModal(key){
  activeEpic = epics.find(e=>e.key===key);
  if(!activeEpic) return;
  activeTab = 'gantt';
  document.getElementById('modal-key').textContent  = activeEpic.codigo || activeEpic.key;
  document.getElementById('modal-title').textContent = activeEpic.summary;
  document.getElementById('modal-panel').className  = 'modal-panel w-gantt';
  document.querySelectorAll('.modal-tab').forEach(t=>t.classList.toggle('active', t.dataset.mtab==='gantt'));
  renderModalBody();
  document.getElementById('modal-overlay').classList.add('open');
}

document.querySelectorAll('.modal-tab').forEach(t=>{
  t.addEventListener('click',()=>{
    activeTab = t.dataset.mtab;
    document.querySelectorAll('.modal-tab').forEach(x=>x.classList.toggle('active', x===t));
    document.getElementById('modal-panel').className = 'modal-panel ' + (activeTab==='gantt' ? 'w-gantt' : 'w-detail');
    renderModalBody();
  });
});

document.getElementById('modal-close').addEventListener('click', ()=>{
  document.getElementById('modal-overlay').classList.remove('open');
});
document.getElementById('modal-overlay').addEventListener('click', function(ev){
  if(ev.target===this) this.classList.remove('open');
});

// ── FILTERS ──
function getFiltered(){
  const s  = document.getElementById('s-search').value.toLowerCase();
  const sp = document.getElementById('s-sponsor').value;
  const p  = document.getElementById('s-pais').value;
  const c  = document.getElementById('s-cat').value;
  const a  = document.getElementById('s-area').value;
  const ck = [...document.querySelectorAll('.estados-grid input:checked')].map(x=>x.value);
  return epics.filter(e=>{
    if(s && !(e.codigo||'').toLowerCase().includes(s) && !e.summary.toLowerCase().includes(s) && !e.key.toLowerCase().includes(s)) return false;
    if(sp && e.sponsor!==sp) return false;
    if(p  && e.pais!==p)    return false;
    if(c  && e.categoria!==c) return false;
    if(a  && e.area!==a)    return false;
    if(ck.length && !ck.includes(e.status)) return false;
    return true;
  });
}

['s-search','s-sponsor','s-pais','s-cat','s-area'].forEach(id=>{
  const el=document.getElementById(id);
  if(el) el.addEventListener('input',()=>renderTable(getFiltered()));
});
document.querySelectorAll('.estados-grid input').forEach(cb=>{
  cb.addEventListener('change',()=>renderTable(getFiltered()));
});
document.getElementById('btn-limpiar').addEventListener('click',()=>{
  document.getElementById('s-search').value='';
  ['s-sponsor','s-pais','s-cat','s-area'].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=''; });
  document.querySelectorAll('.estados-grid input').forEach(cb=>cb.checked=false);
  sortCol=null; sortDir=1;
  document.querySelectorAll('thead th').forEach(t=>{
    t.classList.remove('sort-asc','sort-desc');
    const si=t.querySelector('.sort-icon'); if(si) si.textContent='';
  });
  renderTable(epics);
});

// ── SORT ──
let sortCol=null, sortDir=1;
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
document.querySelectorAll('thead th[data-col]').forEach(th=>{
  th.addEventListener('click',()=>{
    const col=th.dataset.col;
    if(sortCol===col){ sortDir*=-1; } else { sortCol=col; sortDir=1; }
    document.querySelectorAll('thead th').forEach(t=>{
      t.classList.remove('sort-asc','sort-desc');
      const si=t.querySelector('.sort-icon'); if(si) si.textContent='';
    });
    th.classList.add(sortDir===1?'sort-asc':'sort-desc');
    const si=th.querySelector('.sort-icon'); if(si) si.textContent=sortDir===1?' ↑':' ↓';
    renderTable(sortedData(getFiltered()));
  });
});

// ── TABS ──
document.querySelectorAll('.tabs .tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.tabs .tab').forEach(t=>t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
    tab.classList.add('active');
    const panel=document.getElementById('panel-'+tab.dataset.tab);
    if(panel) panel.classList.add('active');
    // Load recursos data when switching to that tab
    if(tab.dataset.tab==='recursos' && recursos.length===0) loadRecursos();
  });
});



// ── CARGA DE RECURSOS DESDE JIRA ──
async function loadRecursos() {
  const tbody = document.getElementById('rec-table-body');
  const info  = document.getElementById('rec-table-info');
  if(info) info.textContent = 'Cargando recursos desde Jira...';

  try {
    const respRec = await fetch('/api/jira', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ type:'recursos' }) });
    if(!respRec.ok) throw new Error('Error recursos ' + respRec.status);
    const dataRec          = await respRec.json();
    const historias        = dataRec.issues || [];          // en realidad son Tareas
    const historiaToEpica  = dataRec.historiaToEpica || {}; // Historia.key → {key, nombre} de Épica

    // Capacity: 168h/month standard
    const CAPACITY = 168;
    const today = new Date(); today.setHours(0,0,0,0);
    const fechaCorteEl = document.getElementById('rec-fecha-corte');
    const fechaCorte = fechaCorteEl && fechaCorteEl.value ? new Date(fechaCorteEl.value + 'T12:00:00') : today;
    const mesActual = fechaCorte.getMonth();
    const anioActual = fechaCorte.getFullYear();
    const diasMes = new Date(anioActual, mesActual+1, 0).getDate();
    const diaCorte = fechaCorte.getDate();
    const horasTranscurridas = Math.round((diaCorte / diasMes) * CAPACITY);
    const horasFuturas = CAPACITY - horasTranscurridas;

    // Update fecha corte info bar
    const paises = ['Perú','Colombia','México','Guatemala','Regional'];
    const mesNombre = fechaCorte.toLocaleDateString('es-PE',{month:'long',year:'numeric'});
    const avanceMes = Math.round((diaCorte/diasMes)*100);
    const infoBar = document.getElementById('rec-corte-info');
    if(infoBar) infoBar.innerHTML = `
      <span style="color:var(--text-muted);font-size:12px">Ref. · ${mesNombre} &nbsp;|&nbsp;
      Capacidad mensual: <span style="color:var(--blue)">${CAPACITY}h</span> &nbsp;|&nbsp;
      Horas transcurridas: <span style="color:var(--text-muted)">${horasTranscurridas}h</span> &nbsp;|&nbsp;
      Horas futuras disponibles: <span style="color:var(--yellow)">${horasFuturas}h</span> &nbsp;|&nbsp;
      Avance del mes: <span style="color:var(--green)">${avanceMes}%</span></span>
    `;

    // Group by assignee
    const byPerson = {};
    historias.forEach(h => {
      const f = h.fields;
      const nombre = f.assignee ? f.assignee.displayName : 'Sin asignar';
      const horasEst  = f.customfield_11136 || 0;
      const horasPend = f.customfield_11137 || 0;
      const horasCerr = Math.max(0, horasEst - horasPend);
      // Tarea → parent = Historia → historiaToEpica[Historia.key] = Épica
      const parentDir  = f.parent || null;
      const historiaKey = parentDir ? parentDir.key : null;
      const epicaInfo  = historiaKey && historiaToEpica[historiaKey]
                           ? historiaToEpica[historiaKey]
                           : (parentDir ? { key: parentDir.key, nombre: parentDir.fields ? parentDir.fields.summary : parentDir.key } : null);
      const epicaKey   = epicaInfo ? epicaInfo.key   : null;
      const epicaNom   = epicaInfo ? epicaInfo.nombre : 'Sin épica';
      const area      = f.customfield_10930 ? f.customfield_10930.value : null;
      const pais      = f.customfield_10592 ? f.customfield_10592.value : null;
      const bloq      = f.customfield_11003 ? f.customfield_11003.value : null;
      const status    = f.status ? f.status.name : '';
      const isDone    = ['Finalizada','Producción','En producción','Cerrado','Done','Closed'].includes(status);

      if(!byPerson[nombre]){
        byPerson[nombre] = {
          nombre, area, pais,
          horasEst:0, horasPend:0, horasCerr:0,
          totalHistorias:0, entregasPend:0, bloqueantes:0,
          epicasMap: {},
        };
      }
      const p = byPerson[nombre];
      p.horasEst   += horasEst;
      p.horasPend  += horasPend;
      p.horasCerr  += horasCerr;
      p.totalHistorias++;
      if(!isDone) p.entregasPend++;
      if(bloq === 'Si') p.bloqueantes++;
      if(area && !p.area) p.area = area;
      if(pais && !p.pais) p.pais = pais;

      // Épica tracking
      if(epicaKey){
        if(!p.epicasMap[epicaKey]){
          p.epicasMap[epicaKey] = { key:epicaKey, nombre:epicaNom, horasEst:0, horasPend:0, actividades:0, pendientes:0, tareas:[] };
        }
        p.epicasMap[epicaKey].horasEst   += horasEst;
        p.epicasMap[epicaKey].horasPend  += horasPend;
        p.epicasMap[epicaKey].actividades++;
        if(!isDone) p.epicasMap[epicaKey].pendientes++;
        p.epicasMap[epicaKey].tareas.push({
          key:      h.key,
          nombre:   f.summary || h.key,
          status,
          isDone,
          horasEst,
          horasPend,
          fecha:    f.customfield_10015 || f.duedate || f.created || null,
        });
      }
    });

    // Build recursos array sorted by horasPend desc
    recursos = Object.values(byPerson).map(p => ({
      nombre:         p.nombre,
      area:           p.area,
      pais:           p.pais,
      proyectos:      Object.keys(p.epicasMap).length,
      horasPend:      p.horasPend,
      horasTotal:     p.horasEst,
      horasCerr:      p.horasCerr,
      horasLibre:     Math.max(0, CAPACITY - p.horasEst),
      entregasPend:   p.entregasPend,
      bloqueantes:    p.bloqueantes,
      proyectosDetalle: Object.values(p.epicasMap).map(e => ({
        key:        e.key,
        nombre:     e.nombre,
        horasTotal: e.horasEst,
        horasPend:  e.horasPend,
        actividades:e.actividades,
        pendientes: e.pendientes,
        tareas:     e.tareas || [],
      })).sort((a,b) => b.horasTotal - a.horasTotal),
    })).filter(r => r.nombre !== 'Sin asignar')
      .sort((a,b) => b.horasPend - a.horasPend);

    renderRecursos();

  } catch(err) {
    console.error('Error cargando recursos:', err);
    if(info) info.textContent = 'Error al cargar recursos: ' + err.message;
  }
}

// ── RECURSOS ──
(function initRecursos(){
  // Set default fecha corte = today
  const today = new Date().toISOString().split('T')[0];
  const fechaInput = document.getElementById('rec-fecha-corte');
  if(fechaInput){
    fechaInput.value = today;
    fechaInput.addEventListener('change', ()=>{ if(recursos.length>0) renderRecursos(); });
  }

  // Area buttons
  document.querySelectorAll('.rec-area-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.rec-area-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderRecursos();
    });
  });

  // Search + pais
  ['rec-search','rec-pais'].forEach(id => {
    const el = document.getElementById(id);
    if(el) el.addEventListener('input', renderRecursos);
  });

  // Limpiar
  const limpiar = document.getElementById('rec-limpiar');
  if(limpiar) limpiar.addEventListener('click', () => {
    document.getElementById('rec-search').value = '';
    document.getElementById('rec-pais').value = '';
    document.querySelectorAll('.rec-area-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.rec-area-btn[data-area=""]').classList.add('active');
    renderRecursos();
  });
})();

// Datos de recursos — se poblarán desde Jira cuando estén disponibles
let recursos = [];

function getAreaClass(area) {
  const m = {
    'Desarrollo':'rec-area-desarrollo','Data':'rec-area-data',
    'PMO':'rec-area-pmo','PM':'rec-area-pm',
    'Torre de Control':'rec-area-torre','Soporte TI':'rec-area-soporte',
    'Operacion':'rec-area-operacion'
  };
  return m[area] || 'rec-area-default';
}

function renderRecursos() {
  const search = (document.getElementById('rec-search')?.value||'').toLowerCase();
  const area   = document.querySelector('.rec-area-btn.active')?.dataset.area || '';
  const pais   = document.getElementById('rec-pais')?.value || '';

  let filtered = recursos.filter(r => {
    if(search && !r.nombre.toLowerCase().includes(search)) return false;
    if(area && r.area !== area) return false;
    if(pais && r.pais !== pais) return false;
    return true;
  });

  // Update KPIs
  const total    = filtered.length;
  const alta     = filtered.filter(r => r.horasPend >= 40).length;
  const media    = filtered.filter(r => r.horasPend >= 20 && r.horasPend < 40).length;
  const baja     = filtered.filter(r => r.horasPend < 20).length;
  const totalH   = filtered.reduce((a,r) => a + r.horasPend, 0);
  const totalE   = filtered.reduce((a,r) => a + r.entregasPend, 0);

  const setKpi = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
  setKpi('rec-kpi-total', total||'—');
  setKpi('rec-kpi-alta',  alta||'0');
  setKpi('rec-kpi-media', media||'0');
  setKpi('rec-kpi-baja',  baja||'0');
  setKpi('rec-kpi-horas', totalH ? totalH.toFixed(2)+'h' : '—');
  setKpi('rec-kpi-entregas', totalE||'—');

  const info = document.getElementById('rec-table-info');
  if(info) info.textContent = `Mostrando ${filtered.length} de ${recursos.length} recursos`;

  const tbody = document.getElementById('rec-table-body');
  if(!tbody) return;

  if(!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="rec-empty">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" style="margin-bottom:10px;opacity:.3;display:block;margin-left:auto;margin-right:auto"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8"/></svg>
      ${recursos.length === 0 ? 'Los datos de recursos se cargarán cuando estén disponibles en Jira' : 'Sin resultados para los filtros aplicados'}
    </td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    // Horas color
    const hClass = r.horasPend >= 40 ? 'rec-hours-high' : r.horasPend >= 20 ? 'rec-hours-med' : r.horasPend > 0 ? 'rec-hours-low' : 'rec-hours-zero';
    const eClass = r.entregasPend > 10 ? 'rec-entregas-high' : 'rec-entregas-low';

    // Distribución carga mensual
    const totalH2 = r.horasCerr + r.horasPend + r.horasLibre;
    const pCerr  = totalH2 > 0 ? (r.horasCerr / totalH2 * 100).toFixed(1) : 0;
    const pPend  = totalH2 > 0 ? (r.horasPend / totalH2 * 100).toFixed(1) : 0;
    const ocupPct = totalH2 > 0 ? Math.round((r.horasCerr + r.horasPend) / totalH2 * 100) : 0;
    const ocupColor = ocupPct >= 90 ? 'over' : ocupPct >= 70 ? '' : 'ok';

    const distBar = `
      <div class="rec-dist-cell">
        <div style="position:relative">
          <div class="rec-dist-bar-wrap">
            <div class="rec-dist-cerr" style="width:${pCerr}%"></div>
            <div class="rec-dist-pend" style="width:${pPend}%"></div>
          </div>
          <div class="rec-dist-pct ${ocupColor}" style="position:absolute;right:4px;top:-1px;font-size:10px;font-weight:700;color:${ocupPct>=90?'var(--red)':ocupPct>=70?'var(--yellow)':'var(--green)'}">${ocupPct}%</div>
        </div>
        <div class="rec-dist-labels">
          <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--green)"></span>${r.horasCerr}h cerr.</span>
          <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--yellow)"></span>${r.horasPend}h pend.</span>
          <span class="rec-dist-lbl"><span class="rec-dist-dot" style="background:var(--bg-elevated);border:1px solid var(--border)"></span>${r.horasLibre}h libre</span>
        </div>
      </div>`;

    // Bloqueantes
    const bloqHtml = r.bloqueantes > 0
      ? `<span class="rec-bloq rec-bloq-warn">⚠ ${r.bloqueantes}</span>`
      : `<span class="rec-bloq rec-bloq-ok">✓</span>`;

    return `<tr>
      <td><span class="rec-name">${r.nombre}</span></td>
      <td><span class="rec-area-badge ${getAreaClass(r.area)}">${r.area||'—'}</span></td>
      <td style="text-align:center">${r.proyectos}</td>
      <td><span class="${hClass}">${r.horasPend}h</span></td>
      <td style="color:var(--text-muted)">${r.horasTotal}h</td>
      <td><span class="${eClass}">${r.entregasPend}</span></td>
      <td>${distBar}</td>
      <td>${bloqHtml}</td>
      <td><button class="rec-ver-btn" onclick="verRecurso('${r.nombre}')">Ver →</button></td>
    </tr>`;
  }).join('');
}

function verRecurso(nombre) {
  const r = recursos.find(x => x.nombre === nombre);
  if(!r) return;

  document.getElementById('rec-modal-name').textContent = r.nombre;
  document.getElementById('rec-modal-area').textContent = r.area || '—';

  const proyectos = r.proyectosDetalle || [];
  const totalHrs  = proyectos.reduce((a,p) => a + (p.horasTotal||0), 0);

  // Stats
  const statsHtml = `
    <div class="rec-modal-stats">
      <div class="rec-modal-stat">
        <div class="rec-modal-stat-val c-blue">${r.proyectos}</div>
        <div class="rec-modal-stat-lbl">Proyectos</div>
      </div>
      <div class="rec-modal-stat">
        <div class="rec-modal-stat-val" style="color:${r.horasPend>=40?'var(--red)':r.horasPend>=20?'var(--yellow)':'var(--green)'}">${r.horasPend}h</div>
        <div class="rec-modal-stat-lbl">Horas Pend.</div>
      </div>
      <div class="rec-modal-stat">
        <div class="rec-modal-stat-val" style="color:${r.entregasPend>10?'var(--red)':'var(--green)'}">${r.entregasPend}</div>
        <div class="rec-modal-stat-lbl">Entregas Pend.</div>
      </div>
    </div>`;

  // Participación por proyecto
  let partRows = '';
  if(proyectos.length && totalHrs > 0) {
    partRows = proyectos.map(p => {
      const pct = Math.round((p.horasTotal / totalHrs) * 100);
      return `<div class="rec-part-row">
        <span class="rec-part-name" title="${p.nombre}">${p.nombre}</span>
        <div class="rec-part-bar-wrap"><div class="rec-part-bar-fill" style="width:${pct}%"></div></div>
        <span class="rec-part-pct">${pct}%</span>
        <span class="rec-part-hrs">${p.horasTotal}h</span>
      </div>`;
    }).join('');
    partRows += `<div class="rec-part-total">Total: ${totalHrs}h</div>`;
  } else {
    partRows = '<div style="color:var(--text-dim);font-size:12px">Sin datos de proyectos disponibles</div>';
  }

  // Proyectos · Actividades
  let projCards = '';
  if(proyectos.length) {
    projCards = proyectos.map(p => {
      const hasPend = p.pendientes > 0;
      const recursoNombre = encodeURIComponent(r.nombre);
      return `<div class="rec-proj-card">
        <div class="rec-proj-card-left">
          <div class="rec-proj-card-name">${p.nombre}</div>
          <div class="rec-proj-card-meta">${p.actividades} act · ${p.horasTotal}h · ${p.horasPend}h pend.</div>
        </div>
        <span class="rec-proj-pend-badge ${hasPend?'has-pend':'no-pend'}">${p.pendientes} pend.</span>
        <button class="rec-proj-link" title="Ver detalle" onclick="verProyecto('${recursoNombre}','${p.key}');event.stopPropagation()">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </button>
      </div>`;
    }).join('');
  } else {
    projCards = '<div style="color:var(--text-dim);font-size:12px">Sin proyectos registrados</div>';
  }

  document.getElementById('rec-modal-body').innerHTML = `
    ${statsHtml}
    <div style="margin-bottom:20px">
      <div class="rec-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Participación por proyecto
      </div>
      ${partRows}
    </div>
    <div>
      <div class="rec-section-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        Proyectos · Actividades
      </div>
      ${projCards}
    </div>
  `;

  document.getElementById('rec-modal-overlay').classList.add('open');
}

// ── DETALLE DE PROYECTO (segundo modal anidado) ──
function verProyecto(recursoEncoded, epicaKey) {
  const recursoNombre = decodeURIComponent(recursoEncoded);
  const r = recursos.find(x => x.nombre === recursoNombre);
  if(!r) return;
  const p = (r.proyectosDetalle || []).find(x => x.key === epicaKey);
  if(!p) return;

  document.getElementById('det-title').textContent = p.nombre;

  // Obtener datos de la épica del portafolio global si existe
  const epicaGlobal = epics.find(e => e.key === epicaKey);
  const estado   = epicaGlobal ? epicaGlobal.status    : '—';
  const area     = epicaGlobal ? epicaGlobal.area      : (r.area || '—');
  const sponsor  = epicaGlobal ? epicaGlobal.sponsor   : '—';
  const avance   = epicaGlobal ? (epicaGlobal.planPct!=null&&epicaGlobal.realPct!=null
    ? Math.round(epicaGlobal.realPct*100)+'% / Plan '+Math.round(epicaGlobal.planPct*100)+'%'
    : epicaGlobal.pctDesarrollo!=null ? Math.round(epicaGlobal.pctDesarrollo*100)+'%' : '—') : '—';
  const fin      = epicaGlobal ? fmtD(epicaGlobal.duedate) : (p.tareas&&p.tareas.length?null:'—');
  const desvioPct= epicaGlobal && epicaGlobal.desvioPct!=null ? Math.round(epicaGlobal.desvioPct*100) : null;
  const desvColor= desvioPct===null?'var(--text-muted)':Math.abs(desvioPct)>17?'var(--red)':Math.abs(desvioPct)>=5?'var(--yellow)':'var(--green)';
  const sbCls    = {'Backlog':'backlog','Análisis':'analisis','Desarrollo':'desarrollo','Pruebas':'pruebas','Producción':'produccion','Planificado':'planificado','Stand by':'standby','Desestimado':'desestimado','En curso':'en-curso'}[estado]||'backlog';

  // Sección PROYECTO
  const proyectoHtml = `
    <div class="det-sec">
      <div class="det-sec-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        Proyecto
      </div>
      <div class="det-field"><span class="det-lbl">Estado</span><span class="det-val"><span class="badge badge-${sbCls}">${esc(estado)}</span></span></div>
      <div class="det-field"><span class="det-lbl">Área</span><span class="det-val">${esc(area)||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Sponsor</span><span class="det-val">${esc(sponsor)||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Avance</span><span class="det-val">${avance}</span></div>
      <div class="det-field"><span class="det-lbl">Fin</span><span class="det-val">${fin||'—'}</span></div>
      <div class="det-field"><span class="det-lbl">Desvío</span><span class="det-val" style="color:${desvColor};font-weight:600">${desvioPct!==null?desvioPct+'%':'—'}</span></div>
    </div>`;

  // Sección ACTIVIDADES
  const tareas = p.tareas || [];
  let tareasHtml = '';
  if(tareas.length) {
    tareasHtml = tareas.map(t => {
      const doneCls = t.isDone ? 'done' : 'open';
      const doneLabel = t.isDone ? 'Cerrado' : 'En proceso';
      return `<div class="det-task-row">
        <span class="det-task-date">${t.fecha ? fmtD(t.fecha) : '—'}</span>
        <span class="det-task-name" title="${esc(t.nombre)}">${esc(t.nombre)}</span>
        <span class="det-task-hrs">${t.horasEst}h</span>
        <span class="det-task-status"><span class="det-badge ${doneCls}">${doneLabel}</span></span>
      </div>`;
    }).join('');
  } else {
    tareasHtml = '<div style="color:var(--text-muted);font-size:12px;padding:8px 0">Sin actividades registradas</div>';
  }

  document.getElementById('det-body').innerHTML = `
    <div class="det-stats">
      <div class="det-stat"><div class="det-stat-val" style="color:var(--blue)">${p.actividades}</div><div class="det-stat-lbl">Actividades</div></div>
      <div class="det-stat"><div class="det-stat-val" style="color:${p.horasPend>=40?'var(--red)':p.horasPend>=20?'var(--yellow)':'var(--green)'}">${p.horasPend}h</div><div class="det-stat-lbl">Horas Pend.</div></div>
      <div class="det-stat"><div class="det-stat-val" style="color:var(--blue)">${p.horasTotal}h</div><div class="det-stat-lbl">Horas Total</div></div>
    </div>
    ${proyectoHtml}
    <div class="det-sec">
      <div class="det-sec-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        Actividades de ${esc(recursoNombre)}
      </div>
      ${tareasHtml}
    </div>`;

  document.getElementById('det-panel').classList.add('open');
}

function closeDetModal(){
  const panel = document.getElementById('det-panel');
  if(panel) panel.classList.remove('open');
}
(function(){
  const btn = document.getElementById('det-close');
  if(btn) btn.addEventListener('click', function(ev){ ev.stopPropagation(); closeDetModal(); });
})();

// Close recurso modal
function closeRecModal(){
  const ov = document.getElementById('rec-modal-overlay');
  if(ov) ov.classList.remove('open');
}
// Bind close button and overlay backdrop directly (elementos ya presentes en DOM)
(function(){
  const ov  = document.getElementById('rec-modal-overlay');
  const btn = document.getElementById('rec-modal-close');
  if(btn) btn.addEventListener('click', function(ev){ ev.stopPropagation(); closeRecModal(); });
  if(ov)  ov.addEventListener('click',  function(ev){ if(ev.target === ov) closeRecModal(); });
})();
// Cerrar modales con Escape (en cascada: det → rec → portfolio)
document.addEventListener('keydown', function(ev){
  if(ev.key === 'Escape'){
    const detOv = document.getElementById('det-panel');
    if(detOv && detOv.classList.contains('open')){ closeDetModal(); return; }
    const recOv = document.getElementById('rec-modal-overlay');
    if(recOv && recOv.classList.contains('open')){ closeRecModal(); return; }
    const mo = document.getElementById('modal-overlay');
    if(mo && mo.classList.contains('open')) mo.classList.remove('open');
  }
});

// Remove Capacidad tab logic (if any remains)
document.querySelectorAll('.tabs .tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('panel-' + tab.dataset.tab);
    if(panel) panel.classList.add('active');
  });
});
