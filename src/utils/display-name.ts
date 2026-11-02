/**
 * 使用者顯示名稱
 *
 * 依序 fallback：chinese_lastname + chinese_firstname（舊 Keycloak 帳號）
 * → full_name → name（Google）→ display_name（舊 email 註冊帳號）→ email（@ 前段）→ fallback
 *
 * @module utils/display-name
 */

interface UserLike {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function getDisplayName(user: UserLike, fallback: string): string {
  const meta = user.user_metadata || {};
  const lastname = str(meta.chinese_lastname);
  const firstname = str(meta.chinese_firstname);
  if (lastname && firstname) {
    return `${lastname}${firstname}`;
  }
  return (
    str(meta.full_name) ||
    str(meta.name) ||
    str(meta.display_name) ||
    user.email?.split('@')[0] ||
    fallback
  );
}
