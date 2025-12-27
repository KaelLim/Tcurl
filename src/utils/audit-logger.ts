/**
 * 稽核日誌工具 - Deno 版本
 *
 * 符合 ISO 27001 資訊安全標準的日誌記錄
 *
 * A.12.4.1 - 事件日誌
 * A.12.4.2 - 日誌資訊保護
 * A.12.4.3 - 管理員和操作員日誌
 *
 * @module utils/audit-logger
 */

/**
 * 稽核事件類型
 */
export enum AuditEventType {
  // 認證事件
  AUTH_LOGIN_SUCCESS = 'AUTH_LOGIN_SUCCESS',
  AUTH_LOGIN_FAILURE = 'AUTH_LOGIN_FAILURE',
  AUTH_LOGOUT = 'AUTH_LOGOUT',
  AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',

  // 短網址操作
  URL_CREATE = 'URL_CREATE',
  URL_UPDATE = 'URL_UPDATE',
  URL_DELETE = 'URL_DELETE',
  URL_ACCESS = 'URL_ACCESS',
  URL_PASSWORD_CHECK = 'URL_PASSWORD_CHECK',

  // 安全事件
  SECURITY_RATE_LIMIT = 'SECURITY_RATE_LIMIT',
  SECURITY_INVALID_INPUT = 'SECURITY_INVALID_INPUT',
  SECURITY_SSRF_ATTEMPT = 'SECURITY_SSRF_ATTEMPT',
  SECURITY_UNAUTHORIZED = 'SECURITY_UNAUTHORIZED',

  // 系統事件
  SYSTEM_START = 'SYSTEM_START',
  SYSTEM_SHUTDOWN = 'SYSTEM_SHUTDOWN',
  SYSTEM_ERROR = 'SYSTEM_ERROR',
  SYSTEM_CONFIG_CHANGE = 'SYSTEM_CONFIG_CHANGE',
}

/**
 * 稽核日誌記錄介面
 */
export interface AuditLogEntry {
  /** 時間戳 (ISO 8601) */
  timestamp: string;
  /** 事件類型 */
  eventType: AuditEventType;
  /** 使用者 ID（如有） */
  userId?: string;
  /** 使用者 email（如有） */
  userEmail?: string;
  /** 客戶端 IP */
  clientIp: string;
  /** User Agent */
  userAgent?: string;
  /** 請求路徑 */
  path?: string;
  /** HTTP 方法 */
  method?: string;
  /** 資源 ID（如短網址 ID） */
  resourceId?: string;
  /** 操作結果 */
  success: boolean;
  /** 詳細資訊 */
  details?: Record<string, unknown>;
  /** 錯誤訊息（如有） */
  error?: string;
}

/**
 * 格式化日誌條目為 JSON 字串
 */
function formatLogEntry(entry: AuditLogEntry): string {
  return JSON.stringify({
    ...entry,
    // 確保敏感資訊被遮蔽
    details: entry.details ? sanitizeDetails(entry.details) : undefined,
  });
}

/**
 * 清理敏感資訊
 */
function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'authorization'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeDetails(value as Record<string, unknown>);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * 取得客戶端 IP
 */
export function getClientIp(headers: Headers): string {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * 記錄稽核事件
 *
 * @param entry - 稽核日誌條目
 */
export function logAuditEvent(entry: Omit<AuditLogEntry, 'timestamp'>): void {
  const fullEntry: AuditLogEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  const logLine = formatLogEntry(fullEntry);

  // 根據事件類型決定日誌級別
  if (entry.eventType.startsWith('SECURITY_') || entry.eventType.includes('FAILURE')) {
    console.warn(`[AUDIT] ${logLine}`);
  } else if (entry.eventType.startsWith('SYSTEM_ERROR')) {
    console.error(`[AUDIT] ${logLine}`);
  } else {
    console.info(`[AUDIT] ${logLine}`);
  }

  // 未來可以擴展：寫入檔案或發送到日誌服務
  // await Deno.writeTextFile('./logs/audit.log', logLine + '\n', { append: true });
}

/**
 * 建立 Hono 中間件用的稽核日誌記錄器
 */
export function createAuditMiddleware() {
  // deno-lint-ignore no-explicit-any
  return async (c: any, next: () => Promise<void>): Promise<void | Response> => {
    const startTime = Date.now();

    // 記錄請求開始
    const clientIp = getClientIp(c.req.raw.headers);
    const path = c.req.path;
    const method = c.req.method;

    // 執行下一個中間件/路由
    await next();

    const responseTime = Date.now() - startTime;
    const statusCode = c.res.status;

    // 只記錄重要的 API 請求（排除靜態檔案）
    if (path.startsWith('/api/') || path.startsWith('/s/')) {
      logAuditEvent({
        eventType: statusCode >= 400 ? AuditEventType.SECURITY_INVALID_INPUT : AuditEventType.URL_ACCESS,
        clientIp,
        userAgent: c.req.header('user-agent'),
        path,
        method,
        success: statusCode < 400,
        details: {
          statusCode,
          responseTime: `${responseTime}ms`,
        },
      });
    }
  };
}

/**
 * 記錄認證成功
 */
export function logAuthSuccess(userId: string, email: string, clientIp: string, userAgent?: string): void {
  logAuditEvent({
    eventType: AuditEventType.AUTH_LOGIN_SUCCESS,
    userId,
    userEmail: email,
    clientIp,
    userAgent,
    success: true,
  });
}

/**
 * 記錄認證失敗
 */
export function logAuthFailure(email: string, clientIp: string, userAgent?: string, reason?: string): void {
  logAuditEvent({
    eventType: AuditEventType.AUTH_LOGIN_FAILURE,
    userEmail: email,
    clientIp,
    userAgent,
    success: false,
    error: reason,
  });
}

/**
 * 記錄短網址操作
 */
export function logUrlOperation(
  type: 'create' | 'update' | 'delete',
  urlId: string,
  userId: string,
  clientIp: string,
  success: boolean,
  details?: Record<string, unknown>
): void {
  const eventTypeMap = {
    create: AuditEventType.URL_CREATE,
    update: AuditEventType.URL_UPDATE,
    delete: AuditEventType.URL_DELETE,
  };

  logAuditEvent({
    eventType: eventTypeMap[type],
    userId,
    resourceId: urlId,
    clientIp,
    success,
    details,
  });
}

/**
 * 記錄安全事件
 */
export function logSecurityEvent(
  type: 'rate_limit' | 'ssrf_attempt' | 'unauthorized',
  clientIp: string,
  details?: Record<string, unknown>
): void {
  const eventTypeMap = {
    rate_limit: AuditEventType.SECURITY_RATE_LIMIT,
    ssrf_attempt: AuditEventType.SECURITY_SSRF_ATTEMPT,
    unauthorized: AuditEventType.SECURITY_UNAUTHORIZED,
  };

  logAuditEvent({
    eventType: eventTypeMap[type],
    clientIp,
    success: false,
    details,
  });
}

/**
 * 記錄系統啟動
 */
export function logSystemStart(details?: Record<string, unknown>): void {
  logAuditEvent({
    eventType: AuditEventType.SYSTEM_START,
    clientIp: 'localhost',
    success: true,
    details: {
      runtime: `Deno ${Deno.version.deno}`,
      ...details,
    },
  });
}
