const config = JSON.parse(Deno.readTextFileSync(new URL('../../deno.json', import.meta.url)));
export const APP_VERSION: string = config.version || '0.0.0';

const versionQuery = `v=${APP_VERSION}`;

export function injectAssetVersion(html: string): string {
  return html.replace(
    /(src|href)="(\/(?:js|css)\/[^"]+)"/g,
    `$1="$2?${versionQuery}"`,
  );
}
