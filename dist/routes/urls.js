import { supabase } from '../services/supabase.js';
import { redis, CACHE_KEYS, CACHE_TTL } from '../services/redis.js';
import { generateShortCode, isValidShortCode } from '../utils/shortcode.js';
import { generateQRCode, generateQRCodeBase64 } from '../utils/qrcode.js';
import { isValidThemeId, mergeThemeOptions, getDefaultTheme } from '../utils/qr-themes.js';
import { renderPasswordPage, renderExpiredPage } from '../utils/html-templates.js';
import bcrypt from 'bcrypt';
export default async function urlRoutes(fastify) {
    // 創建短網址
    fastify.post('/api/urls', async (request, reply) => {
        const { original_url, short_code, expires_at } = request.body;
        // 驗證原始 URL
        if (!original_url) {
            return reply.code(400).send({ error: 'original_url is required' });
        }
        // 生成或驗證短代碼
        let finalShortCode = short_code;
        if (finalShortCode) {
            if (!isValidShortCode(finalShortCode)) {
                return reply.code(400).send({ error: 'Invalid short code format' });
            }
            // 檢查是否已存在
            const { data: existing } = await supabase
                .from('urls')
                .select('short_code')
                .eq('short_code', finalShortCode)
                .single();
            if (existing) {
                return reply.code(409).send({ error: 'Short code already exists' });
            }
        }
        else {
            // 生成唯一短代碼
            let attempts = 0;
            while (attempts < 10) {
                finalShortCode = generateShortCode(Number(process.env.SHORT_CODE_LENGTH) || 6);
                const { data } = await supabase
                    .from('urls')
                    .select('short_code')
                    .eq('short_code', finalShortCode)
                    .single();
                if (!data)
                    break;
                attempts++;
            }
            if (attempts >= 10) {
                return reply.code(500).send({ error: 'Failed to generate unique short code' });
            }
        }
        // 插入資料庫
        const { data, error } = await supabase
            .from('urls')
            .insert({
            short_code: finalShortCode,
            original_url,
            expires_at
        })
            .select()
            .single();
        if (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to create short URL' });
        }
        // 不再自動生成 QR Code，由用戶決定是否生成
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const shortUrl = `${baseUrl}/s/${finalShortCode}`;
        return reply.code(201).send({
            ...data,
            short_url: shortUrl
        });
    });
    // 獲取所有短網址列表（支援分頁，從 View 讀取即時統計）
    fastify.get('/api/urls', async (request, reply) => {
        const page = parseInt(request.query.page || '1');
        const limit = parseInt(request.query.limit || '10');
        const offset = (page - 1) * limit;
        // 取得總數
        const { count, error: countError } = await supabase
            .from('url_total_stats')
            .select('*', { count: 'exact', head: true })
            .eq('is_active', true);
        if (countError) {
            fastify.log.error(countError);
            return reply.code(500).send({ error: 'Failed to count URLs' });
        }
        // 從 url_total_stats View 取得分頁資料（包含即時統計）
        const { data: statsData, error: statsError } = await supabase
            .from('url_total_stats')
            .select('*')
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
        if (statsError) {
            fastify.log.error(statsError);
            return reply.code(500).send({ error: 'Failed to fetch URLs' });
        }
        // 取得對應的 URL 完整資訊（包含 qr_code_generated 等）
        const urlIds = statsData?.map(s => s.url_id) || [];
        const { data: urlsData, error: urlsError } = await supabase
            .from('urls')
            .select('id, qr_code_generated, qr_code_path, qr_code_options, password_protected, expires_at, user_id')
            .in('id', urlIds);
        if (urlsError) {
            fastify.log.error(urlsError);
        }
        // 合併資料
        const urlsMap = new Map(urlsData?.map(u => [u.id, u]) || []);
        const mergedData = statsData?.map(stat => {
            const urlData = urlsMap.get(stat.url_id);
            return {
                id: stat.url_id,
                short_code: stat.short_code,
                original_url: stat.original_url,
                created_at: stat.created_at,
                is_active: stat.is_active,
                clicks: stat.total_clicks || 0,
                link_clicks: stat.link_clicks || 0,
                qr_scans: stat.qr_scans || 0,
                last_clicked_at: stat.last_clicked_at,
                qr_code_generated: urlData?.qr_code_generated || false,
                qr_code_path: urlData?.qr_code_path,
                qr_code_options: urlData?.qr_code_options,
                password_protected: urlData?.password_protected || false,
                expires_at: urlData?.expires_at,
                user_id: urlData?.user_id
            };
        });
        const totalPages = Math.ceil((count || 0) / limit);
        // 設定防快取 headers，確保每次都取得最新資料
        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
        return reply.send({
            data: mergedData,
            pagination: {
                page,
                limit,
                total: count || 0,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });
    });
    // 獲取單個短網址詳情
    fastify.get('/api/urls/:id', async (request, reply) => {
        const { id } = request.params;
        const { data, error } = await supabase
            .from('urls')
            .select('*')
            .eq('id', id)
            .single();
        if (error || !data) {
            return reply.code(404).send({ error: 'URL not found' });
        }
        return reply.send(data);
    });
    // 更新短網址
    fastify.put('/api/urls/:id', async (request, reply) => {
        const { id } = request.params;
        const { password, password_protected, ...otherUpdates } = request.body;
        // 準備更新資料
        const updates = { ...otherUpdates };
        // 處理密碼保護
        if (password_protected !== undefined) {
            updates.password_protected = password_protected;
            if (password_protected && password) {
                // 啟用密碼保護且提供新密碼，進行 hash
                const saltRounds = 10;
                updates.password_hash = await bcrypt.hash(password, saltRounds);
            }
            else if (!password_protected) {
                // 停用密碼保護，清除 hash
                updates.password_hash = null;
            }
        }
        else if (password) {
            // 只更新密碼（不改變 password_protected 狀態）
            const saltRounds = 10;
            updates.password_hash = await bcrypt.hash(password, saltRounds);
            updates.password_protected = true;
        }
        const { data, error } = await supabase
            .from('urls')
            .update(updates)
            .eq('id', id)
            .select()
            .single();
        if (error || !data) {
            return reply.code(404).send({ error: 'URL not found' });
        }
        // 清除 Redis 快取（因為資料已更新）
        try {
            const cacheKey = CACHE_KEYS.URL(data.short_code);
            await redis.del(cacheKey);
            fastify.log.info(`Cache invalidated for ${data.short_code} after update`);
        }
        catch (redisError) {
            fastify.log.error({ err: redisError }, 'Failed to invalidate cache');
        }
        // 如果更新了原始 URL，重新生成 QR Code
        if (updates.original_url && data.qr_code_generated) {
            const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
            const shortUrl = `${baseUrl}/s/${data.short_code}`;
            try {
                const qrPath = await generateQRCode(shortUrl, data.short_code);
                await supabase
                    .from('urls')
                    .update({ qr_code_path: qrPath })
                    .eq('id', id);
                data.qr_code_path = qrPath;
            }
            catch (qrError) {
                fastify.log.error(qrError);
            }
        }
        return reply.send(data);
    });
    // 刪除短網址（真正刪除）
    fastify.delete('/api/urls/:id', async (request, reply) => {
        const { id } = request.params;
        // 先取得資料以便清除快取
        const { data: urlData } = await supabase
            .from('urls')
            .select('short_code, qr_code_path')
            .eq('id', id)
            .single();
        if (!urlData) {
            return reply.code(404).send({ error: 'URL not found' });
        }
        // 刪除 QR Code 檔案（如果存在）
        if (urlData.qr_code_path) {
            try {
                const fs = await import('fs/promises');
                const path = await import('path');
                const filePath = path.join(process.cwd(), 'public', urlData.qr_code_path);
                await fs.unlink(filePath);
                fastify.log.info(`QR code file deleted: ${filePath}`);
            }
            catch (fileError) {
                fastify.log.error({ err: fileError }, 'Failed to delete QR code file');
            }
        }
        // 從資料庫真正刪除
        const { error } = await supabase
            .from('urls')
            .delete()
            .eq('id', id);
        if (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to delete URL' });
        }
        // 清除 Redis 快取
        try {
            const cacheKey = CACHE_KEYS.URL(urlData.short_code);
            await redis.del(cacheKey);
            fastify.log.info(`Cache invalidated for ${urlData.short_code} after deletion`);
        }
        catch (redisError) {
            fastify.log.error({ err: redisError }, 'Failed to invalidate cache');
        }
        return reply.send({ message: 'URL deleted successfully' });
    });
    // 生成/更新 QR Code（使用主題或自訂選項）
    fastify.post('/api/urls/:id/qrcode', async (request, reply) => {
        const { id } = request.params;
        const { themeId, customOptions } = request.body;
        // 查詢 URL 記錄
        const { data: urlData, error: urlError } = await supabase
            .from('urls')
            .select('*')
            .eq('id', id)
            .eq('is_active', true)
            .single();
        if (urlError || !urlData) {
            return reply.code(404).send({ error: 'URL not found' });
        }
        // 決定使用的選項
        let qrOptions;
        if (themeId) {
            // 使用主題
            if (!isValidThemeId(themeId)) {
                return reply.code(400).send({ error: 'Invalid theme ID' });
            }
            qrOptions = mergeThemeOptions(themeId, customOptions);
        }
        else if (customOptions) {
            // 使用完全自訂
            const defaultTheme = getDefaultTheme();
            qrOptions = { ...defaultTheme.options, ...customOptions };
        }
        else {
            // 使用預設主題
            const defaultTheme = getDefaultTheme();
            qrOptions = defaultTheme.options;
        }
        // 生成 QR Code（加上 ?qr=true 參數以追蹤 QR 掃描）
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const shortUrl = `${baseUrl}/s/${urlData.short_code}?qr=true`;
        try {
            const qrPath = await generateQRCode(shortUrl, urlData.short_code, qrOptions);
            // 更新資料庫
            const { data: updated, error: updateError } = await supabase
                .from('urls')
                .update({
                qr_code_generated: true,
                qr_code_path: qrPath,
                qr_code_options: { themeId, ...qrOptions }
            })
                .eq('id', id)
                .select()
                .single();
            if (updateError) {
                fastify.log.error(updateError);
                return reply.code(500).send({ error: 'Failed to update QR code' });
            }
            return reply.send({
                ...updated,
                qr_code: qrPath,
                short_url: shortUrl
            });
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to generate QR code' });
        }
    });
    // 預覽 QR Code（不儲存）
    fastify.post('/api/urls/qrcode/preview', async (request, reply) => {
        const { url, themeId, customOptions } = request.body;
        if (!url) {
            return reply.code(400).send({ error: 'URL is required' });
        }
        // 決定使用的選項
        let qrOptions;
        if (themeId) {
            if (!isValidThemeId(themeId)) {
                return reply.code(400).send({ error: 'Invalid theme ID' });
            }
            qrOptions = mergeThemeOptions(themeId, customOptions);
        }
        else if (customOptions) {
            const defaultTheme = getDefaultTheme();
            qrOptions = { ...defaultTheme.options, ...customOptions };
        }
        else {
            const defaultTheme = getDefaultTheme();
            qrOptions = defaultTheme.options;
        }
        try {
            const qrBase64 = await generateQRCodeBase64(url, qrOptions);
            return reply.send({ qr_code: qrBase64 });
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to generate QR code preview' });
        }
    });
    // 取得 URL 的 QR Code 設定
    fastify.get('/api/urls/:id/qrcode/options', async (request, reply) => {
        const { id } = request.params;
        const { data, error } = await supabase
            .from('urls')
            .select('qr_code_options, qr_code_generated, qr_code_path')
            .eq('id', id)
            .eq('is_active', true)
            .single();
        if (error || !data) {
            return reply.code(404).send({ error: 'URL not found' });
        }
        return reply.send({
            qr_code_generated: data.qr_code_generated,
            qr_code_path: data.qr_code_path,
            qr_code_options: data.qr_code_options
        });
    });
    // 取得所有可用的 QR Code 主題
    fastify.get('/api/qrcode/themes', async (request, reply) => {
        const { getAllThemes } = await import('../utils/qr-themes.js');
        const themes = getAllThemes();
        return reply.send({ themes });
    });
    // 獲取 QR Code（Base64 格式，舊的向後相容端點）
    fastify.get('/api/qrcode/:shortCode', async (request, reply) => {
        const { shortCode } = request.params;
        const { data } = await supabase
            .from('urls')
            .select('short_code')
            .eq('short_code', shortCode)
            .eq('is_active', true)
            .single();
        if (!data) {
            return reply.code(404).send({ error: 'Short URL not found' });
        }
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const shortUrl = `${baseUrl}/s/${shortCode}?qr=true`;
        try {
            const qrBase64 = await generateQRCodeBase64(shortUrl);
            return reply.send({ qr_code: qrBase64 });
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to generate QR code' });
        }
    });
    // 驗證密碼保護的短網址
    fastify.post('/api/urls/:shortCode/verify-password', async (request, reply) => {
        const { shortCode } = request.params;
        const { password } = request.body;
        if (!password) {
            return reply.code(400).send({ error: 'Password is required' });
        }
        // 查詢 URL 記錄
        const { data, error } = await supabase
            .from('urls')
            .select('*')
            .eq('short_code', shortCode)
            .eq('is_active', true)
            .single();
        if (error || !data) {
            return reply.code(404).send({ error: 'Short URL not found' });
        }
        // 檢查過期
        if (data.expires_at && new Date(data.expires_at) < new Date()) {
            return reply.code(410).send({ error: 'Short URL has expired' });
        }
        // 檢查是否設定密碼保護
        if (!data.password_protected || !data.password_hash) {
            return reply.code(400).send({ error: 'This URL is not password protected' });
        }
        // 驗證密碼
        const isValid = await bcrypt.compare(password, data.password_hash);
        if (!isValid) {
            return reply.code(401).send({ error: 'Invalid password' });
        }
        // 密碼正確，記錄點擊
        supabase.from('url_clicks').insert({
            url_id: data.id,
            user_agent: request.headers['user-agent'] || null,
            is_qr_scan: false // 密碼驗證頁面訪問視為直接連結點擊
        }).then();
        // 返回原始 URL
        return reply.send({
            original_url: data.original_url,
            short_code: data.short_code
        });
    });
    // 短網址重定向（使用 Redis 快取）
    fastify.get('/s/:shortCode', async (request, reply) => {
        const { shortCode } = request.params;
        const { qr } = request.query;
        const isQrScan = qr === '1' || qr === 'true';
        try {
            // 1. 先查 Redis 快取
            const cacheKey = CACHE_KEYS.URL(shortCode);
            const cached = await redis.get(cacheKey);
            if (cached) {
                // 快取命中
                const cachedData = JSON.parse(cached);
                // 檢查過期時間
                if (cachedData.expires_at && new Date(cachedData.expires_at) < new Date()) {
                    // 清除已過期的快取
                    await redis.del(cacheKey);
                    return reply.type('text/html').send(renderExpiredPage(cachedData.expires_at));
                }
                // 檢查是否需要密碼保護
                if (cachedData.password_protected && cachedData.password_hash) {
                    return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan));
                }
                // 異步記錄點擊
                supabase.from('url_clicks').insert({
                    url_id: cachedData.id,
                    user_agent: request.headers['user-agent'] || null,
                    is_qr_scan: isQrScan
                }).then();
                fastify.log.info(`Cache hit for ${shortCode}`);
                return reply.redirect(cachedData.original_url, 302);
            }
            // 2. 快取未命中，查詢資料庫
            const { data, error } = await supabase
                .from('urls')
                .select('*')
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .single();
            if (error || !data) {
                return reply.code(404).send({ error: 'Short URL not found' });
            }
            // 檢查過期時間
            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                // 返回過期頁面
                return reply.type('text/html').send(renderExpiredPage(data.expires_at));
            }
            // 檢查是否需要密碼保護
            if (data.password_protected && data.password_hash) {
                // 返回密碼驗證頁面
                return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan));
            }
            // 3. 存入 Redis 快取（包含密碼保護和過期資訊）
            await redis.setex(cacheKey, CACHE_TTL.URL, JSON.stringify({
                id: data.id,
                original_url: data.original_url,
                short_code: data.short_code,
                password_protected: data.password_protected,
                password_hash: data.password_hash,
                expires_at: data.expires_at
            }));
            // 4. 記錄點擊（只記錄必要資訊）
            supabase.from('url_clicks').insert({
                url_id: data.id,
                user_agent: request.headers['user-agent'] || null,
                is_qr_scan: isQrScan
            }).then();
            fastify.log.info(`Cache miss for ${shortCode}, cached now`);
            // 6. 重定向
            return reply.redirect(data.original_url, 302);
        }
        catch (redisError) {
            // Redis 錯誤不應該影響服務，降級為直接查資料庫
            fastify.log.error({ err: redisError }, 'Redis error, falling back to database');
            const { data, error } = await supabase
                .from('urls')
                .select('*')
                .eq('short_code', shortCode)
                .eq('is_active', true)
                .single();
            if (error || !data) {
                return reply.code(404).send({ error: 'Short URL not found' });
            }
            // 檢查過期時間
            if (data.expires_at && new Date(data.expires_at) < new Date()) {
                return reply.type('text/html').send(renderExpiredPage(data.expires_at));
            }
            // 檢查是否需要密碼保護
            if (data.password_protected && data.password_hash) {
                return reply.type('text/html').send(renderPasswordPage(shortCode, isQrScan));
            }
            // 記錄點擊
            supabase.from('url_clicks').insert({
                url_id: data.id,
                user_agent: request.headers['user-agent'] || null,
                is_qr_scan: isQrScan
            }).then();
            return reply.redirect(data.original_url, 302);
        }
    });
    // 獲取 URL 統計資料（從 Materialized Views）
    fastify.get('/api/urls/:id/stats', async (request, reply) => {
        const { id } = request.params;
        const days = parseInt(request.query.days || '30');
        try {
            // 從 url_total_stats 獲取總體統計
            const { data: totalStats, error: totalError } = await supabase
                .from('url_total_stats')
                .select('*')
                .eq('url_id', id)
                .single();
            if (totalError || !totalStats) {
                return reply.code(404).send({ error: 'URL not found' });
            }
            // 從 url_daily_stats 獲取每日統計（最近 N 天）
            const { data: dailyStats, error: dailyError } = await supabase
                .from('url_daily_stats')
                .select('*')
                .eq('url_id', id)
                .order('date', { ascending: false })
                .limit(days);
            if (dailyError) {
                fastify.log.error(dailyError);
                return reply.code(500).send({ error: 'Failed to fetch daily stats' });
            }
            return reply.send({
                total: {
                    total_clicks: totalStats.total_clicks || 0,
                    link_clicks: totalStats.link_clicks || 0,
                    qr_scans: totalStats.qr_scans || 0,
                    last_clicked_at: totalStats.last_clicked_at
                },
                daily: dailyStats || []
            });
        }
        catch (error) {
            fastify.log.error(error);
            return reply.code(500).send({ error: 'Failed to fetch stats' });
        }
    });
    // 取得統計摘要（總體統計數據）
    fastify.get('/api/urls/stats/summary', async (request, reply) => {
        try {
            // 從 url_total_stats 計算總體統計
            const { data: statsData, error } = await supabase
                .from('url_total_stats')
                .select('total_clicks, is_active');
            if (error) {
                fastify.log.error({ err: error }, 'Failed to fetch stats summary');
                return reply.code(500).send({ error: 'Failed to fetch statistics' });
            }
            const totalLinks = statsData?.length || 0;
            const activeLinks = statsData?.filter(s => s.is_active).length || 0;
            const totalClicks = statsData?.reduce((sum, s) => sum + (s.total_clicks || 0), 0) || 0;
            return reply.send({
                totalLinks,
                activeLinks,
                totalClicks
            });
        }
        catch (error) {
            fastify.log.error({ err: error }, 'Error calculating stats summary');
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
    // 注意：已改用一般 View，統計數據即時更新，不需要手動刷新端點
    // ========== 美化路由（無 .html 擴展名） ==========
    // /links → serve links.html
    fastify.get('/links', async (request, reply) => {
        return reply.sendFile('links.html');
    });
    // /edit/:id → serve edit.html with id parameter
    fastify.get('/edit/:id', async (request, reply) => {
        // 將 ID 放入查詢參數，讓前端 JS 可以讀取
        return reply.redirect(`/edit.html?id=${request.params.id}`, 302);
    });
    // /analytics → serve analytics.html
    fastify.get('/analytics', async (request, reply) => {
        return reply.sendFile('analytics.html');
    });
}
//# sourceMappingURL=urls.js.map