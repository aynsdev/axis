import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const hub = `http://127.0.0.1:${process.env.AYNSHQ_PORT ?? 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5317,
    proxy: {
      '/api': { target: hub, changeOrigin: true },
      '/ws': { target: hub.replace('http', 'ws'), ws: true, changeOrigin: true },
    },
  },
});
