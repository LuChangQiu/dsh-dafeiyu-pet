/**
 * v48 team / goal / plan / userQuestions 只读 v2 字段映射（task-57）。
 *
 * 数据来源：DSH `sessionProjections.snapshot(session, ['agentTeam','goal','plan','userQuestions'])`
 * （agentTeam 投影自带 members/tasks/failure；goal/plan 为布尔/阶段；userQuestions 含 active/settled）。
 *
 * 隐私红线：**只推计数/状态枚举/时间**，绝不推 subject/description/objective/问题文本/cwd/writeScopes。
 * 降级：服务或单元缺失 → 对应字段 null + degraded 列表说明；异常不崩（调用方 try/catch 保证）。
 *
 * 纯函数、无依赖：`lib/index.js` 与 `scripts/test-team-view.mjs` 共用。
 */

/**
 * @param {object} args
 * @param {object|null} args.values snapshot().values（可能缺 key）
 * @param {{teams?:boolean}} args.services 服务探测（agentTeams 是否装载）
 * @param {number} args.sentCount 已发出的「等你选」问题数（插件累计）
 * @param {number|string} [args.now] 更新时间
 * @returns {{team:object|null,goal:object|null,plan:object|null,userQuestions:object|null,degraded:string[],updatedAt:string}}
 */
export function buildTeamV2({ values, services, sentCount = 0, now = Date.now() } = {}) {
  const v = values || {}
  const svc = services || {}
  const degraded = []
  const updatedAt = new Date(Number(now) || Date.now()).toISOString()

  // ---- team（agentTeam 投影；未启用/未装载 → null + degraded）
  let team = null
  const at = v.agentTeam
  if (at === undefined) {
    degraded.push(svc.teams === false ? 'team:unsupported' : 'team:not-registered')
  } else if (at && Array.isArray(at.members) && Array.isArray(at.tasks)) {
    const members = at.members.filter((m) => m && m.role === 'teammate')
    const tasks = at.tasks
    const count = (s) => tasks.filter((x) => x && x.status === s).length
    const total = tasks.length
    const completed = count('completed')
    const pending = count('pending')
    const ready = tasks.filter((x) => x && x.ready === true).length
    const failed = at.failure !== undefined && at.failure !== null
    team = {
      enabled: members.length > 0 || total > 0,
      status: failed ? 'degraded' : members.length > 0 || total > 0 ? 'ok' : 'empty',
      members: {
        total: members.length,
        active: members.filter((m) => m.phase === 'active').length,
        failed: members.filter((m) => m.phase === 'failed').length
      },
      tasks: {
        total,
        pending,
        in_progress: count('in_progress'),
        completed,
        blocked: Math.max(0, pending - ready),
        ready,
        // 无任务时 progress=null（不能把"没任务"显示成 0%）
        progress: total > 0 ? Math.round((completed / total) * 1000) / 1000 : null
      },
      updatedAt
    }
    if (failed) degraded.push('team:degraded')
  } else {
    degraded.push('team:invalid')
  }

  // ---- goal（goal 投影：{goal:{phase,...}, roundsStarted?}）
  let goal = null
  const gp = v.goal
  if (gp === undefined) degraded.push('goal:not-registered')
  else if (gp && gp.goal) {
    goal = {
      active: gp.goal.phase === 'active' || gp.goal.phase === 'paused',
      operation: gp.operation ?? null,
      status: gp.goal.phase ?? null,
      roundsStarted: Number(gp.roundsStarted) || 0
    }
  } else if (gp && typeof gp === 'object') {
    goal = {
      active: false,
      operation: gp.operation ?? null,
      status: null,
      roundsStarted: Number(gp.roundsStarted) || 0
    }
  } else degraded.push('goal:invalid')

  // ---- plan（{active,pending}）
  let plan = null
  const pp = v.plan
  if (pp === undefined) degraded.push('plan:not-registered')
  else if (pp && typeof pp === 'object' && !Array.isArray(pp))
    plan = { active: pp.active === true, pending: pp.pending === true }
  else degraded.push('plan:invalid')

  // ---- userQuestions（{active:[...],settled:[...]}；sentCount=插件累计提问数）
  let userQuestions = null
  const uq = v.userQuestions
  if (uq === undefined) degraded.push('userQuestions:not-registered')
  else if (uq && typeof uq === 'object' && !Array.isArray(uq))
    userQuestions = {
      active: Array.isArray(uq.active) ? uq.active.length : 0,
      sentCount: Math.max(0, Number(sentCount) || 0)
    }
  else degraded.push('userQuestions:invalid')

  return { team, goal, plan, userQuestions, degraded, updatedAt }
}

/** 空态（尚未拿到投影时的初始值）。 */
export function emptyTeamV2(reason = 'not-refreshed') {
  return {
    team: null,
    goal: null,
    plan: null,
    userQuestions: null,
    degraded: [String(reason)],
    updatedAt: null
  }
}
