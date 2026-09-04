// Control de sesión del lado del cliente.
// Ojo: esto es comodidad de interfaz, no seguridad. El control real está en
// los endpoints, que devuelven 401/403 sin importar lo que haga el navegador.

window.Sesion = (function () {
  let actual = null;

  function irALogin() {
    const destino = encodeURIComponent(location.pathname + location.search);
    location.href = '/login.html?destino=' + destino;
  }

  // Llamar al inicio de cada pestaña, antes de pedir datos a Jira.
  async function iniciar() {
    try {
      const r = await fetch('/api/auth/me');
      if (!r.ok) { irALogin(); return null; }
      actual = await r.json();
      aplicarPermisos();
      return actual;
    } catch (e) {
      irALogin();
      return null;
    }
  }

  function puede(permiso) {
    return !!actual && actual.permisos.includes(permiso);
  }

  // Oculta cualquier elemento marcado con data-permiso="tab.costos".
  function aplicarPermisos() {
    document.querySelectorAll('[data-permiso]').forEach((el) => {
      if (!puede(el.getAttribute('data-permiso'))) el.remove();
    });
  }

  // Envoltorio de fetch: si la sesión caduca a media jornada, lleva al login
  // en lugar de dejar la pantalla con gráficos vacíos.
  async function pedir(url, opciones) {
    const r = await fetch(url, opciones);
    if (r.status === 401) { irALogin(); throw new Error('sesion_expirada'); }
    if (r.status === 403) { throw new Error('sin_permiso'); }
    return r;
  }

  async function salir() {
    await fetch('/api/auth/logout', { method: 'POST' });
    location.href = '/login.html';
  }

  return { iniciar, puede, pedir, salir, get usuario() { return actual; } };
})();
