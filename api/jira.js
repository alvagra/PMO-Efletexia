const https = require('https');

function jiraGet(auth, cloud, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${cloud}.atlassian.net`,
      path,
      method: 'GET',
      headers: { 'Authorization': `Basic ${auth}`, 'Accept': 'application/json' },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function fetchAllPages(auth, cloud, jql, fields) {
  const fieldsStr = Array.isArray(fields) ? fields.join(',') : fields;
  let allIssues = [];
  let nextPageToken = null;
  do {
    const params = new URLSearchParams({ jql, fields: fieldsStr, maxResults: 100 });
    if (nextPageToken) params.set('nextPageToken', nextPageToken);
    const result = await jiraGet(auth, cloud, `/rest/api/3/search/jql?${params.toString()}`);
    if (result.status !== 200) throw new Error(`Jira ${result.status}: ${JSON.stringify(result.body)}`);
    const page = result.body;
    allIssues = allIssues.concat(page.issues || []);
    nextPageToken = page.isLast ? null : page.nextPageToken;
    if (allIssues.length >= 2000) break;
  } while (nextPageToken);
  return allIssues;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const JIRA_EMAIL = process.env.JIRA_EMAIL;
  const JIRA_TOKEN = process.env.JIRA_TOKEN;
  const JIRA_CLOUD = process.env.JIRA_CLOUD || 'efletexia';

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(500).json({ error: 'Credenciales no configuradas.' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const { type } = req.body || {};

  try {
    if (type === 'ventas') {
      // Fetch all Ventas issues (mismos campos custom que Épicas)
      const VENTA_FIELDS = [
        'summary', 'status', 'assignee', 'duedate', 'parent',
        'customfield_10015', // Fecha inicio
        'customfield_10930', // Área
        'customfield_10592', // País
        'customfield_10931', // Sponsor
        'customfield_10929', // Categoría
        'customfield_10725', // % Plan
        'customfield_10726', // % Real
        'customfield_10759', // Desvío %
        'customfield_10895', // % Análisis
        'customfield_10928', // % Desarrollo
        'customfield_10969', // % Pruebas
        'customfield_11003', // Bloqueante
        'customfield_11136', // Horas Estimadas
        'customfield_11137', // Horas Pendientes
      ];
      const issues = await fetchAllPages(
        auth, JIRA_CLOUD,
        'project = PTS AND issuetype = Venta ORDER BY assignee ASC',
        VENTA_FIELDS
      );
      return res.status(200).json({ issues, total: issues.length, type: 'ventas' });

    } else if (type === 'recursos') {
      // Subtareas: parent = Tarea, Tarea.parent = Épica
      const SUBTAREA_FIELDS = [
        'summary', 'status', 'assignee', 'parent', 'duedate', 'created',
        'customfield_10015', // Fecha inicio
        'customfield_10930', // Área
        'customfield_10592', // País
        'customfield_11003', // Bloqueante
        'customfield_11136', // Horas Estimadas
        'customfield_11137', // Horas Pendientes
      ];
      const issues = await fetchAllPages(
        auth, JIRA_CLOUD,
        'project = PTS AND issuetype = Subtarea ORDER BY assignee ASC',
        SUBTAREA_FIELDS
      );

      // Resolver el segundo nivel: Subtarea→Tarea→Épica
      // Recopilar todas las Tareas padre únicas que aún no conocemos la épica
      const tareaKeys = [...new Set(
        issues
          .map(i => i.fields.parent?.key)
          .filter(Boolean)
      )];

      // Traer solo las Tareas necesarias para obtener su parent (Épica)
      const tareaMap = {};
      const CHUNK = 50;
      for (let i = 0; i < tareaKeys.length; i += CHUNK) {
        const chunk = tareaKeys.slice(i, i + CHUNK);
        const jqlChunk = `key in (${chunk.join(',')})`;
        const tareas = await fetchAllPages(auth, JIRA_CLOUD, jqlChunk, ['summary', 'parent']);
        tareas.forEach(t => { tareaMap[t.key] = t; });
      }

      // Enriquecer cada subtarea con la épica de su tarea padre
      issues.forEach(sub => {
        const tareaKey = sub.fields.parent?.key;
        const tarea = tareaKey ? tareaMap[tareaKey] : null;
        sub.fields._tareaParent  = tarea ? { key: tarea.key, summary: tarea.fields?.summary } : null;
        sub.fields._epicaParent  = tarea?.fields?.parent
          ? { key: tarea.fields.parent.key, summary: tarea.fields.parent.fields?.summary }
          : null;
      });

      return res.status(200).json({ issues, total: issues.length, type: 'recursos' });

    } else if (type === 'stories') {
      const { epicKey } = req.body;
      if (!epicKey) return res.status(400).json({ error: 'epicKey requerido' });

      const STORY_FIELDS = ['summary','status','assignee','parent','customfield_10015','duedate','subtasks','customfield_10725','customfield_10726','issuetype','customfield_10930','customfield_11070','customfield_11004','customfield_10895','customfield_10928','customfield_10929','customfield_10934','story_points','customfield_10016'];
      const SUBTASK_FIELDS = ['summary','status','assignee','parent','customfield_10015','duedate','issuetype','timespent','customfield_10934','customfield_11136'];

      // Buscar todos los hijos directos de la épica (Next-gen: parent=EPIC; clásico: Epic Link)
      let storiesFinal = await fetchAllPages(auth, JIRA_CLOUD,
        `project = PTS AND parent = ${epicKey} ORDER BY created ASC`,
        STORY_FIELDS);

      if (!storiesFinal.length) {
        storiesFinal = await fetchAllPages(auth, JIRA_CLOUD,
          `project = PTS AND "Epic Link" = ${epicKey} AND issuetype not in subTaskIssueTypes() ORDER BY created ASC`,
          STORY_FIELDS);
      }

      // Filtrar solo historias/tareas (excluir subtareas que puedan aparecer)
      storiesFinal = storiesFinal.filter(s => {
        const it = (s.fields?.issuetype?.name || '').toLowerCase();
        return !['subtarea','subtask','sub-task','sub-tarea'].includes(it);
      });

      // Subtareas de cada historia
      const storyKeys = storiesFinal.map(s => s.key);
      const subtaskMap = {};
      for (let i = 0; i < storyKeys.length; i += 50) {
        const chunk = storyKeys.slice(i, i + 50);
        if (!chunk.length) continue;
        const subs = await fetchAllPages(auth, JIRA_CLOUD,
          `project = PTS AND parent in (${chunk.join(',')}) ORDER BY created ASC`,
          SUBTASK_FIELDS);
        subs.forEach(sub => {
          const pk = sub.fields.parent?.key;
          if (pk) { if (!subtaskMap[pk]) subtaskMap[pk] = []; subtaskMap[pk].push(sub); }
        });
      }

      storiesFinal.forEach(s => { s.fields._subtasks = subtaskMap[s.key] || []; });
      return res.status(200).json({ stories: storiesFinal, total: storiesFinal.length, type: 'stories' });


    } else if (type === 'capacity') {
      // Subtareas + worklogs por fecha
      // 1. Traer todas las subtareas (mínimo de campos necesarios)
      const CAP_FIELDS = [
        'summary', 'assignee', 'parent',
        'customfield_10015', // Fecha inicio
        'duedate',
        'customfield_10930', // Área
        'customfield_11136', // Horas Estimadas
        'customfield_11137', // Horas Pendientes
        'customfield_11037', // Asignado (iniciales múltiples, ej: RP, AA, EN)
        'customfield_11070', // Asignado alternativo
      ];
      const subtareas = await fetchAllPages(
        auth, JIRA_CLOUD,
        'project = PTS AND issuetype = Subtarea ORDER BY created ASC',
        CAP_FIELDS
      );

      // 2. Obtener épica de cada subtarea: subtarea → historia (parent) → épica (parent.parent)
      //    Recoger keys únicos de historias padre, buscarlas en batch
      const storyKeys = [...new Set(
        subtareas.map(s => s.fields?.parent?.key).filter(Boolean)
      )];

      // Mapa storyKey → epicSummary + epicCodigo
      const epicNameMap = {};
      const epicCodigoMap = {};
      if (storyKeys.length) {
        // Buscar historias en lotes de 50 usando JQL IN
        const STORY_BATCH = 50;
        for (let i = 0; i < storyKeys.length; i += STORY_BATCH) {
          const batch = storyKeys.slice(i, i + STORY_BATCH);
          const jqlStories = `key in (${batch.join(',')})`;
          const stories = await fetchAllPages(auth, JIRA_CLOUD, jqlStories,
            ['parent','summary','customfield_10934']);
          stories.forEach(story => {
            // story.fields.parent es la épica (nombre)
            const epicSummary = story.fields?.parent?.fields?.summary || story.fields?.parent?.key || '';
            epicNameMap[story.key] = epicSummary;
            // El código está en la historia misma si lo tiene, sino hay que ir a la épica
            const epicCodigo = story.fields?.customfield_10934 || '';
            epicCodigoMap[story.key] = epicCodigo;
            // Guardar key de la épica para buscar su código si la historia no lo tiene
            if(!epicCodigo && story.fields?.parent?.key){
              epicCodigoMap['__needsEpic__' + story.key] = story.fields.parent.key;
            }
          });

          // Para historias sin código propio, buscar el código en la épica
          const storiesNeedingEpic = Object.keys(epicCodigoMap)
            .filter(k => k.startsWith('__needsEpic__'));
          if(storiesNeedingEpic.length){
            const epicKeys = [...new Set(storiesNeedingEpic.map(k => epicCodigoMap[k]))];
            const EPIC_BATCH2 = 50;
            const epicCodigoDirect = {};
            for(let ei = 0; ei < epicKeys.length; ei += EPIC_BATCH2){
              const eBatch = epicKeys.slice(ei, ei + EPIC_BATCH2);
              const jqlEpics = `key in (${eBatch.join(',')})`;
              const epics2 = await fetchAllPages(auth, JIRA_CLOUD, jqlEpics, ['customfield_10934']);
              epics2.forEach(ep => { epicCodigoDirect[ep.key] = ep.fields?.customfield_10934 || ''; });
            }
            storiesNeedingEpic.forEach(k => {
              const storyKey = k.replace('__needsEpic__','');
              const epicKey  = epicCodigoMap[k];
              epicCodigoMap[storyKey] = epicCodigoDirect[epicKey] || '';
              delete epicCodigoMap[k];
            });
          }
        }
      }

      // Inyectar epicName en cada subtarea
      subtareas.forEach(s => {
        const storyKey = s.fields?.parent?.key;
        s.fields._epicName   = storyKey ? (epicNameMap[storyKey]   || '') : '';
        s.fields._epicCodigo = storyKey ? (epicCodigoMap[storyKey] || '') : '';
      });

      // 3. Por cada subtarea, traer su worklog via REST
      //    GET /rest/api/3/issue/{key}/worklog
      //    Limitamos a 100 entradas por issue (suficiente para registros de actividad)
      async function fetchWorklog(key) {
        const result = await jiraGet(auth, JIRA_CLOUD, `/rest/api/3/issue/${key}/worklog?maxResults=100`);
        if (result.status !== 200) return [];
        return result.body.worklogs || [];
      }

      // Fetch worklogs en lotes de 10 en paralelo para no saturar la API
      const BATCH = 10;
      for (let i = 0; i < subtareas.length; i += BATCH) {
        const batch = subtareas.slice(i, i + BATCH);
        const logs = await Promise.all(batch.map(s => fetchWorklog(s.key)));
        batch.forEach((s, idx) => { s.fields._worklogs = logs[idx]; });
      }

      return res.status(200).json({ issues: subtareas, total: subtareas.length, type: 'capacity' });

    } else {
      // Default: fetch Epics
      const { jql, fields } = req.body || {};
      const jqlStr = jql || 'project = PTS AND issuetype = Epic ORDER BY created ASC';
      const EPIC_FIELDS = fields || '*all';
      const issues = await fetchAllPages(auth, JIRA_CLOUD, jqlStr, EPIC_FIELDS);
      return res.status(200).json({ issues, total: issues.length, isLast: true });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
