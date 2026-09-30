// Client for the Blender Lab MCP extension: JSON + "\0" framing, code sets `result` dict.
const net = require('net'), fs = require('fs');
const code = fs.readFileSync(process.argv[2], 'utf8');
const s = net.createConnection(9876, '127.0.0.1', () =>
  s.write(JSON.stringify({ type: 'execute', code, strict_json: false }) + '\0'));
let buf = '';
s.on('data', d => { buf += d; });
s.on('end', () => {
  const txt = buf.replace(/\0$/, '');
  try { const j = JSON.parse(txt); console.log(JSON.stringify(j, null, 1).slice(0, 30000)); }
  catch (_) { console.log('RAW', txt.slice(0, 5000)); }
});
s.on('error', e => { console.error('ERR', e.message); process.exit(1); });
