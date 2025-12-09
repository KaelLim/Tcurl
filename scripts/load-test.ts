/**
 * 短網址系統壓力測試腳本
 *
 * 使用方式：
 *   npx tsx scripts/load-test.ts [target-url] [short-code]
 *
 * 範例：
 *   npx tsx scripts/load-test.ts https://url.tzuchi.org test123
 *   npx tsx scripts/load-test.ts http://localhost:8080 abc123
 *
 * 環境變數：
 *   LOAD_TEST_URL     - 目標 URL（預設 http://localhost:8080）
 *   LOAD_TEST_CODE    - 測試用短代碼（預設 test）
 *   LOAD_TEST_STAGES  - 測試階段，逗號分隔（預設 10,50,100,200）
 */

import autocannon from 'autocannon'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 設定參數
const BASE_URL = process.argv[2] || process.env.LOAD_TEST_URL || 'http://localhost:8080'
const SHORT_CODE = process.argv[3] || process.env.LOAD_TEST_CODE || 'test'
const STAGES = (process.env.LOAD_TEST_STAGES || '10,50,100,200').split(',').map(Number)
const DURATION = 30 // 每階段持續秒數

// 報告目錄
const REPORT_DIR = path.join(__dirname, '../reports')

// SLI/SLO 目標
const SLO = {
  latencyP95: 200,      // P95 延遲 < 200ms
  latencyP99: 500,      // P99 延遲 < 500ms
  errorRate: 0.001,     // 錯誤率 < 0.1%
  minRps: 1000          // 最低 RPS
}

interface TestResult {
  stage: number
  connections: number
  duration: number
  timestamp: string
  url: string
  requests: {
    total: number
    average: number
    min: number
    max: number
    p95: number
    p99: number
  }
  latency: {
    average: number
    min: number
    max: number
    p50: number
    p95: number
    p99: number
  }
  throughput: {
    average: number
    total: number
  }
  errors: number
  timeouts: number
  rps: number
  sloStatus: {
    latencyP95: boolean
    latencyP99: boolean
    errorRate: boolean
    rps: boolean
    allPassed: boolean
  }
}

