// @vitest-environment jsdom
// StepReasoningSeat renders the Think half of an Assistant step whose content
// renders elsewhere (the activity group owns these rows). It subscribes to its
// own node key, so a step still streaming keeps its Think row live even though
// nothing else about the flow changed.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ChatViewSlotProps } from '../src/client/contract/slots.ts'
import { StepReasoningSeat } from '../src/client/chat/StepReasoningSeat.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)

/** Minimal node stand-in: the seat reads only kind, status, and blocks. */
function step(status: string, blocks: readonly unknown[]): ChatConversationViewNode {
  return {
    key: 'step-1',
    id: 'step-1',
    target: 'chat',
    anchorSeq: 0,
    location: { kind: 'session' },
    visibility: 'visible',
    kind: 'assistant-step',
    data: { status, turn: 1, step: 1, blocks, time: 0 },
  } as unknown as ChatConversationViewNode
}

function sessionWith(node: ChatConversationViewNode | undefined): ChatViewSlotProps['useSession'] {
  const snapshot = { chat: { nodes: { get: () => node } } }
  return ((selector: (value: unknown) => unknown) => selector(snapshot)) as unknown as ChatViewSlotProps['useSession']
}

const seat = (node: ChatConversationViewNode | undefined) => render(
  <StepReasoningSeat nodeKey="step-1" useSession={sessionWith(node)} t={t} />,
)

describe('StepReasoningSeat', () => {
  it('renders only the step’s Think rows, leaving its prose to the caller', () => {
    const view = seat(step('settled', [
      { kind: 'reasoning', text: 'weigh the options' },
      { kind: 'text', text: 'Done.' },
    ]))

    expect(view.getByText('Think')).toBeTruthy()
    expect(view.queryByText('Done.')).toBeNull()
  })

  it('marks the Think row running only while the step is still arriving', () => {
    const running = seat(step('running', [{ kind: 'reasoning', text: 'arriving' }]))
    expect(running.getByText('运行中')).toBeTruthy()

    cleanup()
    const settled = seat(step('settled', [{ kind: 'reasoning', text: 'arrived' }]))
    expect(settled.queryByText('运行中')).toBeNull()
  })

  it('renders nothing when the key no longer resolves to an Assistant step', () => {
    expect(seat(undefined).container.textContent).toBe('')
  })
})
