// Development harness: serves the built renderer to a normal browser with a window.appflowy
// shim, bridged over HTTP to the real Rust core (rust-lib/electron-core). Useful for visual
// checks where electron.exe cannot run. Not part of the app.
//
//   npm run build && npm run harness:compile
//   node scripts/web-harness/server.cjs --port 5199 --support <scratch dir> [--renderer <built renderer dir>]
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const compiled = path.join(root, '.cache/harness');
const { CoreProcess } = require(path.join(compiled, 'core/process.js'));
const { coreBinaryPath } = require(path.join(compiled, 'core/binary.js'));
const { SharedPreferences } = require(path.join(compiled, 'prefs.js'));
const { readDeviceId } = require(path.join(compiled, 'device-id.js'));

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const port = Number(arg('port', '5199'));
const support = path.resolve(arg('support', path.join(root, '.cache/harness-support')));
fs.mkdirSync(support, { recursive: true });

const rendererDir = path.resolve(arg('renderer', path.join(root, 'out/renderer')));
const prefs = new SharedPreferences(path.join(support, 'shared_preferences.json'));
const core = new CoreProcess(coreBinaryPath(root, false));
let started = null;
const startCore = () => (started ??= core.start((chunk) => process.env.HARNESS_CORE_LOG && process.stdout.write(chunk)));

// JSON encoding of binary values and bigints across the bridge.
const encode = (value) =>
  JSON.stringify(value, (_k, v) => {
    if (typeof v === 'bigint') return { __bigint: v.toString() };
    if (v instanceof Uint8Array) return { __bytes: Buffer.from(v).toString('base64') };
    if (ArrayBuffer.isView(v)) return { __bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64') };
    return v;
  });
const decode = (text) =>
  JSON.parse(text, (_k, v) => {
    if (v && typeof v === 'object' && '__bigint' in v) return BigInt(v.__bigint);
    if (v && typeof v === 'object' && '__bytes' in v) return new Uint8Array(Buffer.from(v.__bytes, 'base64'));
    return v;
  });

const clients = new Set();
const broadcast = (event) => {
  const data = `data: ${encode(event)}\n\n`;
  for (const res of clients) res.write(data);
};
core.on('notification', (payload) => broadcast({ type: 'notification', payload }));
core.on('portMessage', (p, value) => broadcast({ type: 'port', port: p, value }));
core.on('exit', (code) => {
  started = null;
  broadcast({ type: 'coreExit', code });
});

const handlers = {
  'core.init': async (config) => {
    await startCore();
    return core.init(config);
  },
  'core.request': async (event, payload) => {
    await startCore();
    return core.request(event, payload);
  },
  'core.log': (level, message) => core.log(level, message),
  'app.info': () => ({
    version: require(path.join(root, 'package.json')).version,
    platform: process.platform,
    isPackaged: false,
    paths: { appData: support, documents: support, home: support, temp: support, userData: support, support },
  }),
  'app.deviceId': () => readDeviceId(),
  'app.takeLaunchDeepLink': () => null,
  'prefs.getAll': () => prefs.getAll(),
  'prefs.set': (key, value) => prefs.set(key, value),
  'prefs.setDouble': (key, value) => prefs.setDouble(key, value),
  'prefs.remove': (key) => prefs.remove(key),
  'fs.exists': (target) => fs.existsSync(target),
  'fs.ensureDir': (target) => void fs.mkdirSync(target, { recursive: true }),
  'fs.readText': (target) => (fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null),
  'fs.writeText': (target, content) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  },
  'window.isMaximized': () => false,
  'themes.list': () => [],
  'certificates.list': () => [],
};

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ttf': 'font/ttf', '.json': 'application/json', '.woff2': 'font/woff2' };

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === '/__harness/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write(':ok\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/__harness/rpc' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { method, args } = decode(body);
      try {
        const handler = handlers[method];
        const result = handler ? await handler(...args) : null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(encode({ ok: true, result: result ?? null }));
      } catch (error) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(encode({ ok: false, error: String(error?.message ?? error) }));
      }
      return;
    }
    if (url.pathname === '/__harness/shim.js') {
      res.writeHead(200, { 'Content-Type': 'text/javascript' });
      res.end(fs.readFileSync(path.join(__dirname, 'shim.js')));
      return;
    }
    const file = path.join(rendererDir, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
    if (!file.startsWith(rendererDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end();
      return;
    }
    let content = fs.readFileSync(file);
    if (file.endsWith('index.html')) {
      content = Buffer.from(
        content.toString('utf8').replace('<script type="module"', '<script src="/__harness/shim.js"></script>\n    <script type="module"'),
      );
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  })
  .listen(port, '127.0.0.1', () => console.log(`harness http://127.0.0.1:${port} (support ${support})`));

const shutdown = () => core.stop().finally(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
