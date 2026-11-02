/**
 * Cloudflare Pages 入口（Pages Functions advanced mode）
 *
 * 為什麼不直接把 Hono app 搬進 Pages：Pages 不支援 Rate Limiting binding，而一般 API、
 * 轉址、密碼驗證的限流都依賴它。所以 Pages 只負責「網域」（可用 CNAME 接上 DNS 不在
 * Cloudflare 的網域），所有請求原封不動透過 service binding 轉給 Worker `tcurl`。
 *
 * - 請求的 URL、標頭（含 CF-Connecting-IP）、method、body 都不變；Worker 看到的網域就是使用者看到的網域。
 * - 靜態檔、KV、限流、Smart Placement、secrets 全部留在 Worker（見 cloudflare.config.ts）。
 * - 綁定設定在 Pages 專案（deployment_configs）：service binding TCURL → Worker tcurl。
 */
export default {
  async fetch(request, env) {
    return env.TCURL.fetch(request);
  },
};
