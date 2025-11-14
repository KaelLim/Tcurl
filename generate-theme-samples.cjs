/**
 * 生成所有主題的 QR Code 範例
 */
const { QRCodeStyling } = require("qr-code-styling/lib/qr-code-styling.common.js");
const nodeCanvas = require("canvas");
const { JSDOM } = require("jsdom");
const fs = require("fs");

// 從 TypeScript 編譯後的 JS 載入主題
const { QR_THEMES } = require("./dist/utils/qr-themes.js");

async function generateSample(themeId, theme) {
  console.log(`📸 生成 ${theme.name} (${themeId}) 範例...`);

  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    nodeCanvas,
    data: `https://sbeurlpj.tzuchi-org.tw/theme/${themeId}`,
    ...theme.options
  });

  const buffer = await qrCode.getRawData("png");
  const filename = `sample-${themeId}.png`;
  fs.writeFileSync(filename, buffer);

  const stats = fs.statSync(filename);
  console.log(`  ✅ ${filename} (${(stats.size / 1024).toFixed(1)}KB)`);

  return {
    themeId,
    name: theme.name,
    description: theme.description,
    filename,
    size: stats.size
  };
}

(async () => {
  console.log("🎨 開始生成所有主題範例...\n");

  const results = [];

  for (const [themeId, theme] of Object.entries(QR_THEMES)) {
    try {
      const result = await generateSample(themeId, theme);
      results.push(result);
    } catch (error) {
      console.error(`  ❌ 失敗: ${error.message}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 生成結果摘要\n");

  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.name} - ${r.filename} (${(r.size / 1024).toFixed(1)}KB)`);
  });

  console.log("\n" + "=".repeat(60));
  console.log(`\n🎉 完成！共生成 ${results.length} 個主題範例`);
  console.log(`📁 檔案位置: ${__dirname}/sample-*.png\n`);
})();
