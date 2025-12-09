/**
 * 尖峰測試腳本 (Spike Test)
 *
 * 目的：測試系統對突發大量請求的承受能力與恢復能力
 *
 * 測試模式：
 *   [正常負載 60s] → [尖峰 15s] → [正常 60s] → [尖峰 15s] → [正常 60s]
 *
 * 使用方式：
 *   npx tsx scripts/spike-test.ts [url] [shortCode]
 *
 * 範例：
 *   npx tsx scripts/spike-test.ts https://url.tzuchi.org xtmzlj
 */

import autocannon from 'autocannon'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 設定參數
const BASE_URL = process.argv[2] || 'https://url.tzuchi.org'
const SHORT_CODE = process.argv[3] || 'test'

// 尖峰測試配置
const CONFIG = {
  normalConnections: 20,      // 正常負載並發數
  spikeConnections: 300,      // 尖峰負載並發數（10-15 倍）
  normalDuration: 60,         // 正常負載持續時間（秒）
  spikeDuration: 15,          // 尖峰持續時間（秒）
  spikeCount: 3,              // 尖峰次數
}

// 報告目錄
const REPORT_DIR = path.join(__dirname, '../reports')

// SLO 目標
const SLO = {
  normalP99: 200,             // 正常負載 P99 < 200ms
  spikeP99: 2000,             // 尖峰時 P99 < 2000ms（允許較高延遲）
  spikeErrorRate: 0.05,       // 尖峰時錯誤率 < 5%
  recoveryTime: 10,           // 恢復時間 < 10 秒
}

interface PhaseResult {
  phase: number
  type: 'normal' | 'spike'
  connections: number
  duration: number
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
  rps: number
  timestamp: string
}

async function runPhase(
  url: string,
  connections: number,
  duration: number,
  phaseNum: number,
  type: 'normal' | 'spike'
): Promise<PhaseResult> {
  const result = await autocannon({
    url,
    connections,
    duration,
    maxRedirects: 0,
  })

  return {
    phase: phaseNum,
    type,
    connections,
    duration,
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
    rps: result.requests.total / duration,
    timestamp: new Date().toISOString(),
  }
}

