/**
 * 預設的 QR Code 主題（使用 qr-code-styling 完整選項）
 */
export const QR_THEMES = {
    // 慈濟藍（預設）
    'tzu-chi-blue': {
        id: 'tzu-chi-blue',
        name: '慈濟藍',
        description: '經典的慈濟藍色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#1337ec',
                type: 'rounded'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#1337ec',
                type: 'extra-rounded'
            },
            cornersDotOptions: {
                color: '#1337ec',
                type: 'dot'
            }
        }
    },
    // 清新綠
    'fresh-green': {
        id: 'fresh-green',
        name: '清新綠',
        description: '環保清新的綠色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#10b981',
                type: 'rounded'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#059669',
                type: 'extra-rounded'
            },
            cornersDotOptions: {
                color: '#10b981',
                type: 'dot'
            }
        }
    },
    // 熱情紅
    'passion-red': {
        id: 'passion-red',
        name: '熱情紅',
        description: '充滿活力的紅色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#ef4444',
                type: 'rounded'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#dc2626',
                type: 'extra-rounded'
            },
            cornersDotOptions: {
                color: '#ef4444',
                type: 'dot'
            }
        }
    },
    // 尊貴金
    'elegant-gold': {
        id: 'elegant-gold',
        name: '尊貴金',
        description: '高雅的金色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#f59e0b',
                type: 'classy-rounded'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#d97706',
                type: 'extra-rounded'
            },
            cornersDotOptions: {
                color: '#f59e0b',
                type: 'square'
            }
        }
    },
    // 深邃紫
    'deep-purple': {
        id: 'deep-purple',
        name: '深邃紫',
        description: '神秘的紫色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#8b5cf6',
                type: 'extra-rounded'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#7c3aed',
                type: 'classy-rounded'
            },
            cornersDotOptions: {
                color: '#8b5cf6',
                type: 'rounded'
            }
        }
    },
    // 經典黑
    'classic-black': {
        id: 'classic-black',
        name: '經典黑',
        description: '簡約的黑白風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#000000',
                type: 'square'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#000000',
                type: 'square'
            },
            cornersDotOptions: {
                color: '#000000',
                type: 'square'
            }
        }
    },
    // 天空藍
    'sky-blue': {
        id: 'sky-blue',
        name: '天空藍',
        description: '清爽的天空藍風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#0ea5e9',
                type: 'dots'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#0284c7',
                type: 'rounded'
            },
            cornersDotOptions: {
                color: '#0ea5e9',
                type: 'dot'
            }
        }
    },
    // 橙色活力
    'vibrant-orange': {
        id: 'vibrant-orange',
        name: '橙色活力',
        description: '充滿陽光的橙色風格',
        options: {
            width: 500,
            height: 500,
            shape: 'square',
            qrOptions: {
                errorCorrectionLevel: 'H'
            },
            dotsOptions: {
                color: '#f97316',
                type: 'classy'
            },
            backgroundOptions: {
                color: '#ffffff'
            },
            cornersSquareOptions: {
                color: '#ea580c',
                type: 'classy'
            },
            cornersDotOptions: {
                color: '#f97316',
                type: 'square'
            }
        }
    }
};
/**
 * 預設主題 ID
 */
export const DEFAULT_THEME_ID = 'tzu-chi-blue';
/**
 * 根據主題 ID 取得主題設定
 */
export function getTheme(themeId) {
    return QR_THEMES[themeId] || null;
}
/**
 * 取得預設主題
 */
export function getDefaultTheme() {
    return QR_THEMES[DEFAULT_THEME_ID];
}
/**
 * 取得所有可用主題列表
 */
export function getAllThemes() {
    return Object.values(QR_THEMES);
}
/**
 * 驗證主題 ID 是否存在
 */
export function isValidThemeId(themeId) {
    return themeId in QR_THEMES;
}
/**
 * 合併主題選項與自訂選項
 * 自訂選項會覆蓋主題選項
 */
export function mergeThemeOptions(themeId, customOptions) {
    const theme = getTheme(themeId) || getDefaultTheme();
    return {
        ...theme.options,
        ...customOptions,
        // 深度合併 nested options
        dotsOptions: {
            ...theme.options.dotsOptions,
            ...customOptions?.dotsOptions
        },
        backgroundOptions: {
            ...theme.options.backgroundOptions,
            ...customOptions?.backgroundOptions
        },
        cornersSquareOptions: {
            ...theme.options.cornersSquareOptions,
            ...customOptions?.cornersSquareOptions
        },
        cornersDotOptions: {
            ...theme.options.cornersDotOptions,
            ...customOptions?.cornersDotOptions
        },
        qrOptions: {
            ...theme.options.qrOptions,
            ...customOptions?.qrOptions
        }
    };
}
//# sourceMappingURL=qr-themes.js.map