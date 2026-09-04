const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { kv } = require('@vercel/kv');

const HORAS_SESION = 8;
const CLAVE_KV = 'pmo:usuarios';

// Catálogo de permisos. Toda clave nueva se agrega aquí primero.
const PERMISOS = [
  { clave: 'tab.portafolio', etiqueta: 'Portafolio' },
  { clave: 'tab.entregables', etiqueta: 'Entregables' },
  { clave: 'tab.detalle', etiqueta: 'Detalle' },
  { clave: 'tab.bugs', etiqueta: 'Bugs' },
  { clave: 'tab.recursos', etiqueta: 'Recursos' },
  { clave: 'tab.capacity', etiqueta: 'Capacity' },
  { clave: 'tab.costos', etiqueta: 'Costos' },
  { clave: 'dato.margen', etiqueta: 'Ver margen y tarifas' },
  { clave: 'admin.usuarios', etiqueta: 'Gestionar usuarios' },
];

const CLAVES = PERMISOS.map((p) => p.clave);

// Plantillas por perfil.
const PERFILES = {
  administrador: {
    nombre: 'Administrador',
    porDefecto: CLAVES.slice(),
    bloqueados: [],
  },
  lider: {
    nombre: 'Líder',
    porDefecto: [
      'tab.portafolio', 'tab.entregables', 'tab.detalle', 'tab.bugs',
      'tab.recursos', 'tab.capacity', 'tab.costos', 'dato.margen',
    ],
    bloqueados: ['admin.usuarios'],
  },
  analista: {
    nombre: 'Analista',
    porDefecto: ['tab.portafolio', 'tab.entregables', 'tab.detalle', 'tab.bugs'],
    bloqueados: ['dato.margen', 'admin.usuarios'],
  },
};

// Perfiles anteriores, para convertir las cuentas ya guardadas.
const PERFILES_LEGADO = {
  directivo: 'lider',
  pmo: 'lider',
  desarrollo: 'analista',
};

function normalizarPerfil(perfil) {
  if (PERFILES[perfil]) return perfil;
  return PERFILES_LEGADO[perfil] || 'analista';
}

// Lista efectiva: plantilla + añadidos - quitados, descartando lo bloqueado.
function resolverPermisos(perfilCrudo, permisos) {
  const perfil = normalizarPerfil(perfilCrudo);
  const def = PERFILES[perfil];
  if (!def) return [];
  const base = Array.isArray(permisos) ? permisos : def.porDefecto;
  const set = new Set(base.filter((p) => CLAVES.includes(p)));
  def.bloqueados.forEach((p) => set.delete(p));
  return CLAVES.filter((p) => set.has(p));
}

// ---------------------------------------------------------------------------
// Almacén de usuarios en Vercel KV, bajo una sola clave.
// La primera lectura siembra el almacén desde AUTH_USERS si aún está vacío,
// para no perder las cuentas cargadas en la fase 1.
// ---------------------------------------------------------------------------
async function listarUsuarios() {
  let lista = await kv.get(CLAVE_KV);
  if (!lista) {
    try {
      const semilla = JSON.parse(process.env.AUTH_USERS || '[]');
      lista = semilla.map((u) => ({
        u: u.u,
        nombre: u.nombre || u.u,
        perfil: normalizarPerfil(u.perfil),
        hash: u.hash,
        permisos: resolverPermisos(u.perfil, null),
        activo: true,
        temporal: u.temporal === true,
      }));
      if (lista.length) await kv.set(CLAVE_KV, lista);
    } catch (e) {
      console.error('No se pudo sembrar desde AUTH_USERS:', e.message);
      lista = [];
    }
  }
  let cambio = false;
  lista.forEach((u) => {
    const n = normalizarPerfil(u.perfil);
    if (n !== u.perfil) { u.perfil = n; u.permisos = resolverPermisos(n, u.permisos); cambio = true; }
  });
  if (cambio) await kv.set(CLAVE_KV, lista);
  return lista;
}

async function guardarUsuarios(lista) {
  await kv.set(CLAVE_KV, lista);
}

async function buscarUsuario(usuario) {
  const lista = await listarUsuarios();
  return (
    lista.find((x) => String(x.u).toLowerCase() === String(usuario).toLowerCase()) ||
    null
  );
}

function firmarToken(usuario) {
  return jwt.sign(
    {
      sub: usuario.u,
      nombre: usuario.nombre || usuario.u,
      perfil: normalizarPerfil(usuario.perfil),
      permisos: resolverPermisos(usuario.perfil, usuario.permisos),
    },
    process.env.AUTH_SECRET,
    { expiresIn: `${HORAS_SESION}h` }
  );
}

function cookieSesion(token) {
  return `pmo_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${HORAS_SESION * 3600}`;
}

function cookieBorrada() {
  return 'pmo_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0';
}

function leerCookie(cabecera, nombre) {
  if (!cabecera) return null;
  const par = cabecera.split(';').map((c) => c.trim())
    .find((c) => c.startsWith(nombre + '='));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : null;
}

function requireAuth(req, res) {
  const token = leerCookie(req.headers.cookie, 'pmo_token');
  if (!token) { res.status(401).json({ error: 'no_auth' }); return null; }
  try {
    return jwt.verify(token, process.env.AUTH_SECRET);
  } catch (e) {
    res.status(401).json({ error: 'sesion_expirada' });
    return null;
  }
}

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
  CLAVES,
  PERFILES,
  normalizarPerfil,
  HORAS_SESION,
  bcrypt,
  resolverPermisos,
  listarUsuarios,
  guardarUsuarios,
  buscarUsuario,
  firmarToken,
  cookieSesion,
  cookieBorrada,
  requireAuth,
  requirePermiso,
};
