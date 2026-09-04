const {
  bcrypt,
  buscarUsuario,
  firmarToken,
  cookieSesion,
} = require('../../lib/auth');

// Límite de intentos en memoria. Se reinicia cuando Vercel recicla la instancia,
// así que frena la fuerza bruta sostenida pero no es un control estricto.
const intentos = new Map();
const MAX_INTENTOS = 5;
const VENTANA_MS = 15 * 60 * 1000;

function bloqueado(ip) {
  const reg = intentos.get(ip);
  if (!reg) return false;
  if (Date.now() - reg.desde > VENTANA_MS) {
    intentos.delete(ip);
    return false;
  }
  return reg.n >= MAX_INTENTOS;
}

function fallo(ip) {
  const reg = intentos.get(ip);
  if (!reg || Date.now() - reg.desde > VENTANA_MS) {
    intentos.set(ip, { n: 1, desde: Date.now() });
  } else {
    reg.n += 1;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'metodo_no_permitido' });
  }
  if (!process.env.AUTH_SECRET) {
    console.error('Falta la variable AUTH_SECRET');
    return res.status(500).json({ error: 'config_incompleta' });
  }

  const ip = req.headers['x-forwarded-for'] || 'desconocida';
  if (bloqueado(ip)) {
    return res.status(429).json({
      error: 'demasiados_intentos',
      mensaje: 'Demasiados intentos. Espera 15 minutos.',
    });
  }

  const { usuario, password } = req.body || {};
  if (!usuario || !password) {
    return res.status(400).json({ error: 'datos_incompletos' });
  }

  const registro = await buscarUsuario(usuario);

  // Se compara siempre contra un hash, exista o no el usuario, para que el
  // tiempo de respuesta no revele qué cuentas están dadas de alta.
  const hash =
    (registro && registro.hash) ||
    '$2a$10$0000000000000000000000000000000000000000000000000000';
  const ok = await bcrypt.compare(password, hash);

  if (!registro || !ok || registro.activo === false) {
    fallo(ip);
    return res.status(401).json({
      error: 'credenciales_invalidas',
      mensaje: 'Usuario o contraseña incorrectos.',
    });
  }

  intentos.delete(ip);
  const token = firmarToken(registro);
  res.setHeader('Set-Cookie', cookieSesion(token));
  return res.status(200).json({
    usuario: registro.u,
    nombre: registro.nombre || registro.u,
    perfil: registro.perfil,
    cambiarPassword: registro.temporal === true,
  });
};
