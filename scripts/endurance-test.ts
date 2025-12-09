/**
 * 耐久測試腳本 (Endurance/Soak Test)
 *
 * 目的：長時間運行檢測記憶體洩漏、連接池耗盡等問題
 *
 * 使用方式：
 *   npx tsx scripts/endurance-test.ts [url] [shortCode] [duration]
 *
 * 範例：
 *   npx tsx scripts/endurance-test.ts https://url.tzuchi.org xtmzlj 1800
 *
 * 預設時間：30 分鐘（1800 秒）
 */

import autocannon from 'autocannon'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 設定參數
const BASE_URL = process.argv[2] || 'https://url.tzuchi.org'
const SHORT_CODE = process.argv[3] || 'test'
const DURATION = Number(process.argv[4]) || 1800  // 預設 30 分鐘
const CONNECTIONS = 50                             // 中等負載（約 70% 容量）
const SAMPLE_INTERVAL = 60                         // 每 60 秒採樣一次

// 報告目錄
const REPORT_DIR = path.join(__dirname, '../reports')

// 耐久測試目標
const ENDURANCE_TARGETS = {
  maxLatencyDrift: 50,        // 延遲漂移 < 50%（相對於開始時）
  maxMemoryGrowth: 100,       // 記憶體增長 < 100 MB
  maxErrorRate: 0.001,        // 錯誤率 < 0.1%
  minRpsStability: 0.8,       // RPS 穩定性 > 80%（最低/最高）
}

interface SampleResult {
  sampleNum: number
  elapsed: number
  timestamp: string
  requests: number
  latency: {
    avg: number
    min: number
    max: number
    p50: number
    p99: number
  }
  errors: number
  rps: number
  memoryUsage?: {
    rss: number
    heapUsed: number
    heapTotal: number
  }
}

function getSystemMemory(): { rss: number; heapUsed: number; heapTotal: number } | undefined {
  try {
    // 嘗試獲取 PM2 進程的記憶體使用
    const output = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf-8' })
    const processes = JSON.parse(output)
    const shortUrlProcess = processes.find((p: any) => p.name === 'shorturl-api')
    if (shortUrlProcess) {
      return {
        rss: shortUrlProcess.monit?.memory || 0,
        heapUsed: 0,
        heapTotal: 0,
      }
    }
  } catch {
    // 忽略錯誤
  }
  return undefined
}

async function runSample(
  url: string,
  sampleNum: number,
  startTime: number
): Promise<SampleResult> {
  const result = await autocannon({
    url,
    connections: CONNECTIONS,
    duration: SAMPLE_INTERVAL,
    maxRedirects: 0,
  })

  const elapsed = Math.floor((Date.now() - startTime) / 1000)
  const memoryUsage = getSystemMemory()

  return {
    sampleNum,
    elapsed,
    timestamp: new Date().toISOString(),
    requests: result.requests.total,
    latency: {
      avg: result.latency.average,
      min: result.latency.min,
      max: result.latency.max,
      p50: result.latency.p50,
      p99: result.latency.p99,
    },
    errors: result.errors,
    rps: result.requests.total / SAMPLE_INTERVAL,
    memoryUsage,
  }
}