async function runSpikeTest(): Promise<void> {
  const url = `${BASE_URL}/s/${SHORT_CODE}`

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                     尖峰測試 (Spike Test)                             ║
║                                                                      ║
║  目的：測試系統對突發流量的承受能力與恢復能力                           ║
╚══════════════════════════════════════════════════════════════════════╝

🔧 設定:
   目標網址:     ${url}
   正常負載:     ${CONFIG.normalConnections} 並發 × ${CONFIG.normalDuration} 秒
   尖峰負載:     ${CONFIG.spikeConnections} 並發 × ${CONFIG.spikeDuration} 秒
   尖峰次數:     ${CONFIG.spikeCount} 次
   負載倍數:     ${(CONFIG.spikeConnections / CONFIG.normalConnections).toFixed(0)}x

📋 SLO 目標:
   正常 P99:     < ${SLO.normalP99} ms
   尖峰 P99:     < ${SLO.spikeP99} ms
   尖峰錯誤率:   < ${(SLO.spikeErrorRate * 100).toFixed(1)}%

📈 測試模式:
`)

  // 視覺化測試模式
  let timeline = '   '
  for (let i = 0; i < CONFIG.spikeCount; i++) {
    timeline += `[正常 ${CONFIG.normalDuration}s]`
    timeline += ` → [尖峰 ${CONFIG.spikeDuration}s] → `
  }
  timeline += `[正常 ${CONFIG.normalDuration}s]`
  console.log(timeline)
  console.log('')

  // 確保報告目錄存在
  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const results: PhaseResult[] = []
  let phaseNum = 0

  // 計算總階段數
  const totalPhases = CONFIG.spikeCount * 2 + 1

  console.log('─'.repeat(70))
  console.log(`  │ ${'階段'.padEnd(4)} │ ${'類型'.padEnd(6)} │ ${'並發'.padStart(4)} │ ${'請求數'.padStart(8)} │ ${'平均延遲'.padStart(8)} │ ${'P99'.padStart(8)} │ ${'錯誤'.padStart(6)} │`)
  console.log(`  ${'├' + '─'.repeat(6) + '┼' + '─'.repeat(8) + '┼' + '─'.repeat(6) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(10) + '┼' + '─'.repeat(8) + '┤'}`)

  for (let spike = 0; spike <= CONFIG.spikeCount; spike++) {
    // 正常負載階段
    phaseNum++
    console.log(`\n⏱️  階段 ${phaseNum}/${totalPhases}: 正常負載 (${CONFIG.normalConnections} 並發)...`)

    const normalResult = await runPhase(
      url,
      CONFIG.normalConnections,
      CONFIG.normalDuration,
      phaseNum,
      'normal'
    )
    results.push(normalResult)

    const normalStatus = normalResult.latency.p99 < SLO.normalP99 ? '✅' : '⚠️'
    console.log(`  │ ${phaseNum.toString().padStart(4)} │ ${'正常'.padEnd(6)} │ ${CONFIG.normalConnections.toString().padStart(4)} │ ${normalResult.requests.toString().padStart(8)} │ ${normalResult.latency.avg.toFixed(1).padStart(6)}ms │ ${normalResult.latency.p99.toString().padStart(6)}ms │ ${normalResult.errors.toString().padStart(4)}${normalStatus} │`)

    // 如果還有尖峰要測試
    if (spike < CONFIG.spikeCount) {
      phaseNum++
      console.log(`\n🔥 階段 ${phaseNum}/${totalPhases}: 尖峰負載 (${CONFIG.spikeConnections} 並發)...`)

      const spikeResult = await runPhase(
        url,
        CONFIG.spikeConnections,
        CONFIG.spikeDuration,
        phaseNum,
        'spike'
      )
      results.push(spikeResult)

      const errorRate = spikeResult.requests > 0 ? spikeResult.errors / spikeResult.requests : 0
      const spikeP99Ok = spikeResult.latency.p99 < SLO.spikeP99
      const spikeErrorOk = errorRate < SLO.spikeErrorRate
      const spikeStatus = spikeP99Ok && spikeErrorOk ? '✅' : '❌'

      console.log(`  │ ${phaseNum.toString().padStart(4)} │ ${'🔥尖峰'.padEnd(5)} │ ${CONFIG.spikeConnections.toString().padStart(4)} │ ${spikeResult.requests.toString().padStart(8)} │ ${spikeResult.latency.avg.toFixed(1).padStart(6)}ms │ ${spikeResult.latency.p99.toString().padStart(6)}ms │ ${spikeResult.errors.toString().padStart(4)}${spikeStatus} │`)
    }
  }

  console.log('─'.repeat(70))

  // 分析結果
  const normalResults = results.filter(r => r.type === 'normal')
  const spikeResults = results.filter(r => r.type === 'spike')

  const normalAvgLatency = normalResults.reduce((sum, r) => sum + r.latency.avg, 0) / normalResults.length
  const normalMaxP99 = Math.max(...normalResults.map(r => r.latency.p99))
  const normalTotalErrors = normalResults.reduce((sum, r) => sum + r.errors, 0)

  const spikeAvgLatency = spikeResults.reduce((sum, r) => sum + r.latency.avg, 0) / spikeResults.length
  const spikeMaxP99 = Math.max(...spikeResults.map(r => r.latency.p99))
  const spikeTotalErrors = spikeResults.reduce((sum, r) => sum + r.errors, 0)
  const spikeTotalRequests = spikeResults.reduce((sum, r) => sum + r.requests, 0)
  const spikeErrorRate = spikeTotalRequests > 0 ? spikeTotalErrors / spikeTotalRequests : 0

  // 恢復能力分析
  const recoveryAnalysis: string[] = []
  for (let i = 0; i < results.length - 1; i++) {
    if (results[i].type === 'spike' && results[i + 1].type === 'normal') {
      const spikeLatency = results[i].latency.avg
      const normalLatency = results[i + 1].latency.avg
      const recovery = normalLatency < spikeLatency * 0.5 ? '快速恢復' : '恢復較慢'
      recoveryAnalysis.push(`尖峰 ${Math.floor(i / 2) + 1} 後: ${recovery} (${spikeLatency.toFixed(0)}ms → ${normalLatency.toFixed(0)}ms)`)
    }
  }

  // 驗證 SLO
  const normalP99Passed = normalMaxP99 < SLO.normalP99
  const spikeP99Passed = spikeMaxP99 < SLO.spikeP99
  const spikeErrorPassed = spikeErrorRate < SLO.spikeErrorRate
  const allPassed = normalP99Passed && spikeP99Passed && spikeErrorPassed

  console.log(`
╔══════════════════════════════════════════════════════════════════════╗
║                           測試結果                                    ║
╚══════════════════════════════════════════════════════════════════════╝

📊 正常負載統計:
   總階段數:     ${normalResults.length}
   平均延遲:     ${normalAvgLatency.toFixed(2)} ms
   最高 P99:     ${normalMaxP99} ms ${normalP99Passed ? '✅' : '❌'} (目標: < ${SLO.normalP99}ms)
   總錯誤數:     ${normalTotalErrors}

🔥 尖峰負載統計:
   總尖峰數:     ${spikeResults.length}
   平均延遲:     ${spikeAvgLatency.toFixed(2)} ms
   最高 P99:     ${spikeMaxP99} ms ${spikeP99Passed ? '✅' : '❌'} (目標: < ${SLO.spikeP99}ms)
   錯誤率:       ${(spikeErrorRate * 100).toFixed(2)}% ${spikeErrorPassed ? '✅' : '❌'} (目標: < ${(SLO.spikeErrorRate * 100).toFixed(1)}%)
   總錯誤數:     ${spikeTotalErrors}

🔄 恢復能力:
${recoveryAnalysis.map(r => `   ${r}`).join('\n')}

${'─'.repeat(70)}

${allPassed ? '✅ 所有 SLO 目標達成 - 系統能夠承受尖峰負載' : '❌ 部分 SLO 目標未達成 - 需要優化'}
`)

  // 生成報告
  const reportTime = new Date().toISOString().replace(/[:.]/g, '-')
  const reportPath = path.join(REPORT_DIR, `spike-test-${reportTime}.json`)

  const report = {
    testInfo: {
      type: 'spike',
      timestamp: new Date().toISOString(),
      url,
      shortCode: SHORT_CODE,
      config: CONFIG,
      sloTargets: SLO,
    },
    phases: results,
    summary: {
      normal: {
        phases: normalResults.length,
        avgLatency: normalAvgLatency,
        maxP99: normalMaxP99,
        totalErrors: normalTotalErrors,
      },
      spike: {
        phases: spikeResults.length,
        avgLatency: spikeAvgLatency,
        maxP99: spikeMaxP99,
        totalErrors: spikeTotalErrors,
        errorRate: spikeErrorRate,
      },
      recoveryAnalysis,
    },
    validation: {
      allPassed,
      normalP99Passed,
      spikeP99Passed,
      spikeErrorPassed,
    },
  }

  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
  console.log(`📁 報告已保存: ${reportPath}\n`)

  process.exit(allPassed ? 0 : 1)
}

runSpikeTest().catch(console.error)
