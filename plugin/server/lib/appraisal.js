// task-104 切片3：appraisal 评估层（纯函数；无 IO / 无 timer / 无随机）
// 契约：PERFORMANCE-CONTRACT §3（OCC 简化六维查表 + novelty 衰减）
// 输出仅情绪增量与六维评估，不直接产生动作（事件层禁止直连 act）

// 六维：goalCongruence(-1..1) / agency(self|user|env|team) / certainty(0..1)
//       novelty(0..1) / control(0..1) / social(-1..1)
// delta：{valence(-1..1), arousal(0..1), attention(0..1), trust(0..1)}
export const APPRAISAL_TABLE = Object.freeze({
  'turn/end:completed': {
    dims: { goalCongruence: 0.8, agency: 'self', certainty: 0.9, novelty: 0.2, control: 0.7, social: 0.2 },
    delta: { valence: 0.12, arousal: 0.05, attention: 0, trust: 0.001 }
  },
  'turn/end:aborted': {
    dims: { goalCongruence: 0.1, agency: 'user', certainty: 0.8, novelty: 0.1, control: 0.3, social: 0.1 },
    delta: { valence: -0.03, arousal: 0.05, attention: 0.1, trust: 0 }
  },
  'turn/end:error': {
    dims: { goalCongruence: -0.7, agency: 'env', certainty: 0.6, novelty: 0.2, control: 0.2, social: 0 },
    delta: { valence: -0.12, arousal: 0.1, attention: 0.2, trust: 0 }
  },
  'agent/request-error:error': {
    dims: { goalCongruence: -0.7, agency: 'env', certainty: 0.5, novelty: 0.2, control: 0.2, social: 0 },
    delta: { valence: -0.12, arousal: 0.1, attention: 0.2, trust: 0 }
  },
  'llm/retry:single': {
    dims: { goalCongruence: 0, agency: 'env', certainty: 0.3, novelty: 0.1, control: 0.4, social: 0 },
    delta: { valence: -0.02, arousal: 0.05, attention: 0.1, trust: 0 }
  },
  'llm/retry:escalate': {
    dims: { goalCongruence: -0.4, agency: 'env', certainty: 0.2, novelty: 0.2, control: 0.15, social: 0 },
    delta: { valence: -0.08, arousal: 0.1, attention: 0.15, trust: 0 }
  },
  'approval/asked': {
    dims: { goalCongruence: 0.2, agency: 'user', certainty: 0.4, novelty: 0.2, control: 0.3, social: 0.8 },
    delta: { valence: 0, arousal: 0.1, attention: 0.4, trust: 0 }
  },
  'approval/decided:allowed': {
    dims: { goalCongruence: 0.6, agency: 'user', certainty: 1, novelty: 0.1, control: 0.7, social: 0.5 },
    delta: { valence: 0.05, arousal: -0.05, attention: -0.1, trust: 0.002 }
  },
  'approval/decided:rejected': {
    dims: { goalCongruence: -0.3, agency: 'user', certainty: 1, novelty: 0.1, control: 0.3, social: -0.3 },
    delta: { valence: -0.08, arousal: 0.05, attention: -0.1, trust: 0 }
  },
  'user-questions/request': {
    dims: { goalCongruence: 0.2, agency: 'user', certainty: 0.4, novelty: 0.2, control: 0.3, social: 0.8 },
    delta: { valence: 0, arousal: 0.08, attention: 0.4, trust: 0 }
  },
  'userQuestions:settled': {
    dims: { goalCongruence: 0.5, agency: 'user', certainty: 0.9, novelty: 0.1, control: 0.6, social: 0.5 },
    delta: { valence: 0.05, arousal: -0.05, attention: -0.1, trust: 0.002 }
  },
  'compaction/start': {
    dims: { goalCongruence: 0.2, agency: 'self', certainty: 0.6, novelty: 0.1, control: 0.7, social: 0 },
    delta: { valence: 0, arousal: 0.05, attention: 0.2, trust: 0 }
  },
  'compaction/end:success': {
    dims: { goalCongruence: 0.5, agency: 'self', certainty: 0.9, novelty: 0.1, control: 0.8, social: 0 },
    delta: { valence: 0.03, arousal: -0.05, attention: 0, trust: 0 }
  },
  'job/settled:completed': {
    dims: { goalCongruence: 0.6, agency: 'self', certainty: 0.9, novelty: 0.2, control: 0.7, social: 0.1 },
    delta: { valence: 0.04, arousal: 0, attention: 0, trust: 0.001 }
  },
  'job/settled:failed': {
    dims: { goalCongruence: -0.4, agency: 'env', certainty: 0.7, novelty: 0.2, control: 0.3, social: 0 },
    delta: { valence: -0.06, arousal: 0.05, attention: 0.05, trust: 0 }
  },
  'model/selection': {
    dims: { goalCongruence: 0.2, agency: 'user', certainty: 0.7, novelty: 0.6, control: 0.5, social: 0 },
    delta: { valence: 0.02, arousal: 0.05, attention: 0.1, trust: 0 }
  },
  'goal/change:complete': {
    dims: { goalCongruence: 1, agency: 'self', certainty: 1, novelty: 0.5, control: 0.8, social: 0.6 },
    delta: { valence: 0.2, arousal: 0.15, attention: 0.2, trust: 0.003 }
  },
  'goal/change:block': {
    dims: { goalCongruence: -0.6, agency: 'env', certainty: 0.6, novelty: 0.2, control: 0.3, social: 0.2 },
    delta: { valence: -0.1, arousal: 0.05, attention: 0.15, trust: 0 }
  },
  'plan/mode:active': {
    dims: { goalCongruence: 0.3, agency: 'user', certainty: 0.7, novelty: 0.3, control: 0.6, social: 0.2 },
    delta: { valence: 0.02, arousal: 0.05, attention: 0.05, trust: 0 }
  },
  'team/task:completed': {
    dims: { goalCongruence: 0.9, agency: 'team', certainty: 0.9, novelty: 0.4, control: 0.7, social: 0.8 },
    delta: { valence: 0.15, arousal: 0.1, attention: 0.1, trust: 0.002 }
  },
  'team/task:blocked': {
    dims: { goalCongruence: -0.4, agency: 'team', certainty: 0.5, novelty: 0.2, control: 0.3, social: 0.4 },
    delta: { valence: -0.05, arousal: 0.05, attention: 0.05, trust: 0 }
  },
  'interaction:pat': {
    dims: { goalCongruence: 0.5, agency: 'user', certainty: 1, novelty: 0.4, control: 0.8, social: 1 },
    delta: { valence: 0.15, arousal: 0.1, attention: 0.5, trust: 0.003 }
  },
  'interaction:feed': {
    dims: { goalCongruence: 0.6, agency: 'user', certainty: 1, novelty: 0.3, control: 0.9, social: 0.9 },
    delta: { valence: 0.12, arousal: 0.05, attention: 0.4, trust: 0.002 }
  },
  'interaction:praise': {
    dims: { goalCongruence: 0.7, agency: 'user', certainty: 1, novelty: 0.5, control: 0.7, social: 1 },
    delta: { valence: 0.18, arousal: 0.1, attention: 0.4, trust: 0.004 }
  },
  'interaction:come': {
    dims: { goalCongruence: 0.5, agency: 'user', certainty: 1, novelty: 0.3, control: 0.9, social: 0.9 },
    delta: { valence: 0.06, arousal: 0.08, attention: 0.6, trust: 0.001 }
  },
  'interaction:ignored': {
    dims: { goalCongruence: -0.2, agency: 'user', certainty: 0.6, novelty: 0.1, control: 0.2, social: -0.6 },
    delta: { valence: -0.05, arousal: -0.02, attention: -0.2, trust: 0 }
  },
  'interaction:rejected': {
    dims: { goalCongruence: -0.5, agency: 'user', certainty: 0.9, novelty: 0.1, control: 0.2, social: -0.9 },
    delta: { valence: -0.1, arousal: 0.02, attention: -0.3, trust: 0 }
  },
  'environment:night': {
    dims: { goalCongruence: 0, agency: 'env', certainty: 1, novelty: 0.1, control: 0.4, social: 0 },
    delta: { valence: 0, arousal: -0.05, attention: -0.2, trust: 0 }
  },
  'environment:reunion': {
    dims: { goalCongruence: 0.9, agency: 'user', certainty: 1, novelty: 0.8, control: 0.7, social: 1 },
    delta: { valence: 0.25, arousal: 0.2, attention: 0.5, trust: 0.005 }
  },
  'self:failure': {
    dims: { goalCongruence: -0.2, agency: 'self', certainty: 0.8, novelty: 0.3, control: 0.2, social: 0 },
    delta: { valence: -0.05, arousal: 0.05, attention: 0, trust: 0 }
  },
  default: {
    dims: { goalCongruence: 0, agency: 'env', certainty: 0.5, novelty: 0.3, control: 0.5, social: 0 },
    delta: { valence: 0, arousal: 0, attention: 0, trust: 0 }
  }
})

