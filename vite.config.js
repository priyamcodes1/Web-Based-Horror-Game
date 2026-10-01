import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only: POST /__shot?name=x with a PNG data URL body to save a frame to tools/shots/ (visual QA).
const shotPlugin = {
  name: 'dev-shot',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__shot', (req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        const name = (new URL(req.url, 'http://x').searchParams.get('name') || 'shot').replace(/[^\w-]/g, '');
        const dir = path.resolve('tools/shots');
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name + '.jpg'), Buffer.from(body.split(',')[1], 'base64'));
        res.end('ok');
      });
    });
  },
};

export default defineConfig({
  base: './',
  plugins: [shotPlugin],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/peerjs')) return 'peer';
          return undefined;
        },
      },
    },
  },
  server: { host: true, watch: { ignored: ['**/tools/**'] } },
});
