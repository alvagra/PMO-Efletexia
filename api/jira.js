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
        catch(e) { reject(new Error('Parse error: ' + data.slice(0,200))); }
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
    let allIssues = [];
    let nextPageToken = null;

    // Paginate using nextPageToken
    do {
      const params = new URLSearchParams({
        jql: jqlStr,
        fields: fieldsStr,
        maxResults: 100,
      });
      if (nextPageToken) params.set('nextPageToken', nextPageToken);

      const result = await jiraGet(auth, JIRA_CLOUD, `/rest/api/3/search/jql?${params.toString()}`);

      if (result.status !== 200) {
        return res.status(result.status).json(result.body);
      }

      const page = result.body;
      allIssues = allIssues.concat(page.issues || []);
      nextPageToken = page.isLast ? null : page.nextPageToken;

      // Safety limit
      if (allIssues.length >= 500) break;

    } while (nextPageToken);

    return res.status(200).json({
      issues: allIssues,
      total: allIssues.length,
      isLast: true,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
