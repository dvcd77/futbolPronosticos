# Tokens compartidos — Configuración en Render

Esta guía explica cómo configurar tus 3 tokens **una sola vez** en el servidor,
para que funcionen en **todos los dispositivos** (PC, celular) y para **todos los
usuarios** de confianza, sin tener que ingresarlos en cada navegador.

## Por qué en el servidor y no en el navegador

Antes, cada token se guardaba en el `localStorage` del navegador. Eso tiene dos
problemas: (1) es por dispositivo — el PC y el celular no comparten datos; (2) se
borra al limpiar el caché. Poniéndolos como variables de entorno en el servidor,
los tokens viven en un solo lugar, se comparten automáticamente, y nunca quedan
expuestos en el navegador de los usuarios.

## Paso a paso en Render

1. Entra a tu servicio en [dashboard.render.com](https://dashboard.render.com)
2. Ve a la pestaña **Environment**
3. Agrega estas variables (solo las que tengas):

   | Variable | Valor | Para qué |
   |----------|-------|----------|
   | `FOOTBALL_DATA_KEY` | tu token de football-data.org | Fuente primaria |
   | `API_FOOTBALL_KEY`  | tu token de API-Football (api-sports.io) | AFCON, Copa América, xG real |
   | `ODDS_API_KEY`      | tu token de The Odds API | Cuotas de mercado |

4. Guarda. Render **reinicia el servicio automáticamente** (~1 min) y los tokens
   quedan activos.

## Cómo cambiar un token después

Solo edita el valor de la variable correspondiente en **Environment** y guarda.
Render reinicia solo. **No hay que tocar código ni volver a desplegar a mano.**

## Comportamiento híbrido

El diseño es flexible:

- **Si el servidor tiene el token** → todos lo usan automáticamente, sin ingresar nada.
- **Si además un usuario ingresa su propio token** en Configuración (en su navegador)
  → ese token personal tiene prioridad para ese usuario (útil si alguien quiere usar
  su propia cuenta/cuota). El resto sigue usando el del servidor.
- **Si no hay ninguno** → la app pide configurar el token, como antes.

## Verificación

Tras configurarlo, abre la app → ⚙️ Configuración → panel "📊 Fuentes de datos
activas". Las fuentes provistas por el servidor mostrarán la etiqueta **🌐 servidor**.

## Seguridad

- Los tokens **nunca** se envían al navegador. El endpoint `/api/server-config` solo
  informa si cada token está presente (true/false), nunca su valor.
- ESPN no necesita token (es una API pública sin autenticación).
- Recuerda: si un token quedó visible en algún historial o captura, regéneralo desde
  el panel del proveedor correspondiente.
