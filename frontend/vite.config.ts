import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Para servir em subpasta (ex: /brain/), fazer build com: VITE_BASE=/brain/ npm run build
  const base = process.env.VITE_BASE ?? env.VITE_BASE ?? '/';
  const devBackendOrigin = process.env.VITE_DEV_BACKEND_ORIGIN ?? env.VITE_DEV_BACKEND_ORIGIN ?? 'http://localhost:3001';
  const basePath = base.endsWith('/') ? base.slice(0, -1) : base;
  const apiPath = `${basePath}/api`;
  const uploadsPath = `${basePath}/uploads`;
  const socketPath = `${basePath}/socket.io`;

  return {
    base,
    plugins: [react()],
    server: {
      port: Number(process.env.PORT ?? 5173),
      proxy: {
        [apiPath]: devBackendOrigin,
        [uploadsPath]: devBackendOrigin,
        [socketPath]: { target: devBackendOrigin, ws: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html', 'lcov'],
        reportsDirectory: './coverage',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.d.ts', 'src/main.tsx'],
      },
    },
  };
});
