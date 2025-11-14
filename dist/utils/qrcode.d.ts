/**
 * QR Code 完整選項介面（基於 qr-code-styling）
 */
export interface QRCodeOptions {
    width?: number;
    height?: number;
    margin?: number;
    shape?: 'square' | 'circle';
    qrOptions?: {
        typeNumber?: number;
        mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji';
        errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
    };
    dotsOptions?: {
        color?: string;
        type?: 'rounded' | 'dots' | 'classy' | 'classy-rounded' | 'square' | 'extra-rounded';
        gradient?: {
            type: 'linear' | 'radial';
            rotation?: number;
            colorStops: Array<{
                offset: number;
                color: string;
            }>;
        };
    };
    backgroundOptions?: {
        color?: string;
        gradient?: {
            type: 'linear' | 'radial';
            rotation?: number;
            colorStops: Array<{
                offset: number;
                color: string;
            }>;
        };
    };
    cornersSquareOptions?: {
        color?: string;
        type?: 'dot' | 'square' | 'extra-rounded' | 'rounded' | 'classy' | 'classy-rounded';
        gradient?: {
            type: 'linear' | 'radial';
            rotation?: number;
            colorStops: Array<{
                offset: number;
                color: string;
            }>;
        };
    };
    cornersDotOptions?: {
        color?: string;
        type?: 'dot' | 'square' | 'rounded' | 'classy' | 'classy-rounded' | 'extra-rounded';
        gradient?: {
            type: 'linear' | 'radial';
            rotation?: number;
            colorStops: Array<{
                offset: number;
                color: string;
            }>;
        };
    };
    imageOptions?: {
        hideBackgroundDots?: boolean;
        imageSize?: number;
        margin?: number;
        crossOrigin?: 'anonymous' | 'use-credentials';
    };
    image?: string;
}
/**
 * 生成 QR Code 並儲存為檔案
 */
export declare function generateQRCode(url: string, shortCode: string, options?: QRCodeOptions): Promise<string>;
/**
 * 生成 QR Code 並回傳 Base64
 */
export declare function generateQRCodeBase64(url: string, options?: QRCodeOptions): Promise<string>;
//# sourceMappingURL=qrcode.d.ts.map