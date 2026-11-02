import { defineConfig } from 'vitest/config';

// 測試在 Node 執行：Worker 的 bindings（ASSETS、ROOMS_KV、Rate Limiting）與 Supabase API
// 由 tests/helpers/test-env.ts 提供 in-memory 替身，不連任何外部服務。
// 刻意不載入 vite.config.ts 的 Cloudflare plugin。
export default defineConfig({
  test: {
    include: ['src/**/*_test.ts', 'tests/**/*_test.ts'],
    environment: 'node',
  },
});
