// api/jira.js — Vercel Serverless Function
// Proxy seguro: el token de Jira nunca llega al navegador

export default async function handler(req, res) {
  // CORS: permite llamadas desde cualquier origen (tu dominio de Vercel)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const JIRA_EMAIL   = process.env.JIRA_EMAIL;
  const JIRA_TOKEN   = process.env.JIRA_TOKEN;
  const JIRA_CLOUD   = process.env.JIRA_CLOUD || 'efletexia';
  const CLOUD_ID     = process.env.CLOUD_ID   || '4678cb2a-b7e6-46c1-a0e9-cd018417c539';

  if (!JIRA_EMAIL || !JIRA_TOKEN) {
    return res.status(500).json({ error: 'Credenciales de Jira no configuradas en variables de entorno.' });
  }

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
  const { jql, fields, maxResults = 100, startAt = 0 } = req.body;

  try {
    const url = `https://${JIRA_CLOUD}.atlassian.net/rest/api/3/search`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type':  'application/json',
        'Accept':        'application/json',
      },
      body: JSON.stringify({ jql, fields, maxResults, startAt }),
    });

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: text });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