async function runEnduranceTest(): Promise<void> {
  const url = `${BASE_URL}/s/${SHORT_CODE}`
  const totalSamples = Math.ceil(DURATION / SAMPLE_INTERVAL)

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                    耐久測試 (Endurance Test)                          ║
║                                                                      ║
║  目的：長時間運行檢測記憶體洩漏、連接池耗盡等問題                        ║
╚══════════════════════════════════════════════════════════════════════╝

🔧 設定:
   目標網址:     ${url}
   並發連接數:   ${CONNECTIONS}（中等負載）
   測試時間:     ${DURATION} 秒（${(DURATION / 60).toFixed(0)} 分鐘）
   採樣間隔:     每 ${SAMPLE_INTERVAL} 秒
   預計採樣數:   ${totalSamples} 個

📋 監控目標:
   延遲漂移:     < ${ENDURANCE_TARGETS.maxLatencyDrift}%
   記憶體增長:   < ${ENDURANCE_TARGETS.maxMemoryGrowth} MB
   錯誤率:       < ${(ENDURANCE_TARGETS.maxErrorRate * 100).toFixed(2)}%
   RPS 穩定性:   > ${(ENDURANCE_TARGETS.minRpsStability * 100).toFixed(0)}%

${'─'.repeat(70)}
`)

  // 確保報告目錄存在
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const samples: SampleResult[] = []
  const startTime = Date.now()

  console.log(`  │ ${'樣本'.padStart(4)} │ ${'經過時間'.padEnd(8)} │ ${'請求數'.padStart(8)} │ ${'平均延遲'.padStart(8)} │ ${'P99'.padStart(6)} │ ${'RPS'.padStart(8)} │ ${'錯誤'.padStart(4)} │ ${'記憶體'.padStart(8)} │`)
  console.log(`  ${'├' + '─'.repeat(6) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(10) + '┤'}`)

  for (let i = 0; i < totalSamples; i++) {
    const sample = await runSample(url, i + 1, startTime)
    samples.push(sample)

    const elapsedStr = `${Math.floor(sample.elapsed / 60)}:${(sample.elapsed % 60).toString().padStart(2, '0')}`
    const memoryStr = sample.memoryUsage
      ? `${(sample.memoryUsage.rss / 1024 / 1024).toFixed(0)}MB`
      : 'N/A'

    // 計算延遲趨勢指標
    let trend = ''
    if (i > 0) {
      const latencyChange = ((sample.latency.avg - samples[0].latency.avg) / samples[0].latency.avg) * 100
      if (latencyChange > 20) trend = '📈'
      else if (latencyChange < -20) trend = '📉'
      else trend = '➡️'
    }

    console.log(
      `  │ ${sample.sampleNum.toString().padStart(4)} │ ` +
      `${elapsedStr.padStart(8)} │ ` +
      `${sample.requests.toString().padStart(8)} │ ` +
      `${sample.latency.avg.toFixed(1).padStart(6)}ms │ ` +
      `${sample.latency.p99.toString().padStart(4)}ms │ ` +
      `${sample.rps.toFixed(1).padStart(8)} │ ` +
      `${sample.errors.toString().padStart(4)} │ ` +
      `${memoryStr.padStart(8)} │ ${trend}`
    )
  }

  console.log('─'.repeat(70))

  // 分析結果
  const firstSample = samples[0]
  const lastSample = samples[samples.length - 1]

  // 延遲漂移分析
  const latencyDrift = firstSample.latency.avg > 0
    ? ((lastSample.latency.avg - firstSample.latency.avg) / firstSample.latency.avg) * 100
    : 0

  // RPS 穩定性分析
  const rpsValues = samples.map(s => s.rps)
  const minRps = Math.min(...rpsValues)
  const maxRps = Math.max(...rpsValues)
  const rpsStability = maxRps > 0 ? minRps / maxRps : 0

  // 錯誤率
  const totalRequests = samples.reduce((sum, s) => sum + s.requests, 0)
  const totalErrors = samples.reduce((sum, s) => sum + s.errors, 0)
  const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0

  // 記憶體增長
  let memoryGrowth = 0
  if (firstSample.memoryUsage && lastSample.memoryUsage) {
    memoryGrowth = (lastSample.memoryUsage.rss - firstSample.memoryUsage.rss) / 1024 / 1024
  }

  // 延遲趨勢（線性迴歸簡化版）
  const avgLatencies = samples.map(s => s.latency.avg)
  const firstHalfAvg = avgLatencies.slice(0, Math.floor(avgLatencies.length / 2))
    .reduce((a, b) => a + b, 0) / Math.floor(avgLatencies.length / 2)
  const secondHalfAvg = avgLatencies.slice(Math.floor(avgLatencies.length / 2))
    .reduce((a, b) => a + b, 0) / Math.ceil(avgLatencies.length / 2)
  const latencyTrend = secondHalfAvg > firstHalfAvg * 1.1 ? '上升' : secondHalfAvg < firstHalfAvg * 0.9 ? '下降' : '穩定'

  // 驗證目標
  const latencyDriftPassed = Math.abs(latencyDrift) < ENDURANCE_TARGETS.maxLatencyDrift
  const memoryGrowthPassed = memoryGrowth < ENDURANCE_TARGETS.maxMemoryGrowth
  const errorRatePassed = errorRate < ENDURANCE_TARGETS.maxErrorRate
  const rpsStabilityPassed = rpsStability > ENDURANCE_TARGETS.minRpsStability
  const allPassed = latencyDriftPassed && memoryGrowthPassed && errorRatePassed && rpsStabilityPassed

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                           測試結果                                    ║
╚══════════════════════════════════════════════════════════════════════╝

📊 整體統計:
   總請求數:     ${totalRequests.toLocaleString()}
   總錯誤數:     ${totalErrors}
   測試時間:     ${(DURATION / 60).toFixed(0)} 分鐘
   採樣數:       ${samples.length}

📈 性能趨勢:
   開始延遲:     ${firstSample.latency.avg.toFixed(2)} ms
   結束延遲:     ${lastSample.latency.avg.toFixed(2)} ms
   延遲漂移:     ${latencyDrift > 0 ? '+' : ''}${latencyDrift.toFixed(1)}% ${latencyDriftPassed ? '✅' : '❌'} (目標: < ${ENDURANCE_TARGETS.maxLatencyDrift}%)
   延遲趨勢:     ${latencyTrend}

📊 穩定性指標:
   最低 RPS:     ${minRps.toFixed(2)}
   最高 RPS:     ${maxRps.toFixed(2)}
   RPS 穩定性:   ${(rpsStability * 100).toFixed(1)}% ${rpsStabilityPassed ? '✅' : '❌'} (目標: > ${(ENDURANCE_TARGETS.minRpsStability * 100).toFixed(0)}%)
   錯誤率:       ${(errorRate * 100).toFixed(4)}% ${errorRatePassed ? '✅' : '❌'} (目標: < ${(ENDURANCE_TARGETS.maxErrorRate * 100).toFixed(2)}%)
`)

  if (firstSample.memoryUsage && lastSample.memoryUsage) {
    console.log(`
💾 記憶體分析:
   開始記憶體:   ${(firstSample.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB
   結束記憶體:   ${(lastSample.memoryUsage.rss / 1024 / 1024).toFixed(2)} MB
   記憶體增長:   ${memoryGrowth > 0 ? '+' : ''}${memoryGrowth.toFixed(2)} MB ${memoryGrowthPassed ? '✅' : '❌'} (目標: < ${ENDURANCE_TARGETS.maxMemoryGrowth} MB)
`)
  }

  console.log(`${'─'.repeat(70)}

${allPassed ? '✅ 所有耐久測試目標達成 - 系統穩定，無記憶體洩漏跡象' : '❌ 部分目標未達成 - 可能存在穩定性問題'}
`)

  // 生成報告
  const reportTime = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `endurance-test-${reportTime}.json`)

  const report = {
    testInfo: {
      type: 'endurance',
      timestamp: new Date().toISOString(),
      url,
      shortCode: SHORT_CODE,
      connections: CONNECTIONS,
      duration: DURATION,
      sampleInterval: SAMPLE_INTERVAL,
      enduranceTargets: ENDURANCE_TARGETS,
    },
    samples,
    summary: {
      totalRequests,
      totalErrors,
      errorRate,
      latency: {
        first: firstSample.latency.avg,
        last: lastSample.latency.avg,
        drift: latencyDrift,
        trend: latencyTrend,
      },
      rps: {
        min: minRps,
        max: maxRps,
        stability: rpsStability,
      },
      memory: firstSample.memoryUsage && lastSample.memoryUsage ? {
        first: firstSample.memoryUsage.rss,
        last: lastSample.memoryUsage.rss,
        growth: memoryGrowth,
      } : null,
    },
    validation: {
      allPassed,
      latencyDriftPassed,
      memoryGrowthPassed,
      errorRatePassed,
      rpsStabilityPassed,
    },
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`📁 報告已保存: ${reportPath}\n`)

  process.exit(allPassed ? 0 : 1)
}

runEnduranceTest().catch(console.error)
