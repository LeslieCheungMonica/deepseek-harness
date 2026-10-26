// StepReasoningSeat: the Think half of an Assistant step whose content renders
// somewhere else.
//
// The chat view's grouping pass folds a step's Think rows into the activity
// group ahead of it (`reasoningOnly` in activity-group-model.ts) while the
// step's prose stays a flow row of its own. The group renders those rows
// through this seat rather than inline, because the seat subscribes to its own
// node key: a step still streaming then keeps its Think row live even though
// the flow order — and so the grouping pass — has not moved.

import type { ChatViewSlotProps } from '../contract/slots.ts'
import { StepReasoningRows } from './ReasoningRow.tsx'

export interface StepReasoningSeatProps {
  /** Flow key of the Assistant step whose Think rows belong to the run. */
  nodeKey: string
  useSession: ChatViewSlotProps['useSession']
  t: ChatViewSlotProps['t']
}

/**
 * Render one Assistant step's Think rows as activity-group members.
 * @param props - The step's flow key and the session hook to watch it with.
 * @returns the step's Think rows, or nothing when the key is not an Assistant
 *  step any more.
 */
export function StepReasoningSeat({ nodeKey, useSession, t }: StepReasoningSeatProps) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  if (node?.kind !== 'assistant-step') return null
  const data = node.data as {
    readonly blocks: Parameters<typeof StepReasoningRows>[0]['blocks']
    readonly status: string
  }
  return <StepReasoningRows blocks={data.blocks} streaming={data.status === 'running'} t={t} />
}
