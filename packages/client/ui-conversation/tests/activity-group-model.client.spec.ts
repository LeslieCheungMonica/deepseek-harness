import { describe, expect, it } from 'vitest'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { flowClassSignal, groupActivity, isInFlight } from '../src/client/chat/activity-group-model.ts'

/** Minimal node stand-in: the grouping pass reads only kind and its payload. */
function node(key: string, kind: string, data: unknown): ChatConversationViewNode {
  return {
    key,
    id: key,
    target: 'chat',
    anchorSeq: 0,
    location: { kind: 'session' },
    visibility: 'visible',
    kind,
    data,
  } as unknown as ChatConversationViewNode
}

function step(status: string, blocks: readonly unknown[]): unknown {
  return { status, turn: 1, step: 1, blocks, time: 0 }
}

const think = (text = 'weigh the options'): unknown => step('settled', [{ kind: 'reasoning', text }])
const thinking = (): unknown => step('running', [{ kind: 'reasoning', text: 'arriving' }])
const answer = (): unknown => step('settled', [
  { kind: 'reasoning', text: 'settle on the fix' },
  { kind: 'text', text: 'Done.' },
])
const stoppedThink = (): unknown => step('interrupted', [{ kind: 'reasoning', text: 'cut short' }])
const headsOnly = (): unknown => step('settled', [{ kind: 'tool-call', block: {} }])
const call = (callId: string): unknown => ({ root: { kind: 'tool-result', callId, seq: 1, time: 0 } })
const runningCall = (callId: string): unknown => ({ root: { callId, name: 'Bash', argsRaw: '{}', turn: 1, step: 1, time: 0 } })

/** Ordered lookup over stand-in nodes, mirroring the runtime node store. */
function store(entries: readonly [string, ChatConversationViewNode][]): { get(key: string): ChatConversationViewNode | undefined } {
  const map = new Map(entries)
  return { get: (key: string) => map.get(key) }
}

/** Members rendering their whole row. */
const whole = (...keys: readonly string[]): { readonly key: string }[] => keys.map(key => ({ key }))
/** A member contributing only its Think rows; its content follows the group. */
const thinkOf = (key: string): { readonly key: string; readonly reasoningOnly: true } => ({ key, reasoningOnly: true })

