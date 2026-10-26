// @vitest-environment jsdom
// ActivityGroup presentation: a folded run of tool activity becomes one
// summary row, keeps its member rows MOUNTED while collapsed, and reveals
// only the in-flight member so a running turn stays readable without
// unfolding the run.
//
// Mounted-while-hidden is the contract under test, not an implementation
// detail: the chat view resolves its paging anchor and reader position by
// looking rows up in the DOM, so a group that unmounted its children would
// silently break position restore.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import { ActivityGroup, type ActivityMember } from '../src/client/chat/ActivityGroup.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)

/** Minimal node stand-in: the group reads only the newest member's liveness. */
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

const settledCall = (key: string): ChatConversationViewNode =>
  node(key, 'tool-call', { root: { kind: 'tool-result', callId: key, seq: 1, time: 0 } })
const runningCall = (key: string): ChatConversationViewNode =>
  node(key, 'tool-call', { root: { callId: key, name: 'Bash', argsRaw: '{}', turn: 1, step: 1, time: 0 } })

/** Session hook stub: the framework injection point, not the behavior under test. */
function sessionWith(nodes: readonly ChatConversationViewNode[]): ChatViewSlotProps['useSession'] {
  const byKey = new Map(nodes.map(entry => [entry.key, entry]))
  const snapshot = { chat: { nodes: { get: (key: string) => byKey.get(key) } } }
  return ((selector: (value: unknown) => unknown) => selector(snapshot)) as unknown as ChatViewSlotProps['useSession']
}

const members = (...keys: readonly string[]): readonly ActivityMember[] =>
  keys.map(key => ({ key, element: <span>{`row ${key}`}</span> as ReactNode }))

/** Render one group; expansion is the group's own state in production too. */
function renderGroup(nodes: readonly ChatConversationViewNode[], rows: readonly ActivityMember[], thoughts: number, calls: number) {
  return render(
    <ActivityGroup
      groupKey="group:c1"
      members={rows}
      thoughts={thoughts}
      calls={calls}
      useSession={sessionWith(nodes)}
      t={t}
    />,
  )
}

/** Members the reader can actually see, in flow order. */
function shownKeys(view: ReturnType<typeof render>): string[] {
  const container = view.container.querySelector<HTMLElement>('[data-activity-members]')
  if (container === null || container.hasAttribute('data-collapsed')) return []
  return [...container.querySelectorAll<HTMLElement>('[data-activity-member]')]
    .filter(element => !element.hasAttribute('hidden'))
    .map(element => element.dataset.activityMember ?? '')
}

/** Members still in the DOM, visible or not. */
function mountedKeys(view: ReturnType<typeof render>): string[] {
  return [...view.container.querySelectorAll<HTMLElement>('[data-activity-member]')]
    .map(element => element.dataset.activityMember ?? '')
}

describe('ActivityGroup', () => {
  it('folds a settled run into one summary row, hiding the members but keeping them mounted', () => {
    const view = renderGroup(
      [settledCall('c1'), settledCall('c2')],
      members('c1', 'c2'),
      1,
      2,
    )

    const header = view.getByRole('button')
    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(view.getByText('2 次工具调用 · 1 条思考')).toBeTruthy()
    expect(shownKeys(view)).toEqual([])
    expect(mountedKeys(view)).toEqual(['c1', 'c2'])
    expect(view.getByText('row c1')).toBeTruthy()
  })

  it('drops the thought count when the run has no Think row', () => {
    const view = renderGroup([settledCall('c1'), settledCall('c2')], members('c1', 'c2'), 0, 2)

    expect(view.getByText('2 次工具调用')).toBeTruthy()
  })

  it('counts one of each in the singular', () => {
    const english = makeTranslate(en, commonZh)
    const view = render(
      <ActivityGroup
        groupKey="group:c1"
        members={members('c1', 'c2')}
        thoughts={1}
        calls={1}
        useSession={sessionWith([settledCall('c1'), settledCall('c2')])}
        t={english}
      />,
    )

    expect(view.getByText('1 tool call · 1 thought')).toBeTruthy()
  })

  it('shows only the in-flight member while collapsed', () => {
    const view = renderGroup([settledCall('c1'), runningCall('c2')], members('c1', 'c2'), 0, 2)

    expect(shownKeys(view)).toEqual(['c2'])
  })

  it('shows every member once expanded, in flow order', () => {
    const view = renderGroup([settledCall('c1'), runningCall('c2')], members('c1', 'c2'), 0, 2)

    fireEvent.click(view.getByRole('button'))

    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true')
    expect(shownKeys(view)).toEqual(['c1', 'c2'])
  })

  it('folds the run again when the reader collapses it', () => {
    const view = renderGroup([settledCall('c1'), settledCall('c2')], members('c1', 'c2'), 0, 2)

    fireEvent.click(view.getByRole('button'))
    expect(shownKeys(view)).toEqual(['c1', 'c2'])
    fireEvent.click(view.getByRole('button'))
    expect(shownKeys(view)).toEqual([])
  })

  it('shows nothing extra while collapsed and settled, so the column gap stays single', () => {
    const view = renderGroup([settledCall('c1'), settledCall('c2')], members('c1', 'c2'), 0, 2)

    const container = view.container.querySelector('[data-activity-members]')
    expect(container?.hasAttribute('data-collapsed')).toBe(true)
  })
})
