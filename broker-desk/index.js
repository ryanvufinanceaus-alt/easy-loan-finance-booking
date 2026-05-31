/**
 * Broker Desk — drop-in module for an existing Express app (e.g. your booking app)
 * ------------------------------------------------------------------------------
 * Lets ONE Render service serve BOTH apps, routed by hostname:
 *    portal.easyloanfinance.com.au   -> Broker Desk (this module)
 *    booking.easyloanfinance.com.au  -> your existing booking app (untouched)
 *
 * HOW TO USE (in your booking app's server entry, e.g. server.js / index.js / app.js):
 *
 *    const express = require('express');
 *    const app = express();
 *
 *    // >>> add this ONE line as early as possible, BEFORE your booking routes <<<
 *    app.use(require('./broker-desk'));
 *
 *    // ... your existing booking middleware + routes stay exactly as they are ...
 *
 * Then on Render (the booking service) set env vars:
 *    APPS_SCRIPT_URL = https://script.google.com/macros/s/AKfy..../exec
 *    DESK_HOST       = portal.easyloanfinance.com.au   (optional; defaults below)
 *
 * And add the custom domain portal.easyloanfinance.com.au to that same service.
 *
 * For any request whose hostname is NOT the desk host, this module immediately
 * calls next() and does nothing — your booking app behaves exactly as before.
 */

const express = require('express');
const path = require('path');

const router = express.Router();

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL || '';
// Match the desk by configured hosts, always including the new portal host and old app host.
const DESK_HOSTS = new Set([
  'portal.easyloanfinance.com.au',
  'app.easyloanfinance.com.au',
  ...(process.env.DESK_HOSTS || '').split(','),
  process.env.DESK_HOST || ''
].map((host) => host.trim().toLowerCase()).filter(Boolean));
const LOCAL_DESK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function isDeskHost(req) {
  // On Render (behind a proxy) the original host may arrive as X-Forwarded-Host.
  // Check every available source and strip any :port.
  const sources = [req.hostname, req.headers['x-forwarded-host'], req.headers.host];
  return sources
    .filter(Boolean)
    .map((s) => String(s).toLowerCase().split(',')[0].trim().split(':')[0])
    .some((h) => DESK_HOSTS.has(h) || (process.env.NODE_ENV !== 'production' && LOCAL_DESK_HOSTS.has(h)));
}

// --- API proxy (desk host only) -------------------------------
router.post('/api', (req, res, next) => {
  if (!isDeskHost(req)) return next(); // booking host -> let booking handle /api
  // Only parse the body for desk requests, so we never consume booking's bodies.
  express.text({ type: '*/*', limit: '30mb' })(req, res, async () => {
    if (!APPS_SCRIPT_URL) {
      return res.status(500).json({ ok: false, msg: 'APPS_SCRIPT_URL env var is not set on this service.' });
    }
    try {
      const upstream = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}),
        redirect: 'follow',
      });
      const text = await upstream.text();
      res.set('Content-Type', 'application/json; charset=utf-8').send(text);
    } catch (e) {
      res.status(502).json({ ok: false, msg: 'Proxy error reaching backend: ' + (e.message || e) });
    }
  });
});

// --- Static frontend + SPA fallback (desk host only) ----------
const serveStatic = express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  },
});

router.use((req, res, next) => {
  if (!isDeskHost(req)) return next(); // booking host -> untouched
  serveStatic(req, res, () => {
    // Not a static file -> serve the app shell for GET, else continue
    if (req.method === 'GET') {
      return res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
    next();
  });
});

module.exports = router;
