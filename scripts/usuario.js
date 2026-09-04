// Genera la entrada JSON de un usuario para la variable AUTH_USERS.
//
//   node scripts/usuario.js jcarrillo desarrollo "Javier Carrillo"
//
// La contraseña se genera al azar y se muestra UNA sola vez: cópiala y
// entrégasela al usuario por un canal privado.

const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const [usuario, perfil, nombre] = process.argv.slice(2);
const perfiles = ['administrador', 'directivo', 'pmo', 'desarrollo'];

if (!usuario || !perfil) {
  console.log('Uso: node scripts/usuario.js <usuario> <perfil> ["Nombre completo"]');
  console.log('Perfiles: ' + perfiles.join(', '));
  process.exit(1);
}
if (!perfiles.includes(perfil)) {
  console.log('Perfil no válido. Usa uno de: ' + perfiles.join(', '));
  process.exit(1);
}

const password = crypto.randomBytes(9).toString('base64url');
const hash = bcrypt.hashSync(password, 10);

console.log('\nContraseña temporal: ' + password);
console.log('(no se guarda en ningún lado — cópiala ahora)\n');
console.log('Agrega este objeto al arreglo de AUTH_USERS:\n');
console.log(
  JSON.stringify({
    u: usuario,
    nombre: nombre || usuario,
    perfil,
    hash,
    temporal: true,
  })
);
console.log('');
