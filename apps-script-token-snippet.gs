/**
 * SNIPPET PARA AGREGAR VALIDACION DE TOKEN AL APPS SCRIPT
 *
 * Pegar este bloque AL INICIO del archivo .gs en script.google.com
 * y luego envolver el inicio de doGet/doPost con el chequeo (ver abajo).
 *
 * El TOKEN debe coincidir EXACTAMENTE con el que pongas en Vercel
 * (variable VITE_APPS_SCRIPT_TOKEN) y en tu .env.local.
 */

// ⚠️ Cambia este valor por una cadena aleatoria larga (32+ caracteres).
// Ejemplo: "f4kQ8vN3pXr7tY2hL9mZ5wB1jD6sR0aP" (NO uses este, genera el tuyo).
const VALID_TOKEN = "PEGA_AQUI_TU_TOKEN_SECRETO";

/**
 * Devuelve true si el token recibido (en query o en body) coincide.
 */
function _isAuthorized(e) {
  if(!VALID_TOKEN || VALID_TOKEN === "PEGA_AQUI_TU_TOKEN_SECRETO") return true; // sin token configurado: permite todo (modo legacy)
  var fromQuery = (e && e.parameter && e.parameter.token) || '';
  var fromBody = '';
  try {
    if(e && e.postData && e.postData.contents) {
      var body = JSON.parse(e.postData.contents);
      fromBody = body.token || '';
    }
  } catch(err) {}
  return (fromQuery && fromQuery === VALID_TOKEN) || (fromBody && fromBody === VALID_TOKEN);
}

function _unauthorized() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: false, error: "Token invalido o ausente" }))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * EN doGet(e), agrega esto como PRIMERA linea dentro de la funcion:
 *
 *   if(!_isAuthorized(e)) return _unauthorized();
 *
 * En doPost(e), igual:
 *
 *   if(!_isAuthorized(e)) return _unauthorized();
 *
 * Despues de pegar y modificar, guarda el script y crea un NUEVO despliegue
 * (Deploy > Manage deployments > Edit > New version).
 */