const ERROR_CATEGORY_DELTA = {
  rate_limit: { valence: -0.1, arousal: 0.1, attention: 0.2, trust: 0 },
  auth: { valence: -0.1, arousal: 0.1, attention: 0.2, trust: 0 },
  timeout: { valence: -0.15, arousal: 0.1, attention: 0.2, trust: 0 },
  context: { valence: -0.12, arousal: 0.1, attention: 0.2, trust: 0 },
  max_tokens: { valence: -0.1, arousal: 0.1, attention: 0.2, trust: 0 },
  unknown: { valence: -0.1, arousal: 0.1, attention: 0.2, trust: 0 }
}

export const noveltyFactor = (countThisSession = 1) => {
  const n = Math.max(1, Number(countThisSession) || 1)
  return Math.max(0.3, Math.pow(0.85, n - 1))
}

const kindOfReason = (event) => {
  const d = event.data || {}
  const r = (d.reason && d.reason.kind) || d.reasonKind || d.status || (d.result && d.result.kind) || ''
  return String(r || '')
}

export function classifyAppraisalEvent(event, opts = {}) {
  const t = String((event && event.t) || '')
  const d = (event && event.data) || {}
  if (t === 'turn/end') {
    const k = kindOfReason(event)
    if (k === 'completed') return 'turn/end:completed'
    if (k === 'aborted') return 'turn/end:aborted'
    return 'turn/end:error'
  }
  if (t === 'agent/request-error' || t === 'agent/error') return 'agent/request-error:error'
  if (t === 'llm/retry')
    return (opts.retryStreak || 0) >= 3 || d.escalated === true ? 'llm/retry:escalate' : 'llm/retry:single'
  if (t === 'approval/asked') return 'approval/asked'
  if (t === 'approval/decided') {
    const outcome = String(d.outcome || d.decision || d.status || (d.allowed === false ? 'rejected' : 'allowed'))
    return outcome.toLowerCase().includes('reject') ? 'approval/decided:rejected' : 'approval/decided:allowed'
  }
  if (t === 'user-questions/request' || t === 'userQuestions/request') return 'user-questions/request'
  if (t === 'userQuestions.settled' || t === 'userQuestions/settled') return 'userQuestions:settled'
  if (t === 'compaction/start') return 'compaction/start'
  if (t === 'compaction/end') return d.error || d.status === 'error' ? 'turn/end:error' : 'compaction/end:success'
  if (t === 'job/settled')
    return String(d.status || d.result || 'completed')
      .toLowerCase()
      .includes('fail') || String(d.status || '') === 'failed'
      ? 'job/settled:failed'
      : 'job/settled:completed'
  if (t === 'model/selection' || t === 'request/context') return 'model/selection'
  if (t === 'goal/change') {
    const s = String(d.status || d.operation || d.kind || '')
    return /block|fail|error/i.test(s) ? 'goal/change:block' : 'goal/change:complete'
  }
  if (t === 'plan/mode') return 'plan/mode:active'
  if (t === 'team/task') {
    const s = String(d.status || d.kind || '')
    return /block|fail|error/i.test(s) ? 'team/task:blocked' : 'team/task:completed'
  }
  if (t === 'environment/night' || t === 'timer/sleep') return 'environment:night'
  if (t === 'environment/reunion') return 'environment:reunion'
  if (t === 'self/failure') return 'self:failure'
  if (t === 'interaction' || t.startsWith('interaction:')) {
    const kind = t.includes(':') ? t.split(':')[1] : String(d.kind || d.action || '')
    if (['pat', 'feed', 'praise', 'come', 'ignored', 'rejected'].includes(kind)) return 'interaction:' + kind
  }
  return 'default'
}

export function appraise(event, opts = {}) {
  const key = classifyAppraisalEvent(event, opts)
  const row = APPRAISAL_TABLE[key] || APPRAISAL_TABLE.default
  const factor = noveltyFactor(opts.countThisSession)
  let delta = { ...row.delta }
  let category = null
  const rawCode =
    (event && event.data && event.data.failure && event.data.failure.code) ||
    (event && event.data && event.data.code) ||
    null
  if ((key === 'agent/request-error:error' || key === 'turn/end:error') && rawCode) {
    const code = String(rawCode).toLowerCase()
    category = ERROR_CATEGORY_DELTA[code] ? code : 'unknown'
    delta = { ...ERROR_CATEGORY_DELTA[category] }
  }
  const scaled = {}
  for (const [k, v] of Object.entries(delta)) scaled[k] = v * factor
  return {
    key,
    category,
    dimensions: { ...row.dims },
    novelty: factor,
    delta,
    scaledDelta: scaled,
    reason: key
  }
}

export function appraisalVersions() {
  return { tableVersion: 1, doc: 'PERFORMANCE-CONTRACT §3', noveltyFloor: 0.3 }
}
