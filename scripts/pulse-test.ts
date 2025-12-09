/**
 * 短網址系統脈衝式壓力測試腳本
 *
 * 支援多網址同時測試，每隔固定時間發送一波請求
 *
 * 使用方式：
 *   npx tsx scripts/pulse-test.ts [url1,url2,...] [shortCode1,shortCode2,...]
 *
 * 範例：
 *   npx tsx scripts/pulse-test.ts https://url.tzuchi.org YDyHKx,QnWkwt
 */

import autocannon from 'autocannon'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 設定參數
const BASE_URL = process.argv[2] || 'https://url.tzuchi.org'
const SHORT_CODES = (process.argv[3] || 'test').split(',')
const STAGES = [10, 50, 100, 200]        // 並發階段
const PULSE_INTERVAL = 15                 // 每 15 秒一波
const PULSES_PER_STAGE = 4               // 每階段 4 波 = 1 分鐘
const PULSE_DURATION = 1                  // 每波持續 1 秒

// 報告目錄
const REPORT_DIR = path.join(__dirname, '../reports')

// SLI/SLO 目標
const SLO = {
  latencyP99: 500,      // P99 延遲 < 500ms
  errorRate: 0.001,     // 錯誤率 < 0.1%
}

interface PulseResult {
  pulse: number
  shortCode: string
  requests: number
  latency: {
    avg: number
    min: number
    max: number
    p50: number
    p99: number
  }
  errors: number
  timeouts: number
}

interface StageResult {
  stage: number
  connections: number
  shortCode: string
  pulses: PulseResult[]
  summary: {
    totalRequests: number
    avgLatency: number
    p50Latency: number
    p99Latency: number
    totalErrors: number
    errorRate: number
  }
}

async function runPulse(
  url: string,
  shortCode: string,
  connections: number,
  pulseNum: number
): Promise<PulseResult> {
  const result = await autocannon({
    url,
    connections,
    duration: PULSE_DURATION,
    maxRedirects: 0,
  })

  return {
    pulse: pulseNum,
    shortCode,
    requests: result.requests.total,
    latency: {
      avg: result.latency.average,
      min: result.latency.min,
      max: result.latency.max,
      p50: result.latency.p50,
      p99: result.latency.p99,
    },
    errors: result.errors,
    timeouts: result.timeouts,
  }
}

