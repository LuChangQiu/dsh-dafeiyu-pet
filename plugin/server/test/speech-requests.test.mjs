// speech-requests（pet→plugin 文件队列）纯逻辑测试
import assert from 'node:assert/strict'
import {
  SPEECH_KIND_MAP,
  CONTEXT_KEYS,
  sanitizeContext,
  parseSpeechRequests,
  selectNewRequests,
  kindToLlmKind,
  contextPrompt,
  buildSayLine
} from '../lib/speech-requests.js'

let pass = 0
let fail = 0
const run = (name, fn) => {
  try {
    fn()
    pass++
  } catch (err) {
    fail++
    console.error(`FAIL ${name}: ${err.message}`)
  }
}

run('kind mapping covers pet-visible events', () => {
  for (const k of [
    'click',
    'doubleClick',
    'praise',
    'pat',
    'feed',
    'come',
    'sneakCaught',
    'report',
    'approvalWait',
    'greet',
    'sleep',
    'inner',
    'selfTalk'
  ])
    assert.ok(SPEECH_KIND_MAP[k], `missing kind ${k}`)
  assert.equal(kindToLlmKind('click'), 'clickLine')
  assert.equal(kindToLlmKind('unknown-kind'), null)
  assert.equal(kindToLlmKind(''), null)
})

run('sanitizeContext: only whitelist enum/number/bool; no user text/paths', () => {
  const out = sanitizeContext({
    phase: 'click',
    mood: 3,
    night: true,
    count: 2,
    mode: 'active',
    userText: '用户的原话秘密',
    path: 'C:\\Users\\secret',
    longText: 'x'.repeat(100),
    bad: { nested: 1 },
    unknown: 'ok'
  })
  assert.deepEqual(out, { phase: 'click', mood: 3, night: true, count: 2, mode: 'active' })
  for (const k of Object.keys(out)) assert.ok(CONTEXT_KEYS.includes(k))
  assert.equal(JSON.stringify(out).includes('秘密'), false)
})

run('sanitizeContext caps keys and drops non-object', () => {
  assert.deepEqual(sanitizeContext(null), {})
  assert.deepEqual(sanitizeContext('text'), {})
  const many = {}
  for (const k of CONTEXT_KEYS) many[k] = 1
  assert.ok(Object.keys(sanitizeContext(many)).length <= 12)
})

run('parseSpeechRequests: valid / invalid / bad entries / maxItems', () => {
  const valid = parseSpeechRequests(
    JSON.stringify([
      { id: 'a', kind: 'click', context: { mood: 1 }, at: '2026-10-26T10:00:00+08:00' },
      { id: '', kind: 'click' },
      { id: 'b', kind: 'praise', context: { userText: 'secret' } },
      'junk'
    ])
  )
  assert.equal(valid.invalid, false)
  assert.equal(valid.requests.length, 2)
  assert.deepEqual(valid.requests[0].context, { mood: 1 })
  assert.deepEqual(valid.requests[1].context, {})
  assert.equal(JSON.stringify(valid.requests).includes('secret'), false)

  assert.equal(parseSpeechRequests('{oops').invalid, true)
  assert.deepEqual(parseSpeechRequests('{"a":1}').requests, [])
  const trimmed = parseSpeechRequests(
    JSON.stringify(Array.from({ length: 60 }, (_, i) => ({ id: 'i' + i, kind: 'click' }))),
    { maxItems: 10 }
  )
  assert.equal(trimmed.requests.length, 10)
})

run('selectNewRequests dedupe + maxPerTick', () => {
  const list = [
    { id: '1', kind: 'click' },
    { id: '2', kind: 'praise' },
    { id: '3', kind: 'feed' }
  ]
  const seen = new Set(['2'])
  const first = selectNewRequests(list, seen, { maxPerTick: 1 })
  assert.deepEqual(
    first.fresh.map((x) => x.id),
    ['1']
  )
  const second = selectNewRequests(list, new Set([...seen, '1']), { maxPerTick: 5 })
  assert.deepEqual(
    second.fresh.map((x) => x.id),
    ['3']
  )
})

run('contextPrompt only safe, buildSayLine sanitizes newlines', () => {
  assert.equal(contextPrompt({ mood: 2, phase: 'click', userText: '秘密' }), 'phase=click mood=2')
  assert.equal(contextPrompt({}), '')
  assert.equal(buildSayLine('第一行\n第二行'), 'say:第一行 第二行')
})

console.log(`speech-requests tests: ${pass}/${pass + fail} pass`)
if (fail) process.exit(1)
