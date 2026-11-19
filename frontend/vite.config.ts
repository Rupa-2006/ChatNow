import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendOrigin = env.VITE_BACKEND_PROXY_TARGET || 'http://localhost:4000';

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      port: 5174,
      strictPort: true,
      proxy: {
        // Same-origin proxying in development keeps the HttpOnly SameSite=Strict
        // refresh cookie working identically to Nginx in production.
        '/api': {
          target: backendOrigin,
          changeOrigin: true,
        },
        '/socket.io': {
          target: backendOrigin,
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