async function runStage(connections: number, stage: number): Promise<TestResult> {
  const targetUrl = `${BASE_URL}/s/${SHORT_CODE}`

  console.log(`\n${'='.repeat(60)}`)
  console.log(`📊 階段 ${stage}: ${connections} 並發連線`)
  console.log(`🎯 目標: ${targetUrl}`)
  console.log(`⏱️  持續: ${DURATION} 秒`)
  console.log('='.repeat(60))

  const result = await autocannon({
    url: targetUrl,
    connections: connections,
    duration: DURATION,
    // 不跟隨重定向，測試 302 回應速度
    maxRedirects: 0,
  })

  // 計算 RPS
  const rps = result.requests.total / DURATION

  // 計算錯誤率
  const totalRequests = result.requests.total
  const errorCount = result.errors + result.timeouts
  const errorRate = totalRequests > 0 ? errorCount / totalRequests : 0

  // SLO 檢查
  const sloStatus = {
    latencyP95: result.latency.p95 <= SLO.latencyP95,
    latencyP99: result.latency.p99 <= SLO.latencyP99,
    errorRate: errorRate <= SLO.errorRate,
    rps: rps >= SLO.minRps,
    allPassed: false
  }
  sloStatus.allPassed = sloStatus.latencyP95 && sloStatus.latencyP99 && sloStatus.errorRate && sloStatus.rps

  // 輸出結果
  console.log('\n📈 測試結果:')
  console.log('─'.repeat(40))
  console.log(`  總請求數:     ${result.requests.total.toLocaleString()}`)
  console.log(`  RPS:          ${rps.toFixed(2)} req/s`)
  console.log(`  平均延遲:     ${result.latency.average.toFixed(2)} ms`)
  console.log(`  P50 延遲:     ${result.latency.p50} ms`)
  console.log(`  P95 延遲:     ${result.latency.p95} ms ${sloStatus.latencyP95 ? '✅' : '❌'}`)
  console.log(`  P99 延遲:     ${result.latency.p99} ms ${sloStatus.latencyP99 ? '✅' : '❌'}`)
  console.log(`  錯誤數:       ${errorCount} (${(errorRate * 100).toFixed(3)}%) ${sloStatus.errorRate ? '✅' : '❌'}`)
  console.log(`  吞吐量:       ${(result.throughput.average / 1024 / 1024).toFixed(2)} MB/s`)
  console.log('─'.repeat(40))
  console.log(`  SLO 狀態:     ${sloStatus.allPassed ? '✅ 全部通過' : '❌ 未達標'}`)

  return {
    stage,
    connections,
    duration: DURATION,
    timestamp: new Date().toISOString(),
    url: targetUrl,
    requests: {
      total: result.requests.total,
      average: result.requests.average,
      min: result.requests.min,
      max: result.requests.max,
      p95: result.requests.p95,
      p99: result.requests.p99
    },
    latency: {
      average: result.latency.average,
      min: result.latency.min,
      max: result.latency.max,
      p50: result.latency.p50,
      p95: result.latency.p95,
      p99: result.latency.p99
    },
    throughput: {
      average: result.throughput.average,
      total: result.throughput.total
    },
    errors: result.errors,
    timeouts: result.timeouts,
    rps,
    sloStatus
  }
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║           短網址系統壓力測試 (Load Test)                      ║
║                                                              ║
║  基於 ISO/IEC 25010 性能效率標準                              ║
╚══════════════════════════════════════════════════════════════╝

🔧 設定:
   目標 URL:    ${BASE_URL}
   短代碼:      ${SHORT_CODE}
   測試階段:    ${STAGES.join(' → ')} 並發
   每階段時間:  ${DURATION} 秒

📋 SLO 目標:
   P95 延遲:    < ${SLO.latencyP95} ms
   P99 延遲:    < ${SLO.latencyP99} ms
   錯誤率:      < ${(SLO.errorRate * 100).toFixed(2)}%
   最低 RPS:    > ${SLO.minRps}
`)

  // 確保報告目錄存在
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const results: TestResult[] = []

  // 執行各階段測試
  for (let i = 0; i < STAGES.length; i++) {
    const connections = STAGES[i]
    const result = await runStage(connections, i + 1)
    results.push(result)

    // 階段間休息 5 秒
    if (i < STAGES.length - 1) {
      console.log('\n⏳ 休息 5 秒後進入下一階段...')
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // 生成報告
  const reportTime = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `load-test-${reportTime}.json`)

  const report = {
    testInfo: {
      timestamp: new Date().toISOString(),
      baseUrl: BASE_URL,
      shortCode: SHORT_CODE,
      stages: STAGES,
      durationPerStage: DURATION,
      sloTargets: SLO
    },
    results,
    summary: {
      totalRequests: results.reduce((sum, r) => sum + r.requests.total, 0),
      totalErrors: results.reduce((sum, r) => sum + r.errors + r.timeouts, 0),
      maxRps: Math.max(...results.map(r => r.rps)),
      avgLatencyP95: results.reduce((sum, r) => sum + r.latency.p95, 0) / results.length,
      allSlosPassed: results.every(r => r.sloStatus.allPassed)
    }
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // 最終摘要
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                        測試完成                               ║
╚══════════════════════════════════════════════════════════════╝

📊 總結:
   總請求數:    ${report.summary.totalRequests.toLocaleString()}
   總錯誤數:    ${report.summary.totalErrors}
   最高 RPS:    ${report.summary.maxRps.toFixed(2)}
   平均 P95:    ${report.summary.avgLatencyP95.toFixed(2)} ms
   SLO 狀態:    ${report.summary.allSlosPassed ? '✅ 全部達標' : '❌ 未達標'}

📁 報告已保存: ${reportPath}
`)

  // 如果 SLO 未達標，返回非零退出碼
  process.exit(report.summary.allSlosPassed ? 0 : 1)
}

main().catch(console.error)
