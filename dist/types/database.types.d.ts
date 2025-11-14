export type Json = string | number | boolean | null | {
    [key: string]: Json | undefined;
} | Json[];
export type Database = {
    public: {
        Tables: {
            url_clicks: {
                Row: {
                    clicked_at: string | null;
                    id: string;
                    is_qr_scan: boolean | null;
                    url_id: string;
                    user_agent: string | null;
                };
                Insert: {
                    clicked_at?: string | null;
                    id?: string;
                    is_qr_scan?: boolean | null;
                    url_id: string;
                    user_agent?: string | null;
                };
                Update: {
                    clicked_at?: string | null;
                    id?: string;
                    is_qr_scan?: boolean | null;
                    url_id?: string;
                    user_agent?: string | null;
                };
            };
            urls: {
                Row: {
                    created_at: string | null;
                    expires_at: string | null;
                    id: string;
                    is_active: boolean | null;
                    original_url: string;
                    password_hash: string | null;
                    password_protected: boolean | null;
                    qr_code_generated: boolean | null;
                    qr_code_options: Json | null;
                    qr_code_path: string | null;
                    short_code: string;
                    updated_at: string | null;
                    user_id: string | null;
                };
                Insert: {
                    created_at?: string | null;
                    expires_at?: string | null;
                    id?: string;
                    is_active?: boolean | null;
                    original_url: string;
                    password_hash?: string | null;
                    password_protected?: boolean | null;
                    qr_code_generated?: boolean | null;
                    qr_code_options?: Json | null;
                    qr_code_path?: string | null;
                    short_code: string;
                    updated_at?: string | null;
                    user_id?: string | null;
                };
                Update: {
                    created_at?: string | null;
                    expires_at?: string | null;
                    id?: string;
                    is_active?: boolean | null;
                    original_url?: string;
                    password_hash?: string | null;
                    password_protected?: boolean | null;
                    qr_code_generated?: boolean | null;
                    qr_code_options?: Json | null;
                    qr_code_path?: string | null;
                    short_code?: string;
                    updated_at?: string | null;
                    user_id?: string | null;
                };
            };
        };
        Views: {
            url_daily_stats: {
                Row: {
                    date: string | null;
                    link_clicks: number | null;
                    qr_scans: number | null;
                    total_clicks: number | null;
                    url_id: string | null;
                };
            };
            url_recent_stats: {
                Row: {
                    all_time_clicks: number | null;
                    all_time_qr_scans: number | null;
                    all_time_total: number | null;
                    month_clicks: number | null;
                    month_qr_scans: number | null;
                    month_total: number | null;
                    short_code: string | null;
                    today_clicks: number | null;
                    today_qr_scans: number | null;
                    today_total: number | null;
                    url_id: string | null;
                    week_clicks: number | null;
                    week_qr_scans: number | null;
                    week_total: number | null;
                };
            };
            url_total_stats: {
                Row: {
                    created_at: string | null;
                    is_active: boolean | null;
                    last_clicked_at: string | null;
                    link_clicks: number | null;
                    original_url: string | null;
                    qr_scans: number | null;
                    short_code: string | null;
                    total_clicks: number | null;
                    url_id: string | null;
                };
            };
        };
        Functions: {
            [_ in never]: never;
        };
        Enums: {
            [_ in never]: never;
        };
    };
};
export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type Inserts<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type Updates<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
export type Views<T extends keyof Database['public']['Views']> = Database['public']['Views'][T]['Row'];
//# sourceMappingURL=database.types.d.ts.map