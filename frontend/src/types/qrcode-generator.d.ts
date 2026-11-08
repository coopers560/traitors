declare module "qrcode-generator" {
  type ErrorCorrectionLevel = "L" | "M" | "Q" | "H";
  interface QRCodeModel {
    addData(data: string): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
  /** typeNumber 0 = auto-select the smallest version that fits the data. */
  function qrcode(typeNumber: number, errorCorrectionLevel: ErrorCorrectionLevel): QRCodeModel;
  export default qrcode;
}
