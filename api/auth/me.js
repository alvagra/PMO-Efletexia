const { requireAuth } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  const user = requireAuth(req, res);
  if (!user) return;

  return res.status(200).json({
    usuario: user.sub,
    nombre: user.nombre,
    perfil: user.perfil,
    permisos: user.permisos,
    expira: user.exp,
  });
};
