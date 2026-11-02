import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// cf dev / cf build 透過 Cloudflare Vite plugin 執行；Worker 設定在 cloudflare.config.ts。
// public/ 為 Vite 預設的 publicDir，內容原樣成為 Workers Static Assets。
export default defineConfig({
  plugins: [cloudflare()],
});
