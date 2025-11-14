declare module 'qr-code-styling/lib/qr-code-styling.common.js' {
  export class QRCodeStyling {
    constructor(options: any)
    getRawData(extension: string): Promise<Buffer>
    append(container: any): void
    update(options: any): void
  }
}
