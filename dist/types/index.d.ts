export interface URLRecord {
    id: string;
    short_code: string;
    original_url: string;
    qr_code_generated: boolean;
    qr_code_path?: string;
    qr_code_options?: object;
    created_at: string;
    updated_at: string;
    expires_at?: string;
    user_id?: string;
    is_active: boolean;
    password_protected: boolean;
    password_hash?: string;
}
export interface CreateURLRequest {
    original_url: string;
    short_code?: string;
    expires_at?: string;
    password?: string;
    password_protected?: boolean;
    is_active?: boolean;
}
export interface URLClickRecord {
    id: string;
    url_id: string;
    clicked_at: string;
    user_agent?: string;
    is_qr_scan: boolean;
}
//# sourceMappingURL=index.d.ts.map