async function runStage(
  connections: number,
  stageNum: number
): Promise<StageResult[]> {
  console.log(`\n${'='.repeat(70)}`)
  console.log(`📊 階段 ${stageNum}: ${connections} 並發 × ${PULSES_PER_STAGE} 波（每 ${PULSE_INTERVAL} 秒）`)
  console.log('='.repeat(70))

  const stageResults: Map<string, PulseResult[]> = new Map()
  SHORT_CODES.forEach(code => stageResults.set(code, []))

  for (let pulse = 1; pulse <= PULSES_PER_STAGE; pulse++) {
    console.log(`\n  波次 ${pulse}/${PULSES_PER_STAGE} ${'─'.repeat(50)}`)

    // 同時對所有網址發送請求
    const pulsePromises = SHORT_CODES.map(async (shortCode) => {
      const url = `${BASE_URL}/s/${shortCode}`
      const result = await runPulse(url, shortCode, connections, pulse)
      return result
    })

    const results = await Promise.all(pulsePromises)

    // 顯示結果
    results.forEach(result => {
      const status = result.errors === 0 ? '✅' : '❌'
      console.log(
        `  │ ${result.shortCode.padEnd(8)} │ ` +
        `請求: ${String(result.requests).padStart(4)} │ ` +
        `延遲: ${String(result.latency.avg.toFixed(0)).padStart(4)}ms │ ` +
        `P99: ${String(result.latency.p99).padStart(4)}ms │ ` +
        `${status} │`
      )
      stageResults.get(result.shortCode)!.push(result)
    })

    // 等待下一波（除了最後一波）
    if (pulse < PULSES_PER_STAGE) {
      await new Promise(resolve => setTimeout(resolve, (PULSE_INTERVAL - PULSE_DURATION) * 1000))
    }
  }

  // 計算階段總結
  const summaries: StageResult[] = []

  console.log(`\n${'─'.repeat(70)}`)
  console.log(`📈 階段 ${stageNum} 總結:`)
  console.log('─'.repeat(70))
  console.log(
    `  │ ${'網址'.padEnd(8)} │ ` +
    `${'總請求'.padStart(6)} │ ` +
    `${'平均延遲'.padStart(8)} │ ` +
    `${'P50'.padStart(6)} │ ` +
    `${'P99'.padStart(6)} │ ` +
    `${'錯誤'.padStart(4)} │`
  )
  console.log(`  ${'├' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(6) + '┤'}`)

  for (const [shortCode, pulses] of stageResults) {
    const totalRequests = pulses.reduce((sum, p) => sum + p.requests, 0)
    const avgLatency = pulses.reduce((sum, p) => sum + p.latency.avg, 0) / pulses.length
    const p50Latency = pulses.reduce((sum, p) => sum + p.latency.p50, 0) / pulses.length
    const p99Latency = Math.max(...pulses.map(p => p.latency.p99))
    const totalErrors = pulses.reduce((sum, p) => sum + p.errors + p.timeouts, 0)
    const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0

    console.log(
      `  │ ${shortCode.padEnd(8)} │ ` +
      `${String(totalRequests).padStart(6)} │ ` +
      `${avgLatency.toFixed(1).padStart(6)}ms │ ` +
      `${p50Latency.toFixed(0).padStart(4)}ms │ ` +
      `${String(p99Latency).padStart(4)}ms │ ` +
      `${String(totalErrors).padStart(4)} │`
    )

    summaries.push({
      stage: stageNum,
      connections,
      shortCode,
      pulses,
      summary: {
        totalRequests,
        avgLatency,
        p50Latency,
        p99Latency,
        totalErrors,
        errorRate,
      },
    })
  }
  console.log('─'.repeat(70))

  return summaries
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║           短網址系統壓力測試 - 多網址脈衝模式                          ║
║                                                                      ║
║  基於 ISO/IEC 25010 性能效率標準                                      ║
╚══════════════════════════════════════════════════════════════════════╝

🔧 設定:
   目標網址:`)
  SHORT_CODES.forEach((code, i) => {
    console.log(`     ${i + 1}. ${BASE_URL}/s/${code}`)
  })
  console.log(`
   測試模式:    脈衝式（每 ${PULSE_INTERVAL} 秒一波，每波 ${PULSE_DURATION} 秒）
   每階段波數:  ${PULSES_PER_STAGE} 波（共 ${PULSE_INTERVAL * PULSES_PER_STAGE} 秒）
   並發階段:    ${STAGES.join(' → ')}

📋 SLO 目標:
   P99 延遲:    < ${SLO.latencyP99} ms
   錯誤率:      < ${(SLO.errorRate * 100).toFixed(2)}%
`)

  // 確保報告目錄存在
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const allResults: StageResult[] = []

  // 執行各階段測試
  for (let i = 0; i < STAGES.length; i++) {
    const connections = STAGES[i]
    const stageResults = await runStage(connections, i + 1)
    allResults.push(...stageResults)

    // 階段間休息
    if (i < STAGES.length - 1) {
      console.log('\n⏳ 休息 5 秒後進入下一階段...')
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }

  // 生成比較報告
  const reportTime = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `pulse-test-${reportTime}.json`)

  // 按網址分組統計
  const urlSummaries: Record<string, {
    totalRequests: number
    totalErrors: number
    avgLatency: number
    maxP99: number
    stageResults: StageResult[]
  }> = {}

  SHORT_CODES.forEach(code => {
    const codeResults = allResults.filter(r => r.shortCode === code)
    const totalRequests = codeResults.reduce((sum, r) => sum + r.summary.totalRequests, 0)
    const totalErrors = codeResults.reduce((sum, r) => sum + r.summary.totalErrors, 0)
    const avgLatency = codeResults.reduce((sum, r) => sum + r.summary.avgLatency, 0) / codeResults.length
    const maxP99 = Math.max(...codeResults.map(r => r.summary.p99Latency))

    urlSummaries[code] = {
      totalRequests,
      totalErrors,
      avgLatency,
      maxP99,
      stageResults: codeResults,
    }
  })

  const report = {
    testInfo: {
      timestamp: new Date().toISOString(),
      mode: 'pulse',
      baseUrl: BASE_URL,
      shortCodes: SHORT_CODES,
      pulseInterval: PULSE_INTERVAL,
      pulseDuration: PULSE_DURATION,
      pulsesPerStage: PULSES_PER_STAGE,
      stages: STAGES,
      sloTargets: SLO,
    },
    urlSummaries,
    comparison: generateComparison(urlSummaries),
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

  // 最終摘要
  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                           測試完成                                    ║
╚══════════════════════════════════════════════════════════════════════╝

📊 網址比較:
${'─'.repeat(70)}
  │ ${'網址'.padEnd(10)} │ ${'總請求'.padStart(8)} │ ${'錯誤'.padStart(6)} │ ${'平均延遲'.padStart(10)} │ ${'最高P99'.padStart(10)} │
  ${'├' + '─'.repeat(12) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(12) + '┤'}`)

  Object.entries(urlSummaries).forEach(([code, summary]) => {
    const p99Status = summary.maxP99 <= SLO.latencyP99 ? '✅' : '❌'
    const errorStatus = summary.totalErrors === 0 ? '✅' : '❌'
    console.log(
      `  │ ${code.padEnd(10)} │ ` +
      `${String(summary.totalRequests).padStart(8)} │ ` +
      `${String(summary.totalErrors).padStart(4)}${errorStatus} │ ` +
      `${summary.avgLatency.toFixed(1).padStart(8)}ms │ ` +
      `${String(summary.maxP99).padStart(8)}ms${p99Status} │`
    )
  })
  console.log('─'.repeat(70))

  // 比較結論
  const comparison = report.comparison
  console.log(`
🏆 結論:
   ${comparison.summary}

📁 報告已保存: ${reportPath}
`)

  // 檢查是否所有 SLO 都達標
  const allPassed = Object.values(urlSummaries).every(
    s => s.totalErrors === 0 && s.maxP99 <= SLO.latencyP99
  )
  process.exit(allPassed ? 0 : 1)
}

