import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the Finanzas SPA.
// - JSX/React via @vitejs/plugin-react.
// - .jsx extension is treated as React automatically.
// - publicDir keeps sw.js, manifest.webmanifest and other static files served at root.
// - The dev server proxies nothing; Supabase calls go straight to the SDK.
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    rollupOptions: {
      output: {
        // Split heavy vendor libs into their own chunks for better caching
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          'recharts-vendor': ['recharts'],
          'supabase-vendor': ['@supabase/supabase-js'],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
