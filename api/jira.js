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

    } else {
      // Default: fetch Epics
      const { jql, fields } = req.body || {};
      const jqlStr = jql || 'project = PTS AND issuetype = Epic ORDER BY created ASC';
      const EPIC_FIELDS = fields || [
        'summary','status','assignee','reporter','labels','duedate',
        'customfield_10015','customfield_10592','customfield_10659',
        'customfield_10725','customfield_10726','customfield_10759',
        'customfield_10895','customfield_10928','customfield_10929',
        'customfield_10930','customfield_10931','customfield_10934',
        'customfield_10829','customfield_10862','customfield_10969',
        'customfield_10970','customfield_11003','customfield_11004',
        'customfield_11037','customfield_11070'
      ];
      const issues = await fetchAllPages(auth, JIRA_CLOUD, jqlStr, EPIC_FIELDS);
      return res.status(200).json({ issues, total: issues.length, isLast: true });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
