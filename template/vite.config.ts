import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      // Knox-Media 交付面（播放代理页 / 字节流 / 预览页等）在生产由后端 SPA 壳同源提供，
      // 开发时转给 cms-core，保证 /media-play 内部换到的 /media-stream 相对地址可达。
      '/media-play': { target: 'http://localhost:8080', changeOrigin: true },
      '/media-stream': { target: 'http://localhost:8080', changeOrigin: true },
      '/media-preview': { target: 'http://localhost:8080', changeOrigin: true },
      '/media-pdf': { target: 'http://localhost:8080', changeOrigin: true },
      '/media-thumb': { target: 'http://localhost:8080', changeOrigin: true },
      '/media-file': { target: 'http://localhost:8080', changeOrigin: true }
    }
  }
});
