import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: '/sanpokai-kikaku-portal/',
  build: {
    rollupOptions: {
      input: {
        portal: resolve(process.cwd(), 'index.html'),
        formMaker: resolve(process.cwd(), 'form-maker/index.html'),
      },
    },
  },
});
