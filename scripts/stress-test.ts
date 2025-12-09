/**
 * 壓力測試統一入口 (Stress Test Runner)
 *
 * 整合所有測試類型，提供統一的執行介面
 *
 * 使用方式：
 *   npx tsx scripts/stress-test.ts <test-type> [url] [shortCode] [options]
 *
 * 測試類型：
 *   baseline   - 基準測試（5 分鐘低負載）
 *   load       - 負載測試（階段式增加負載）
 *   pulse      - 脈衝測試（間歇性爆發）
 *   spike      - 尖峰測試（突發流量）
 *   endurance  - 耐久測試（長時間運行）
 *   all        - 執行全部測試（按順序）
 *
 * 範例：
 *   npx tsx scripts/stress-test.ts baseline https://url.tzuchi.org xtmzlj
 *   npx tsx scripts/stress-test.ts all https://url.tzuchi.org xtmzlj
 *   npx tsx scripts/stress-test.ts --help
 */

import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 測試類型定義
const TEST_TYPES = {
  baseline: {
    script: 'baseline-test.ts',
    name: '基準測試',
    description: '低負載長時間運行，建立性能基線',
    duration: '5 分鐘',
    priority: 1,
  },
  load: {
    script: 'load-test.ts',
    name: '負載測試',
    description: '階段式增加負載，找出系統容量上限',
    duration: '4 分鐘',
    priority: 2,
  },
  pulse: {
    script: 'pulse-test.ts',
    name: '脈衝測試',
    description: '間歇性爆發，模擬真實流量波動',
    duration: '5 分鐘',
    priority: 3,
  },
  spike: {
    script: 'spike-test.ts',
    name: '尖峰測試',
    description: '突發大量請求，測試系統恢復能力',
    duration: '5 分鐘',
    priority: 4,
  },
  endurance: {
    script: 'endurance-test.ts',
    name: '耐久測試',
    description: '長時間運行，檢測記憶體洩漏',
    duration: '30 分鐘',
    priority: 5,
  },
}

type TestType = keyof typeof TEST_TYPES

function printHelp(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║               短網址系統壓力測試工具 v1.0                              ║
║                                                                      ║
║  基於 ISO/IEC 25010:2011 性能效率標準                                  ║
╚══════════════════════════════════════════════════════════════════════╝

使用方式：
  npx tsx scripts/stress-test.ts <test-type> [url] [shortCode]

測試類型：
${'─'.repeat(70)}
`)

  Object.entries(TEST_TYPES).forEach(([type, info]) => {
    console.log(`  ${type.padEnd(12)} ${info.name.padEnd(8)} ${info.duration.padEnd(8)} ${info.description}`)
  })

  console.log(`  ${'all'.padEnd(12)} ${'全部測試'.padEnd(8)} ${'~50 分鐘'.padEnd(8)} 按順序執行所有測試類型`)

  console.log(`
${'─'.repeat(70)}

範例：
  # 執行基準測試
  npx tsx scripts/stress-test.ts baseline https://url.tzuchi.org xtmzlj

  # 執行所有測試
  npx tsx scripts/stress-test.ts all https://url.tzuchi.org xtmzlj

  # 使用預設 URL 執行負載測試
  npx tsx scripts/stress-test.ts load

測試順序（all 模式）：
  1. baseline  → 建立基線
  2. load      → 找出容量
  3. pulse     → 驗證快取
  4. spike     → 測試恢復
  5. endurance → 長期穩定（可選，需手動執行）

報告位置：
  ./reports/

注意事項：
  - 測試前請確認 Rate Limiting 已停用（壓力測試用）
  - endurance 測試時間較長，建議單獨執行
  - 所有測試報告會自動保存為 JSON 格式
`)
}

async function runTest(
  testType: TestType,
  url: string,
  shortCode: string
): Promise<boolean> {
  const test = TEST_TYPES[testType]
  const scriptPath = path.join(__dirname, test.script)

  console.log(`\n${'═'.repeat(70)}`)
  console.log(`▶️  開始執行: ${test.name} (${testType})`)
  console.log(`   預計時間: ${test.duration}`)
  console.log('═'.repeat(70))

  return new Promise((resolve) => {
    const args = [scriptPath, url, shortCode]
    const child = spawn('npx', ['tsx', ...args], {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    })

    child.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ ${test.name} 完成`)
        resolve(true)
      } else {
        console.log(`\n❌ ${test.name} 失敗 (exit code: ${code})`)
        resolve(false)
      }
    })

    child.on('error', (err) => {
      console.error(`\n❌ ${test.name} 執行錯誤:`, err.message)
      resolve(false)
    })
  })
}

async function runAllTests(url: string, shortCode: string): Promise<void> {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    執行完整壓力測試套件                                ║
╚══════════════════════════════════════════════════════════════════════╝

目標網址: ${url}/s/${shortCode}

即將執行以下測試（endurance 除外）：
`)

  const testsToRun: TestType[] = ['baseline', 'load', 'pulse', 'spike']

  testsToRun.forEach((type, index) => {
    const test = TEST_TYPES[type]
    console.log(`  ${index + 1}. ${test.name} (${test.duration})`)
  })

  console.log(`
⚠️  endurance 測試需要 30 分鐘，請單獨執行：
    npx tsx scripts/stress-test.ts endurance ${url} ${shortCode}

${'─'.repeat(70)}
`)

  const results: { type: TestType; passed: boolean }[] = []
  const startTime = Date.now()

  for (const testType of testsToRun) {
    const passed = await runTest(testType, url, shortCode)
    results.push({ type: testType, passed })

    // 測試間休息 10 秒
    if (testType !== testsToRun[testsToRun.length - 1]) {
      console.log('\n⏳ 休息 10 秒後進行下一個測試...\n')
      await new Promise(resolve => setTimeout(resolve, 10000))
    }
  }

  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                        測試套件完成                                   ║
╚══════════════════════════════════════════════════════════════════════╝

📊 執行結果：
`)

  results.forEach(({ type, passed }) => {
    const test = TEST_TYPES[type]
    const status = passed ? '✅ 通過' : '❌ 失敗'
    console.log(`   ${test.name.padEnd(10)} ${status}`)
  })

  console.log(`
${'─'.repeat(70)}
   通過: ${passed}/${results.length}
   失敗: ${failed}/${results.length}
   耗時: ${Math.floor(elapsed / 60)} 分 ${elapsed % 60} 秒

📁 報告已保存至: ./reports/
`)

  process.exit(failed > 0 ? 1 : 0)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    printHelp()
    process.exit(0)
  }

  const testType = args[0] as TestType | 'all'
  const url = args[1] || 'https://url.tzuchi.org'
  const shortCode = args[2] || 'test'

  if (testType === 'all') {
    await runAllTests(url, shortCode)
  } else if (TEST_TYPES[testType]) {
    const passed = await runTest(testType, url, shortCode)
    process.exit(passed ? 0 : 1)
  } else {
    console.error(`❌ 未知的測試類型: ${testType}`)
    console.log('\n可用的測試類型: baseline, load, pulse, spike, endurance, all')
    console.log('使用 --help 查看詳細說明')
    process.exit(1)
  }
}

main().catch(console.error)
