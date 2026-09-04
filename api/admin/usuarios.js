const crypto = require('crypto');
const {
  PERMISOS,
  PERFILES,
  bcrypt,
  resolverPermisos,
  listarUsuarios,
  guardarUsuarios,
  requirePermiso,
  normalizarPerfil,
} = require('../../lib/auth');

function sinHash(u) {
  return {
    u: u.u,
    nombre: u.nombre,
    perfil: u.perfil,
    permisos: u.permisos,
    activo: u.activo !== false,
    temporal: u.temporal === true,
  };
}

function nuevaPassword() {
  return crypto.randomBytes(9).toString('base64url');
}

module.exports = async function handler(req, res) {
  const admin = requirePermiso(req, res, 'admin.usuarios');
  if (!admin) return;

  const { accion, usuario, nombre, perfil, permisos, nuevoUsuario } = req.body || {};

  try {
    const lista = await listarUsuarios();

    if (req.method === 'GET' || accion === 'listar') {
      return res.status(200).json({
        usuarios: lista.map(sinHash),
        catalogo: PERMISOS,
        perfiles: Object.entries(PERFILES).map(([k, v]) => ({
          clave: k,
          nombre: v.nombre,
          porDefecto: v.porDefecto,
          bloqueados: v.bloqueados,
        })),
      });
    }

    const idx = lista.findIndex(
      (x) => String(x.u).toLowerCase() === String(usuario || '').toLowerCase()
    );

    if (accion === 'crear') {
      if (!usuario || !perfil) {
        return res.status(400).json({ error: 'datos_incompletos' });
      }
      if (!PERFILES[perfil]) {
        return res.status(400).json({ error: 'perfil_invalido' });
      }
      if (idx >= 0) {
        return res.status(409).json({ error: 'usuario_existe' });
      }
      const password = nuevaPassword();
      lista.push({
        u: usuario.trim().toLowerCase(),
        nombre: (nombre || usuario).trim(),
        perfil,
        hash: bcrypt.hashSync(password, 10),
        permisos: resolverPermisos(perfil, permisos || null),
        activo: true,
        temporal: true,
      });
      await guardarUsuarios(lista);
      return res.status(200).json({ ok: true, usuario, password });
    }

    if (idx < 0) return res.status(404).json({ error: 'usuario_no_encontrado' });

    if (accion === 'actualizar') {
      const reg = lista[idx];

      // Cambio de identificador, si viene uno distinto.
      if (nuevoUsuario && nuevoUsuario.trim().toLowerCase() !== reg.u) {
        const destino = nuevoUsuario.trim().toLowerCase();
        if (destino.length < 3) {
          return res.status(400).json({ error: 'usuario_corto' });
        }
        const choca = lista.some(
          (x, i) => i !== idx && String(x.u).toLowerCase() === destino
        );
        if (choca) return res.status(409).json({ error: 'usuario_existe' });
        reg.u = destino;
      }

      // Nadie puede quitarse a sí mismo la gestión de usuarios: evita
      // dejar el dashboard sin ningún administrador.
      const esYo = reg.u === admin.sub;
      const nuevoPerfil = perfil && PERFILES[perfil] ? perfil : reg.perfil;
      if (esYo && nuevoPerfil !== 'administrador') {
        return res.status(400).json({ error: 'no_puedes_degradarte' });
      }
      reg.nombre = (nombre || reg.nombre).trim();
      reg.perfil = nuevoPerfil;
      reg.permisos = resolverPermisos(nuevoPerfil, permisos || null);
      await guardarUsuarios(lista);
      // Si el administrador se renombró a sí mismo, su token quedó apuntando
      // al identificador anterior y debe volver a iniciar sesión.
      return res.status(200).json({
        ok: true,
        usuario: sinHash(reg),
        reloguear: esYo && reg.u !== admin.sub,
      });
    }

    if (accion === 'password') {
      const password = nuevaPassword();
      lista[idx].hash = bcrypt.hashSync(password, 10);
      lista[idx].temporal = true;
      await guardarUsuarios(lista);
      return res.status(200).json({ ok: true, usuario, password });
    }

    if (accion === 'activar') {
      if (lista[idx].u === admin.sub) {
        return res.status(400).json({ error: 'no_puedes_desactivarte' });
      }
      lista[idx].activo = lista[idx].activo === false;
      await guardarUsuarios(lista);
      return res.status(200).json({ ok: true, activo: lista[idx].activo });
    }

    if (accion === 'eliminar') {
      if (lista[idx].u === admin.sub) {
        return res.status(400).json({ error: 'no_puedes_eliminarte' });
      }
      const quedan = lista.filter(
        (x, i) => i !== idx && x.perfil === 'administrador' && x.activo !== false
      );
      if (lista[idx].perfil === 'administrador' && quedan.length === 0) {
        return res.status(400).json({ error: 'ultimo_administrador' });
      }
      lista.splice(idx, 1);
      await guardarUsuarios(lista);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'accion_desconocida' });
  } catch (err) {
    console.error('admin/usuarios:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
