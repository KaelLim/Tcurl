const { QRCodeStyling } = require("qr-code-styling/lib/qr-code-styling.common.js");
const nodeCanvas = require("canvas");
const { JSDOM } = require("jsdom");
const fs = require("fs");

// 測試基本功能
const testBasic = async () => {
  console.log("🧪 測試 1: 基本 QR Code 生成...");

  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    nodeCanvas,
    width: 500,
    height: 500,
    data: "https://sbeurlpj.tzuchi-org.tw/test",
    dotsOptions: {
      color: "#1337ec",
      type: "rounded"
    },
    backgroundOptions: {
      color: "#ffffff",
    }
  });

  const buffer = await qrCode.getRawData("png");
  fs.writeFileSync("test-basic.png", buffer);
  console.log("✅ 基本測試完成: test-basic.png");
};

// 測試 Dots 樣式
const testDotsStyles = async () => {
  console.log("\n🧪 測試 2: Dots 樣式...");

  const styles = ['rounded', 'dots', 'classy', 'classy-rounded', 'square', 'extra-rounded'];

  for (const style of styles) {
    const qrCode = new QRCodeStyling({
      jsdom: JSDOM,
      nodeCanvas,
      width: 300,
      height: 300,
      data: `https://test.com/${style}`,
      dotsOptions: {
        color: "#ef4444",
        type: style
      }
    });

    const buffer = await qrCode.getRawData("png");
    fs.writeFileSync(`test-dots-${style}.png`, buffer);
    console.log(`  ✅ ${style} 完成`);
  }
};

// 測試 Corners 樣式
const testCornersStyles = async () => {
  console.log("\n🧪 測試 3: Corners 樣式...");

  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    nodeCanvas,
    width: 500,
    height: 500,
    data: "https://test.com/corners",
    dotsOptions: {
      color: "#10b981",
      type: "rounded"
    },
    cornersSquareOptions: {
      color: "#8b5cf6",
      type: "extra-rounded"
    },
    cornersDotOptions: {
      color: "#f59e0b",
      type: "dot"
    }
  });

  const buffer = await qrCode.getRawData("png");
  fs.writeFileSync("test-corners.png", buffer);
  console.log("✅ Corners 測試完成");
};

// 測試漸層
const testGradient = async () => {
  console.log("\n🧪 測試 4: 漸層效果...");

  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    nodeCanvas,
    width: 500,
    height: 500,
    data: "https://test.com/gradient",
    dotsOptions: {
      type: "rounded",
      gradient: {
        type: "linear",
        rotation: Math.PI / 4,
        colorStops: [
          { offset: 0, color: "#1337ec" },
          { offset: 1, color: "#ef4444" }
        ]
      }
    },
    cornersSquareOptions: {
      type: "extra-rounded",
      gradient: {
        type: "radial",
        colorStops: [
          { offset: 0, color: "#f59e0b" },
          { offset: 1, color: "#8b5cf6" }
        ]
      }
    }
  });

  const buffer = await qrCode.getRawData("png");
  fs.writeFileSync("test-gradient.png", buffer);
  console.log("✅ 漸層測試完成");
};

// 測試圓形 QR Code
const testCircleShape = async () => {
  console.log("\n🧪 測試 5: 圓形 QR Code...");

  const qrCode = new QRCodeStyling({
    jsdom: JSDOM,
    nodeCanvas,
    width: 500,
    height: 500,
    shape: "circle", // 圓形！
    data: "https://test.com/circle",
    dotsOptions: {
      color: "#1337ec",
      type: "dots"
    }
  });

  const buffer = await qrCode.getRawData("png");
  fs.writeFileSync("test-circle.png", buffer);
  console.log("✅ 圓形測試完成");
};

// 執行所有測試
(async () => {
  try {
    await testBasic();
    await testDotsStyles();
    await testCornersStyles();
    await testGradient();
    await testCircleShape();

    console.log("\n🎉 所有測試完成！\n");
    console.log("生成的檔案：");
    console.log("  - test-basic.png (基本)");
    console.log("  - test-dots-*.png (6 種 dots 樣式)");
    console.log("  - test-corners.png (corners 客製化)");
    console.log("  - test-gradient.png (漸層效果)");
    console.log("  - test-circle.png (圓形 QR)");
  } catch (error) {
    console.error("❌ 測試失敗:", error);
    process.exit(1);
  }
})();
