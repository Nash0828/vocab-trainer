// 用户名内容安全审核（腾讯云天御·内容安全平台 TMS）
// 配置见 server/config.cjs（该文件不提交 Git）
const tencentcloud = require('tencentcloud-sdk-nodejs-tms')
const TmsClient = tencentcloud.tms.v20201229.Client

const BIZ_TYPE = 'nickname_input' // 控制台策略 Biztype：昵称审核
const TTL = 24 * 3600 * 1000

let cfg = {}
try {
  cfg = require('./config.cjs')
} catch (e) {
  console.error('[moderation] config load fail:', e.message)
}

let client = null
function getClient() {
  if (!client && cfg.TENCENT_SECRET_ID && cfg.TENCENT_SECRET_KEY) {
    client = new TmsClient({
      credential: { secretId: cfg.TENCENT_SECRET_ID, secretKey: cfg.TENCENT_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'tms.tencentcloudapi.com', reqTimeout: 2 } },
    })
  }
  return client
}

const cache = new Map()
const MAX_CACHE = 2000

/**
 * 审核用户名
 * @returns {'pass'|'review'|'block'}
 */
async function moderateUsername(name) {
  const key = String(name || '').trim()
  if (!key) return 'pass'

  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.verdict

  const c = getClient()
  if (!c) return 'pass' // 未配置密钥时不阻塞注册

  try {
    const res = await Promise.race([
      c.TextModeration({
        Content: Buffer.from(key, 'utf8').toString('base64'),
        BizType: BIZ_TYPE,
        Type: 'TEXT',
        SourceLanguage: 'zh',
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout 2s')), 2000)),
    ])
    const suggestion = res && res.Suggestion
    const verdict = suggestion === 'Block' ? 'block' : suggestion === 'Review' ? 'review' : 'pass'
    if (cache.size >= MAX_CACHE) cache.clear()
    cache.set(key, { verdict, at: Date.now() })
    if (verdict !== 'pass') {
      console.log(`[moderation] ${key} -> ${verdict} label=${res.Label || ''} score=${res.Score || 0}`)
    }
    return verdict
  } catch (e) {
    console.error('[moderation] 调用失败，降级放行:', e.message)
    return 'pass'
  }
}

module.exports = { moderateUsername }
