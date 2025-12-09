/**
 * 基準測試腳本 (Baseline Test)
 *
 * 目的：建立系統正常運作時的性能基線
 *
 * 使用方式：
 *   npx tsx scripts/baseline-test.ts [url] [shortCode] [duration]
 *
 * 範例：
 *   npx tsx scripts/baseline-test.ts https://url.tzuchi.org xtmzlj 300
 */

import autocannon from 'autocannon'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 設定參數
const BASE_URL = process.argv[2] || 'https://url.tzuchi.org'
const SHORT_CODE = process.argv[3] || 'test'
const DURATION = Number(process.argv[4]) || 300  // 預設 5 分鐘
const CONNECTIONS = 5                             // 低並發
const SAMPLE_INTERVAL = 10                        // 每 10 秒採樣

// 報告目錄
const REPORT_DIR = path.join(__dirname, '../reports')

// 基準指標目標
const BASELINE_TARGETS = {
  maxLatencyAvg: 50,      // 平均延遲應 < 50ms
  maxLatencyP99: 200,     // P99 延遲應 < 200ms
  minRps: 100,            // 最低 RPS > 100
  maxErrorRate: 0,        // 錯誤率應為 0
}

interface SampleData {
  timestamp: string
  elapsed: number
  requests: number
  latency: {
    avg: number
    min: number
    max: number
    p50: number
    p99: number
  }
  throughput: number
  errors: number
}

async function runBaselineTest(): Promise<void> {
  const url = `${BASE_URL}/s/${SHORT_CODE}`

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    基準測試 (Baseline Test)                           ║
║                                                                      ║
║  目的：建立系統正常運作時的性能基線                                    ║
╚══════════════════════════════════════════════════════════════════════╝

🔧 設定:
   目標網址:     ${url}
   並發連接數:   ${CONNECTIONS}（低負載）
   測試時間:     ${DURATION} 秒（${(DURATION / 60).toFixed(1)} 分鐘）
   採樣間隔:     每 ${SAMPLE_INTERVAL} 秒

📋 基準目標:
   平均延遲:     < ${BASELINE_TARGETS.maxLatencyAvg} ms
   P99 延遲:     < ${BASELINE_TARGETS.maxLatencyP99} ms
   最低 RPS:     > ${BASELINE_TARGETS.minRps}
   錯誤率:       ${BASELINE_TARGETS.maxErrorRate}%

${'─'.repeat(70)}
`)

  // 確保報告目錄存在
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const samples: SampleData[] = []
  const startTime = Date.now()

  // 開始測試
  console.log('⏱️  開始測試...\n')
  console.log(`  │ ${'經過時間'.padEnd(8)} │ ${'請求數'.padStart(8)} │ ${'平均延遲'.padStart(8)} │ ${'P99'.padStart(6)} │ ${'RPS'.padStart(8)} │ ${'錯誤'.padStart(4)} │`)
  console.log(`  ${'├' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(6) + '┤'}`)

  const result = await autocannon({
    url,
    connections: CONNECTIONS,
    duration: DURATION,
    maxRedirects: 0,
    // 進度回調
    setupClient: (client) => {
      let lastRequests = 0
      let lastTime = startTime

      const interval = setInterval(() => {
        const now = Date.now()
        const elapsed = Math.floor((now - startTime) / 1000)

        if (elapsed > DURATION) {
          clearInterval(interval)
          return
        }

        // 只在採樣間隔記錄
        if (elapsed % SAMPLE_INTERVAL === 0 && elapsed > 0) {
          // 這裡無法直接獲取中間數據，會在結果中處理
        }
      }, 1000)
    }
  })

  // 處理結果
  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const rps = result.requests.total / DURATION

  console.log(`  │ ${elapsed.toString().padStart(6)}s │ ${result.requests.total.toString().padStart(8)} │ ${result.latency.average.toFixed(1).padStart(6)}ms │ ${result.latency.p99.toString().padStart(4)}ms │ ${rps.toFixed(1).padStart(8)} │ ${result.errors.toString().padStart(4)} │`)
  console.log('─'.repeat(70))

  // 驗證基準目標
  console.log('\n📊 基準驗證結果:\n')

  const checks = [
    {
      name: '平均延遲',
      value: result.latency.average,
      target: BASELINE_TARGETS.maxLatencyAvg,
      unit: 'ms',
      passed: result.latency.average < BASELINE_TARGETS.maxLatencyAvg,
      comparison: '<'
    },
    {
      name: 'P99 延遲',
      value: result.latency.p99,
      target: BASELINE_TARGETS.maxLatencyP99,
      unit: 'ms',
      passed: result.latency.p99 < BASELINE_TARGETS.maxLatencyP99,
      comparison: '<'
    },
    {
      name: 'RPS',
      value: rps,
      target: BASELINE_TARGETS.minRps,
      unit: '',
      passed: rps > BASELINE_TARGETS.minRps,
      comparison: '>'
    },
    {
      name: '錯誤率',
      value: (result.errors / result.requests.total) * 100,
      target: BASELINE_TARGETS.maxErrorRate,
      unit: '%',
      passed: result.errors === 0,
      comparison: '='
    }
  ]

  let allPassed = true
  checks.forEach(check => {
    const status = check.passed ? '✅' : '❌'
    const valueStr = typeof check.value === 'number' ? check.value.toFixed(2) : check.value
    console.log(`   ${status} ${check.name}: ${valueStr}${check.unit} (目標: ${check.comparison} ${check.target}${check.unit})`)
    if (!check.passed) allPassed = false
  })

  // 生成報告
  const reportTime = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `baseline-test-${reportTime}.json`)

  const report = {
    testInfo: {
      type: 'baseline',
      timestamp: new Date().toISOString(),
      url,
      shortCode: SHORT_CODE,
      connections: CONNECTIONS,
      duration: DURATION,
      baselineTargets: BASELINE_TARGETS,
    },
    results: {
      requests: {
        total: result.requests.total,
        average: result.requests.average,
        rps,
      },
      latency: {
        average: result.latency.average,
        min: result.latency.min,
        max: result.latency.max,
        p50: result.latency.p50,
        p99: result.latency.p99,
      },
      throughput: {
        average: result.throughput.average,
        total: result.throughput.total,
      },
      errors: result.errors,
      timeouts: result.timeouts,
    },
    validation: {
      allPassed,
      checks: checks.map(c => ({
        name: c.name,
        value: c.value,
        target: c.target,
        passed: c.passed,
      })),
    },
    baseline: {
      // 這些值可作為後續測試的比較基準
      avgLatency: result.latency.average,
      p99Latency: result.latency.p99,
      rps,
      errorRate: result.errors / result.requests.total,
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  console.log(`
${'─'.repeat(70)}

📋 總結:
   總請求數:     ${result.requests.total.toLocaleString()}
   平均 RPS:     ${rps.toFixed(2)}
   平均延遲:     ${result.latency.average.toFixed(2)} ms
   P50 延遲:     ${result.latency.p50} ms
   P99 延遲:     ${result.latency.p99} ms
   錯誤數:       ${result.errors}

${allPassed ? '✅ 所有基準目標達成' : '❌ 部分基準目標未達成'}

📁 報告已保存: ${reportPath}
`)

  process.exit(allPassed ? 0 : 1)
}

runBaselineTest().catch(console.error)
