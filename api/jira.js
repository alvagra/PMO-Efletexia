const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const JIRA_EMAIL = process.env.JIRA_EMAIL;
  const JIRA_TOKEN = process.env.JIRA_TOKEN;
  const JIRA_CLOUD = process.env.JIRA_CLOUD || 'efletexia';

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(500).json({ error: 'Credenciales no configuradas.' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const { jql, fields, maxResults = 100, startAt = 0 } = req.body;
  const body = JSON.stringify({ jql, fields, maxResults, startAt });

  const options = {
    hostname: `${JIRA_CLOUD}.atlassian.net`,
    path: '/rest/api/3/search/jql',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Content-Length': Buffer.byteLength(body),
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
          res.status(500).json({ error: 'Error al parsear respuesta de Jira' });
        }
        resolve();
      });
    });
    request.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });
    request.write(body);
    request.end();
  });
};
"Commit changes" → espera redespliegue → Ctrl+Shift+R. 👆Claude Fable 5 is currently unavailable.