describe('groupActivity', () => {
  it('folds a run of Think-only steps and tool calls into one activity entry', () => {
    const entries = store([
      ['t1', node('t1', 'assistant-step', think())],
      ['c1', node('c1', 'tool-call', call('call-1'))],
      ['c2', node('c2', 'tool-call', call('call-2'))],
      ['t2', node('t2', 'assistant-step', think())],
    ])

    expect(groupActivity(['t1', 'c1', 'c2', 't2'], entries)).toEqual([
      {
        type: 'activity',
        key: 'group:t1',
        members: whole('t1', 'c1', 'c2', 't2'),
        thoughts: 2,
        calls: 2,
      },
    ])
  })

  it('folds the answer step’s Think row into the run and keeps the answer itself outside', () => {
    const entries = store([
      ['c1', node('c1', 'tool-call', call('call-1'))],
      ['c2', node('c2', 'tool-call', call('call-2'))],
      ['a1', node('a1', 'assistant-step', answer())],
      ['c3', node('c3', 'tool-call', call('call-3'))],
      ['c4', node('c4', 'tool-call', call('call-4'))],
    ])

    expect(groupActivity(['c1', 'c2', 'a1', 'c3', 'c4'], entries)).toEqual([
      {
        type: 'activity',
        key: 'group:c1',
        members: [...whole('c1', 'c2'), thinkOf('a1')],
        thoughts: 1,
        calls: 2,
      },
      { type: 'node', key: 'a1', omitReasoning: true },
      { type: 'activity', key: 'group:c3', members: whole('c3', 'c4'), thoughts: 0, calls: 2 },
    ])
  })

  it('keeps a step whole when it has no run to fold its Think row into', () => {
    const entries = store([
      ['u1', node('u1', 'user', {})],
      ['a1', node('a1', 'assistant-step', answer())],
    ])

    expect(groupActivity(['u1', 'a1'], entries)).toEqual([
      { type: 'node', key: 'u1' },
      { type: 'node', key: 'a1' },
    ])
  })

  it('leaves a lone activity row unfolded', () => {
    const entries = store([
      ['u1', node('u1', 'user', {})],
      ['t1', node('t1', 'assistant-step', think())],
    ])

    expect(groupActivity(['u1', 't1'], entries)).toEqual([
      { type: 'node', key: 'u1' },
      { type: 'node', key: 't1' },
    ])
  })

  it('rides a context injection row inside the run without counting it as work', () => {
    const entries = store([
      ['c1', node('c1', 'tool-call', call('call-1'))],
      ['x1', node('x1', 'context', {})],
      ['c2', node('c2', 'tool-call', call('call-2'))],
    ])

    expect(groupActivity(['c1', 'x1', 'c2'], entries)).toEqual([
      { type: 'activity', key: 'group:c1', members: whole('c1', 'x1', 'c2'), thoughts: 0, calls: 2 },
    ])
  })

  it('leaves a lone context injection row as its own row', () => {
    const entries = store([
      ['u1', node('u1', 'user', {})],
      ['x1', node('x1', 'context', {})],
    ])

    expect(groupActivity(['u1', 'x1'], entries)).toEqual([
      { type: 'node', key: 'u1' },
      { type: 'node', key: 'x1' },
    ])
  })

  it('lets a tool-head-only step ride along without breaking the run or counting as a thought', () => {
    const entries = store([
      ['c1', node('c1', 'tool-call', call('call-1'))],
      ['h1', node('h1', 'assistant-step', headsOnly())],
      ['c2', node('c2', 'tool-call', call('call-2'))],
    ])

    expect(groupActivity(['c1', 'h1', 'c2'], entries)).toEqual([
      { type: 'activity', key: 'group:c1', members: whole('c1', 'h1', 'c2'), thoughts: 0, calls: 2 },
    ])
  })

  it('folds an interrupted step’s Think row while its stopped marker stays outside', () => {
    const entries = store([
      ['c1', node('c1', 'tool-call', call('call-1'))],
      ['s1', node('s1', 'assistant-step', stoppedThink())],
      ['c2', node('c2', 'tool-call', call('call-2'))],
    ])

    expect(groupActivity(['c1', 's1', 'c2'], entries)).toEqual([
      { type: 'activity', key: 'group:c1', members: [...whole('c1'), thinkOf('s1')], thoughts: 1, calls: 1 },
      { type: 'node', key: 's1', omitReasoning: true },
      { type: 'node', key: 'c2' },
    ])
  })

  it('counts a streaming Think step as a thought and keeps the run open', () => {
    const entries = store([
      ['t1', node('t1', 'assistant-step', thinking())],
      ['c1', node('c1', 'tool-call', call('call-1'))],
    ])

    expect(groupActivity(['t1', 'c1'], entries)).toEqual([
      { type: 'activity', key: 'group:t1', members: whole('t1', 'c1'), thoughts: 1, calls: 1 },
    ])
  })

  it('passes unknown node keys through as plain rows', () => {
    const entries = store([['c1', node('c1', 'tool-call', call('call-1'))]])

    expect(groupActivity(['missing', 'c1'], entries)).toEqual([
      { type: 'node', key: 'missing' },
      { type: 'node', key: 'c1' },
    ])
  })
})

describe('isInFlight', () => {
  it('reports a Tool root that has not settled yet', () => {
    expect(isInFlight(node('c1', 'tool-call', runningCall('call-1')))).toBe(true)
  })

  it('reports a settled Tool root as no longer in flight', () => {
    expect(isInFlight(node('c1', 'tool-call', call('call-1')))).toBe(false)
  })

  it('reports a streaming Think step as in flight', () => {
    expect(isInFlight(node('t1', 'assistant-step', thinking()))).toBe(true)
  })

  it('reports settled, interrupted, and unknown rows as not in flight', () => {
    expect(isInFlight(node('t1', 'assistant-step', think()))).toBe(false)
    expect(isInFlight(node('s1', 'assistant-step', stoppedThink()))).toBe(false)
    expect(isInFlight(undefined)).toBe(false)
  })
})

describe('flowClassSignal', () => {
  it('holds still while a running Think step keeps streaming reasoning', () => {
    const first = store([['t1', node('t1', 'assistant-step', step('running', [{ kind: 'reasoning', text: 'a' }]))]])
    const second = store([['t1', node('t1', 'assistant-step', step('running', [{ kind: 'reasoning', text: 'a b c' }]))]])

    expect(flowClassSignal(['t1'], second)).toBe(flowClassSignal(['t1'], first))
  })

  it('moves the moment a running Think step gains visible text', () => {
    const thinking = store([['t1', node('t1', 'assistant-step', step('running', [{ kind: 'reasoning', text: 'a' }]))]])
    const answering = store([['t1', node('t1', 'assistant-step', step('running', [
      { kind: 'reasoning', text: 'a' },
      { kind: 'text', text: 'Done.' },
    ]))]])

    expect(flowClassSignal(['t1'], answering)).not.toBe(flowClassSignal(['t1'], thinking))
  })

  it('ignores settled rows, which cannot change class', () => {
    const entries = store([
      ['t1', node('t1', 'assistant-step', think())],
      ['c1', node('c1', 'tool-call', call('call-1'))],
    ])

    expect(flowClassSignal(['t1', 'c1'], entries)).toBe('')
  })
})
