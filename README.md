# Deuda Cero

Una app web en español para organizar deudas, comparar dos estrategias de pago y registrar avances. La interfaz funciona sin servicios externos; los cambios se guardan en el almacenamiento local del navegador.

## Iniciar en el entorno de desarrollo

Desde `/workspace/debtfree`, ejecuta:

```sh
python3 -m http.server 4173 --bind 0.0.0.0
```

La app se sirve en el puerto `4173`. Para una comprobación local desde el mismo entorno:

```sh
curl -fsS http://127.0.0.1:4173/ | head
```

El proyecto usa HTML, CSS, JavaScript y Python estándar; no necesita instalar paquetes. La pantalla inicial muestra cuentas de ejemplo, que puedes editar o quitar con “Empezar de cero” antes de ingresar tus propios saldos.

## Publicar en Vercel

El archivo `vercel.json` configura la publicación estática sin compilación. `.vercelignore` excluye los archivos internos y las pruebas del despliegue.

Desde la carpeta del proyecto, con una cuenta de Vercel autenticada:

```sh
npx --yes vercel@65.12.1 login
npx --yes vercel@65.12.1 deploy --prod --yes
```

En el entorno cloud, la red debe permitir `api.vercel.com`, `vercel.com` y `*.vercel.app`. Si se usa `VERCEL_TOKEN`, configúralo en los ajustes seguros del entorno y pásalo al CLI con `--token "$VERCEL_TOKEN"`. No guardes el token en el repositorio.

## Validación

```sh
node --check app.js
node --test tests/simulator.test.cjs
python3 tests/browser_smoke.py
```

La prueba de navegador requiere Playwright y Chromium instalados en el entorno. Comprueba edición, alta, pagos, persistencia, exportación CSV, planes que no liquidan la deuda y las cuatro vistas móviles. La app guarda datos por navegador; no incluye servidor de cuentas ni sincronización entre dispositivos.