function generateComparison(summaries: Record<string, {
  totalRequests: number
  totalErrors: number
  avgLatency: number
  maxP99: number
}>): { winner: string | null; latencyDiff: string; summary: string } {
  const codes = Object.keys(summaries)

  if (codes.length < 2) {
    return {
      winner: codes[0] || null,
      latencyDiff: 'N/A',
      summary: '單一網址測試完成',
    }
  }

  // 找出最佳表現者（以平均延遲為準）
  let bestCode = codes[0]
  let bestLatency = summaries[codes[0]].avgLatency

  codes.forEach(code => {
    if (summaries[code].avgLatency < bestLatency) {
      bestLatency = summaries[code].avgLatency
      bestCode = code
    }
  })

  // 計算差異
  const latencies = codes.map(code => summaries[code].avgLatency)
  const maxLatency = Math.max(...latencies)
  const minLatency = Math.min(...latencies)
  const diff = ((maxLatency - minLatency) / minLatency * 100).toFixed(1)

  // 生成總結
  let summary: string
  if (parseFloat(diff) < 10) {
    summary = `兩個短網址效能相近（差異 ${diff}%），系統穩定`
  } else {
    summary = `${bestCode} 效能較佳（快 ${diff}%）`
  }

  // 檢查錯誤
  const hasErrors = codes.some(code => summaries[code].totalErrors > 0)
  if (hasErrors) {
    summary += '，但存在錯誤需關注'
  }

  return {
    winner: bestCode,
    latencyDiff: `${diff}%`,
    summary,
  }
}

main().catch(console.error)
