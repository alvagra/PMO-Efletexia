const https = require('https');

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
  const { jql, fields, maxResults = 100, startAt = 0 } = req.body || {};

  // Build query string for GET request
  const fieldsStr = Array.isArray(fields) ? fields.join(',') : (fields || '');
  const params = new URLSearchParams({
    jql: jql || 'project = PTS AND issuetype = Epic ORDER BY created ASC',
    fields: fieldsStr,
    maxResults: maxResults,
    startAt: startAt,
  });

  const options = {
    hostname: `${JIRA_CLOUD}.atlassian.net`,
    path: `/rest/api/3/search/jql?${params.toString()}`,
    method: 'GET',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Accept': 'application/json',
    },
  };

  return new Promise((resolve) => {
    const request = https.request(options, (response) => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try {
          const json = JSON.parse(data);
          res.status(response.statusCode).json(json);
        } catch (e) {
          res.status(500).json({ error: 'Parse error: ' + data.slice(0, 300) });
        }
        resolve();
      });
    });
    request.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });
    request.end();
  });
};
