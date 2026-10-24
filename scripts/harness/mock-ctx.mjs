/**
 * task-76：隔离验证 harness 的 mock 层（DSH 不挂载也能测插件）。
 * 只模拟插件实际用到的 cordis 能力：ctx.on / ctx.get / ctx.effect，外加测试用的 _emit/_dispose。
 * 不依赖 DSH 宿主，可独立 `node` 运行。
 */

export function createMockCtx(services = {}) {
  const handlers = new Map()
  const effects = []
  const ctx = {
    services,
    get(name) {
      return services[name] == null ? null : services[name]
    },
    on(event, cb) {
      if (typeof cb !== 'function') return () => {}
      if (!handlers.has(event)) handlers.set(event, [])
      handlers.get(event).push(cb)
      return () => {
        const arr = handlers.get(event)
        if (!arr) return
        const i = arr.indexOf(cb)
        if (i >= 0) arr.splice(i, 1)
      }
    },
    effect(fn) {
      effects.push(fn)
      return () => {
        try {
          fn()
        } catch {}
      }
    },
    /** 同步派发插件事件（等价 cordis 的 session/event）。 */
    _emit(event, ...args) {
      for (const cb of handlers.get(event) || []) cb(...args)
    },
    _count(event) {
      return (handlers.get(event) || []).length
    },
    /** 模拟插件卸载：执行 ctx.effect 注册的 dispose（停止定时器/flush 写盘）。 */
    _dispose() {
      for (const fn of effects.splice(0)) {
        try {
          const ret = fn()
          if (typeof ret === 'function') ret()
        } catch (e) {
          throw new Error('dispose threw: ' + String((e && e.message) || e))
        }
      }
      handlers.clear()
    }
  }
  return ctx
}

/** mock 服务：插件通过 ctx.get(...) 探测的宿主能力。 */
export function createMockServices(overrides = {}) {
  const base = {
    llm: null,
    sessionProjections: {
      snapshot() {
        return {
          asOfSeq: 1,
          values: {
            agentTeam: {
              members: [
                { name: 'lead', role: 'lead' },
                { name: 'w1', role: 'teammate' }
              ],
              tasks: [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending', ready: true }]
            },
            goal: { active: true, phase: 'active', roundsStarted: 2 },
            plan: { active: true, pending: 1 },
            userQuestions: { active: 1 }
          }
        }
      }
    },
    agentTeams: {},
    sessions: {
      get() {
        return null
      },
      list() {
        return []
      }
    }
  }
  return { ...base, ...overrides }
}

/** mock Session（插件只读 id/header.cwd/header.delegationDepth/title）。 */
export function mockSession(id, { cwd = 'C:/harness/workspace', delegationDepth, title } = {}) {
  return {
    id,
    header: { cwd, ...(delegationDepth ? { delegationDepth } : {}) },
    title: title || 'harness-' + String(id).slice(-8)
  }
}

/** mock SessionEvent。 */
export function mockEvent(type, data = {}) {
  return { type, data }
}
