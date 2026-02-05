import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@aiqa/common': path.resolve(__dirname, '../server/src/common'),
    },
  },
  server: {
    port: 4000,
  },
  test: {
    globals: true,
    environment: 'node',
  },
});

























