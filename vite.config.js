import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three';
          if (id.includes('node_modules/peerjs') || id.includes('node_modules/webrtc-adapter') || id.includes('node_modules/sdp')) return 'peer';
          return undefined;
        },
      },
    },
  },
  server: { host: true },
});
