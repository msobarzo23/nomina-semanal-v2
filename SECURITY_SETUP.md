# 🔐 Configuración de seguridad — Token compartido

Hoy la URL de tu Apps Script es pública (está en `src/config.js`, en GitHub público). Cualquiera con esa URL puede listar/leer/sobrescribir tus nóminas.

Esta guía agrega un **token compartido** entre el cliente y el Apps Script. El cliente lo envía con cada petición y el script verifica que coincida. Sin el token, el script devuelve error.

---

## Paso 1 · Genera un token aleatorio

Abre una terminal o cualquier sitio que genere strings aleatorios y crea una cadena de 32+ caracteres. Ejemplo en bash:

```bash
openssl rand -hex 32
```

O simplemente combina letras/números a mano (algo tipo: `f4kQ8vN3pXr7tY2hL9mZ5wB1jD6sR0aP`). **Guárdalo bien — lo vas a usar en 3 lugares.**

---

## Paso 2 · Edita el Apps Script

1. Abre el script en [script.google.com](https://script.google.com).
2. Abre el archivo `.gs` principal.
3. Pega el contenido del archivo **`apps-script-token-snippet.gs`** AL INICIO del archivo (antes de las funciones `doGet`/`doPost` existentes).
4. **Cambia** la línea:

   ```js
   const VALID_TOKEN = "PEGA_AQUI_TU_TOKEN_SECRETO";
   ```

   Por tu token real:

   ```js
   const VALID_TOKEN = "f4kQ8vN3pXr7tY2hL9mZ5wB1jD6sR0aP";
   ```

5. Dentro de tu función `doGet(e)`, agrega como **primera línea**:

   ```js
   if(!_isAuthorized(e)) return _unauthorized();
   ```

6. Dentro de tu función `doPost(e)`, igual:

   ```js
   if(!_isAuthorized(e)) return _unauthorized();
   ```

7. Guarda (Ctrl+S).
8. **Crea un nuevo despliegue**: `Deploy > Manage deployments > [tu deploy] > Edit (lápiz) > Version: New version > Deploy`. **Importante**: copia la URL nueva si cambia (suele ser la misma).

---

## Paso 3 · Configura el token en Vercel

1. Ve a tu proyecto en [vercel.com](https://vercel.com).
2. **Settings → Environment Variables**.
3. Agrega una nueva variable:
   - **Name**: `VITE_APPS_SCRIPT_TOKEN`
   - **Value**: el mismo token (ej: `f4kQ8vN3pXr7tY2hL9mZ5wB1jD6sR0aP`)
   - **Environments**: marca los 3 (Production, Preview, Development).
4. **Guarda**.
5. **Redeploy**: ve a Deployments → tu último deploy → menú `…` → Redeploy. (O hacer un push a `main` que dispare otro deploy.)

---

## Paso 4 · (Opcional) Configura el token en local

Si vas a probar la app en local con `npm run dev`, crea un archivo `.env.local` en la raíz del repo:

```
VITE_APPS_SCRIPT_TOKEN=f4kQ8vN3pXr7tY2hL9mZ5wB1jD6sR0aP
```

Este archivo está en `.gitignore` y NO se sube al repo.

---

## Paso 5 · Verifica

1. Abre la app en producción (Vercel).
2. Ve a la pestaña Anteriores. Debe cargar las nóminas guardadas como antes.
3. Abre una nómina y guárdala. Debe funcionar.
4. **Prueba sin token** (verifica la seguridad): abre la URL del Apps Script directo en el navegador con `?action=list` (sin `&token=...`). Debe responder `{"ok":false,"error":"Token invalido o ausente"}`.

Si los pasos 1-3 funcionan y el paso 4 da error, **listo, está protegido**.

---

## Notas

- El token NO es secreto perfecto: cualquiera que inspeccione el código del navegador en producción puede verlo. Pero ya no basta con la URL del Apps Script — alguien tiene que llegar a tu app deployada en Vercel y mirar el bundle. Esto sube significativamente la barrera.
- Para seguridad real (que ni siquiera el cliente vea el token), habría que usar un proxy en Vercel (función serverless) que reciba las peticiones y agregue el token antes de reenviar al Apps Script. Si quieres ese nivel, me dices.
- Si pierdes el token, generas otro y repites pasos 2-3-4. La app dejará de funcionar hasta que ambos lados tengan el mismo token nuevo.
