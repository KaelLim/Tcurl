/**
 * QR Code 樣式設定（`urls.qr_code_options`）的格式檢查
 *
 * 網頁（public/js/edit.js 的 applyCustomQR）只送下面 7 個鍵。編輯頁、我的連結、統計頁讀回後用來產生
 * QR Code，其中的色碼會放進 HTML 屬性。服務 API 金鑰也能寫這個欄位（PATCH /api/urls/:id/qr-code），
 * 寫入的外部服務與在網頁上觀看的負責同仁是不同的人，所以後端只接受已知的鍵與格式，其他一律拒絕
 * （spec §4 反目標 1：金鑰不能碰到它自己建立的短網址以外的資料，包括負責同仁的登入 session）。
 * 格式與 public/docs/openapi.yaml 的 QrCodeOptions 一致。
 *
 * @module utils/qr-code-options
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const DOTS_TYPES = ['square', 'rounded', 'extra-rounded', 'dots', 'classy', 'classy-rounded'];
const CORNERS_SQUARE_TYPES = ['square', 'dot', 'extra-rounded'];
const CORNERS_DOT_TYPES = ['square', 'dot', 'rounded'];

export interface QrCodeOptions {
  dotsColor?: string;
  bgColor?: string;
  bgOpacity?: number;
  dotsType?: string;
  cornersSquareType?: string;
  cornersDotType?: string;
  showLogo?: boolean;
}

const isHexColor = (v: unknown): boolean => typeof v === 'string' && HEX_COLOR.test(v);
const isOneOf =
  (allowed: readonly string[]) =>
  (v: unknown): boolean =>
    typeof v === 'string' && allowed.includes(v);

/** 每個允許的鍵與它的格式（鍵都可省略；網頁讀回時有預設值） */
const FIELD_CHECKS: Record<keyof QrCodeOptions, (v: unknown) => boolean> = {
  dotsColor: isHexColor,
  bgColor: isHexColor,
  bgOpacity: (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100,
  dotsType: isOneOf(DOTS_TYPES),
  cornersSquareType: isOneOf(CORNERS_SQUARE_TYPES),
  cornersDotType: isOneOf(CORNERS_DOT_TYPES),
  showLogo: (v) => typeof v === 'boolean',
};

const ALLOWED_KEYS = Object.keys(FIELD_CHECKS);

export type QrCodeOptionsResult =
  | { ok: true; value: QrCodeOptions }
  | { ok: false; message: string };

/**
 * 檢查請求帶來的 qr_code_options。合法時回傳只含允許鍵的新物件；
 * 不是物件、有未知的鍵，或任何值格式不符都回 `ok: false`（訊息不回顯請求內容）。
 */
export function parseQrCodeOptions(input: unknown): QrCodeOptionsResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'qr_code_options 必須是物件' };
  }

  const value: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(input)) {
    if (!Object.hasOwn(FIELD_CHECKS, key)) {
      return { ok: false, message: `qr_code_options 只接受 ${ALLOWED_KEYS.join('、')}` };
    }
    if (!FIELD_CHECKS[key as keyof QrCodeOptions](field)) {
      return { ok: false, message: `qr_code_options.${key} 格式不正確` };
    }
    value[key] = field;
  }
  return { ok: true, value: value as QrCodeOptions };
}
