const https = require('https');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const JIRA_EMAIL = process.env.JIRA_EMAIL;
  const JIRA_TOKEN = process.env.JIRA_TOKEN;
  const JIRA_CLOUD = process.env.JIRA_CLOUD || 'efletexia';

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(500).json({ error: 'Credenciales no configuradas.' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  
  // Get params from body or query
  const jql        = (req.body && req.body.jql)        || req.query.jql        || 'project = PTS AND issuetype = Epic ORDER BY created ASC';
  const fields      = (req.body && req.body.fields)     || ['summary','status','assignee','reporter','labels','duedate','customfield_10015','customfield_10592','customfield_10659','customfield_10725','customfield_10726','customfield_10759','customfield_10895','customfield_10928','customfield_10929','customfield_10930','customfield_10931','customfield_10934','customfield_10829','customfield_10862','customfield_10969','customfield_10970','customfield_11003','customfield_11004','customfield_11037','customfield_11070'];
  const maxResults  = (req.body && req.body.maxResults) || 100;
  const startAt     = (req.body && req.body.startAt)    || 0;

  const bodyData = JSON.stringify({ jql, fields, maxResults, startAt });

  const options = {
    hostname: `${JIRA_CLOUD}.atlassian.net`,
    path: '/rest/api/3/search/jql',
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'Content-Length': Buffer.byteLength(bodyData),
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
          res.status(500).json({ error: 'Parse error: ' + data.slice(0, 200) });
        }
        resolve();
      });
    });
    request.on('error', (e) => {
      res.status(500).json({ error: e.message });
      resolve();
    });
    request.write(bodyData);
    request.end();
  });
};
