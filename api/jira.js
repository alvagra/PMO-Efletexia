const https = require('https');

function jiraGet(auth, cloud, path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${cloud}.atlassian.net`,
      path,
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { reject(new Error('Parse error: ' + data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.end();
  });
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
  const { jql, fields } = req.body || {};
  const fieldsStr = Array.isArray(fields) ? fields.join(',') : (fields || '');
  const jqlStr = jql || 'project = PTS AND issuetype = Epic ORDER BY created ASC';

  try {
    // Page 1: startAt=0, maxResults=100
    const p1 = new URLSearchParams({ jql: jqlStr, fields: fieldsStr, maxResults: 100, startAt: 0 });
    const r1 = await jiraGet(auth, JIRA_CLOUD, `/rest/api/3/search/jql?${p1.toString()}`);
    if (r1.status !== 200) return res.status(r1.status).json(r1.body);

    let allIssues = r1.body.issues || [];

    // Page 2: only if first page returned exactly 100 items
    if (allIssues.length === 100) {
      const p2 = new URLSearchParams({ jql: jqlStr, fields: fieldsStr, maxResults: 100, startAt: 100 });
      const r2 = await jiraGet(auth, JIRA_CLOUD, `/rest/api/3/search/jql?${p2.toString()}`);
      if (r2.status === 200 && r2.body.issues) {
        allIssues = allIssues.concat(r2.body.issues);
      }
    }

    // Deduplicate by id
    const seen = new Set();
    allIssues = allIssues.filter(i => {
      if (seen.has(i.id)) return false;
      seen.add(i.id);
      return true;
    });

    return res.status(200).json({
      issues: allIssues,
      total: allIssues.length,
      isLast: true,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
