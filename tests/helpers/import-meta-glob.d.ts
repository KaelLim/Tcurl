// Vite / Vitest 的 import.meta.glob（測試用最小型別宣告，避免引入 DOM 型別的 vite/client）
interface ImportMeta {
  glob<T = unknown>(
    pattern: string | string[],
    options?: { eager?: boolean; query?: string; import?: string },
  ): Record<string, T>;
}
