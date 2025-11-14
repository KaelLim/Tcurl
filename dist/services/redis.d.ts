import Redis from 'ioredis';
export declare const redis: Redis;
export declare const CACHE_KEYS: {
    URL: (shortCode: string) => string;
    CLICKS: (urlId: string) => string;
    QR_SCANS: (urlId: string) => string;
};
export declare const CACHE_TTL: {
    URL: number;
    STATS: number;
};
//# sourceMappingURL=redis.d.ts.map