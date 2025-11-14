import path from 'path';
import fs from 'fs/promises';
// 使用 dynamic import 來載入 CommonJS 模組
let QRCodeStyling;
let nodeCanvas;
let JSDOM;
async function loadDependencies() {
    if (!QRCodeStyling) {
        const qrModule = await import('qr-code-styling/lib/qr-code-styling.common.js');
        QRCodeStyling = qrModule.QRCodeStyling || qrModule.default?.QRCodeStyling;
        nodeCanvas = (await import('canvas')).default;
        const jsdomModule = await import('jsdom');
        JSDOM = jsdomModule.JSDOM;
    }
}
/**
 * 預設選項
 */
const DEFAULT_OPTIONS = {
    width: 500,
    height: 500,
    margin: 0,
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
    }
};
/**
 * 生成 QR Code 並儲存為檔案
 */
export async function generateQRCode(url, shortCode, options = {}) {
    await loadDependencies();
    // 合併選項
    const mergedOptions = mergeDeep(DEFAULT_OPTIONS, options);
    // 建立 QR Code
    const qrCode = new QRCodeStyling({
        jsdom: JSDOM,
        nodeCanvas,
        data: url,
        ...mergedOptions
    });
    // 生成 Buffer
    const buffer = await qrCode.getRawData('png');
    // 確保目錄存在
    const qrcodesDir = path.join(process.cwd(), 'public', 'qrcodes');
    await fs.mkdir(qrcodesDir, { recursive: true });
    // 儲存檔案
    const fileName = `${shortCode}.png`;
    const filePath = path.join(qrcodesDir, fileName);
    await fs.writeFile(filePath, buffer);
    return `/qrcodes/${fileName}`;
}
/**
 * 生成 QR Code 並回傳 Base64
 */
export async function generateQRCodeBase64(url, options = {}) {
    await loadDependencies();
    const mergedOptions = mergeDeep(DEFAULT_OPTIONS, options);
    const qrCode = new QRCodeStyling({
        jsdom: JSDOM,
        nodeCanvas,
        data: url,
        ...mergedOptions
    });
    const buffer = await qrCode.getRawData('png');
    return `data:image/png;base64,${buffer.toString('base64')}`;
}
/**
 * 深度合併物件
 */
function mergeDeep(target, source) {
    const output = { ...target };
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (isObject(source[key])) {
                if (!(key in target)) {
                    Object.assign(output, { [key]: source[key] });
                }
                else {
                    output[key] = mergeDeep(target[key], source[key]);
                }
            }
            else {
                Object.assign(output, { [key]: source[key] });
            }
        });
    }
    return output;
}
function isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
}
//# sourceMappingURL=qrcode.js.map