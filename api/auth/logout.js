const { cookieBorrada } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  res.setHeader('Set-Cookie', cookieBorrada());
  return res.status(200).json({ ok: true });
};
