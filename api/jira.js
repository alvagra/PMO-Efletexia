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

  try {
    const response = await fetch(`https://${JIRA_CLOUD}.atlassian.net/rest/api/3/search`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({ jql, fields, maxResults, startAt }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: JSON.stringify(data) });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

Clic en "Commit changes" → "Commit changes" (verde)


Dime cuando termines ese paso y te guío con el vercel.json. 
