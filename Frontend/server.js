'use strict';

/*
 * Frontend "Hello World" instrumentado.
 * - Sirve una página con botones para saludar y para generar carga de CPU.
 * - Hace de proxy hacia el backend (evita problemas de CORS en el navegador).
 * - Expone métricas Prometheus en /metrics y emite logs JSON a stdout -> Alloy -> Loki.
 */

const express = require('express');
const client = require('prom-client');

const PORT = process.env.PORT || 8080;
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const SERVICE = 'frontend';

function log(level, msg, fields = {}) {
  process.stdout.write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      service: SERVICE,
      msg,
      ...fields,
    }) + '\n'
  );
}

// Métricas
const register = client.register;
client.collectDefaultMetrics({ prefix: 'frontend_' });
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de peticiones HTTP al frontend',
  labelNames: ['method', 'route', 'status'],
});

const app = express();

app.use((req, res, next) => {
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    log('INFO', 'http_request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
    });
  });
  next();
});

const PAGE = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Lab Observabilidad · Hello World</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 20px; }
    h1 { font-size: 1.6rem; }
    button { font-size: 1rem; padding: 10px 16px; margin: 6px 6px 6px 0; cursor: pointer; }
    pre { background: #f4f4f5; padding: 12px; border-radius: 8px; overflow:auto; }
    .hint { color:#666; font-size:.9rem; }
  </style>
</head>
<body>
  <h1>Hello World · Laboratorio de Observabilidad</h1>
  <p class="hint">Cada acción genera métricas (Prometheus) y logs (Loki) que verás en Grafana.</p>
  <button onclick="hello()">Saludar (API)</button>
  <button onclick="load()">Generar carga de CPU (30s)</button>
  <pre id="out">Listo.</pre>
  <script>
    async function hello() {
      const r = await fetch('/api/hello?name=clase');
      document.getElementById('out').textContent = JSON.stringify(await r.json(), null, 2);
    }
    async function load() {
      const r = await fetch('/api/load?seconds=30');
      document.getElementById('out').textContent =
        JSON.stringify(await r.json(), null, 2) +
        '\\n\\nObserva el panel de CPU en Grafana: debería superar el 50%.';
    }
  </script>
</body>
</html>`;

app.get('/', (req, res) => res.type('html').send(PAGE));

// Proxy hacia el backend
app.get('/api/hello', async (req, res) => {
  try {
    const r = await fetch(`${BACKEND_URL}/api/hello?name=${encodeURIComponent(req.query.name || 'mundo')}`);
    res.status(r.status).json(await r.json());
  } catch (e) {
    log('ERROR', 'backend_no_disponible', { detail: String(e) });
    res.status(502).json({ error: 'backend no disponible' });
  }
});

app.get('/api/load', async (req, res) => {
  try {
    const r = await fetch(`${BACKEND_URL}/load?seconds=${parseInt(req.query.seconds, 10) || 30}`);
    log('WARN', 'carga_cpu_solicitada_desde_frontend', {});
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(502).json({ error: 'backend no disponible' });
  }
});

app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => log('INFO', 'frontend_iniciado', { port: PORT, backend: BACKEND_URL }));

// Logs maquetados de frontend de "TiendaUPAO" (navegación de la tienda)
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function pick(arr) { return arr[rand(0, arr.length - 1)]; }
const events = [
  () => log('INFO', 'vista_producto', { tienda: 'tienda-upao', sku: pick(['SKU-CAFE-500', 'SKU-LAPTOP-14', 'SKU-AUDIF-BT']), sesion: rand(1, 999) }),
  () => log('INFO', 'busqueda_realizada', { tienda: 'tienda-upao', termino: pick(['cafe', 'laptop', 'audifonos', 'mouse']), resultados: rand(0, 48) }),
  () => log('INFO', 'agregar_al_carrito', { tienda: 'tienda-upao', sku: pick(['SKU-MOUSE-ERG', 'SKU-TECLADO-MEC']), sesion: rand(1, 999) }),
  () => log('WARN', 'imagen_lenta', { tienda: 'tienda-upao', asset: 'banner-home.webp', load_ms: rand(900, 3200) }),
  () => log('ERROR', 'error_render_catalogo', { tienda: 'tienda-upao', message: 'TypeError: precio.toFixed is not a function' }),
];
setInterval(() => events[rand(0, events.length - 1)](), 5000);
