import { QRCodeOptions } from './qrcode';
/**
 * QR Code 主題定義
 */
export interface QRTheme {
    id: string;
    name: string;
    description: string;
    options: QRCodeOptions;
}
/**
 * 預設的 QR Code 主題（使用 qr-code-styling 完整選項）
 */
export declare const QR_THEMES: Record<string, QRTheme>;
/**
 * 預設主題 ID
 */
export declare const DEFAULT_THEME_ID = "tzu-chi-blue";
/**
 * 根據主題 ID 取得主題設定
 */
export declare function getTheme(themeId: string): QRTheme | null;
/**
 * 取得預設主題
 */
export declare function getDefaultTheme(): QRTheme;
/**
 * 取得所有可用主題列表
 */
export declare function getAllThemes(): QRTheme[];
/**
 * 驗證主題 ID 是否存在
 */
export declare function isValidThemeId(themeId: string): boolean;
/**
 * 合併主題選項與自訂選項
 * 自訂選項會覆蓋主題選項
 */
export declare function mergeThemeOptions(themeId: string, customOptions?: Partial<QRCodeOptions>): QRCodeOptions;
//# sourceMappingURL=qr-themes.d.ts.map