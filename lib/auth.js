const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const HORAS_SESION = 8;

// Catálogo de permisos. Toda clave nueva se agrega aquí primero.
const PERMISOS = [
  'tab.portafolio',
  'tab.entregables',
  'tab.detalle',
  'tab.bugs',
  'tab.recursos',
  'tab.capacity',
  'tab.costos',
  'dato.margen',
  'admin.usuarios',
];

// Plantillas por perfil: lo que se aplica al crear el usuario.
const PERFILES = {
  administrador: {
    nombre: 'Administrador',
    porDefecto: PERMISOS.slice(),
    bloqueados: [],
  },
  directivo: {
    nombre: 'Directivo',
    porDefecto: [
      'tab.portafolio',
      'tab.entregables',
      'tab.recursos',
      'tab.capacity',
      'tab.costos',
      'dato.margen',
    ],
    bloqueados: ['admin.usuarios'],
  },
  pmo: {
    nombre: 'PMO',
    porDefecto: [
      'tab.portafolio',
      'tab.entregables',
      'tab.detalle',
      'tab.bugs',
      'tab.recursos',
      'tab.capacity',
      'tab.costos',
    ],
    bloqueados: ['admin.usuarios'],
  },
  desarrollo: {
    nombre: 'Desarrollo',
    porDefecto: ['tab.portafolio', 'tab.entregables', 'tab.detalle', 'tab.bugs'],
    bloqueados: ['dato.margen', 'admin.usuarios'],
  },
};

// Resuelve la lista efectiva de permisos: plantilla + añadidos - quitados,
// descartando siempre lo que el perfil tiene bloqueado.
function resolverPermisos(perfil, añadidos = [], quitados = []) {
  const def = PERFILES[perfil];
  if (!def) return [];
  const set = new Set(def.porDefecto);
  añadidos.forEach((p) => PERMISOS.includes(p) && set.add(p));
  quitados.forEach((p) => set.delete(p));
  def.bloqueados.forEach((p) => set.delete(p));
  return PERMISOS.filter((p) => set.has(p));
}

// ---------------------------------------------------------------------------
// Origen de usuarios. En la fase 1 vive en la variable de entorno AUTH_USERS.
// Para migrar a Vercel KV en la fase 2 se reemplaza SOLO esta función.
// ---------------------------------------------------------------------------
async function buscarUsuario(usuario) {
  let lista = [];
  try {
    lista = JSON.parse(process.env.AUTH_USERS || '[]');
  } catch (e) {
    console.error('AUTH_USERS no es un JSON válido');
    return null;
  }
  const u = lista.find(
    (x) => String(x.u).toLowerCase() === String(usuario).toLowerCase()
  );
  return u || null;
}

function firmarToken(usuario) {
  const permisos = resolverPermisos(
    usuario.perfil,
    usuario.añade || usuario.anade || [],
    usuario.quita || []
  );
  return jwt.sign(
    {
      sub: usuario.u,
      nombre: usuario.nombre || usuario.u,
      perfil: usuario.perfil,
      permisos,
    },
    process.env.AUTH_SECRET,
    { expiresIn: `${HORAS_SESION}h` }
  );
}

function cookieSesion(token) {
  const maxAge = HORAS_SESION * 3600;
  return `pmo_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

function cookieBorrada() {
  return 'pmo_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  const par = cabecera
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(nombre + '='));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

// Guardián de sesión. Devuelve el payload del token o null (y ya respondió 401).
function requireAuth(req, res) {
  const token = leerCookie(req.headers.cookie, 'pmo_token');
  if (!token) {
    res.status(401).json({ error: 'no_auth' });
    return null;
  }
  try {
    return jwt.verify(token, process.env.AUTH_SECRET);
  } catch (e) {
    res.status(401).json({ error: 'sesion_expirada' });
    return null;
  }
}

// Guardián de permiso. Úsalo cuando el endpoint sirve una funcionalidad concreta.
function requirePermiso(req, res, permiso) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!user.permisos.includes(permiso)) {
    res.status(403).json({ error: 'sin_permiso' });
    return null;
  }
  return user;
}

module.exports = {
  PERMISOS,
  PERFILES,
  HORAS_SESION,
  bcrypt,
  resolverPermisos,
  buscarUsuario,
  firmarToken,
  cookieSesion,
  cookieBorrada,
  requireAuth,
  requirePermiso,
};
