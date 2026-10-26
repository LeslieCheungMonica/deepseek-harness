// The chat flow's ordered rows, derived from the node order: a plain node, or
// a run of tool activity folded into one collapsed group. Grouping is what
// keeps a long agentic turn scannable — a turn that fires thirty tool calls
// would otherwise push thirty one-line rows between the reader and the answer.
//
// A row is activity when it is a Tool root, when it is an Assistant step whose
// only content is reasoning (the Think row), or when it is an injected context
// row — process, not answer. Anything the reader must actually read — Assistant
// prose or images, the user's own turns, commands, compaction, the turn tail —
// is solid and BREAKS the run, so a group never swallows narrative.
//
// A step carrying BOTH reasoning and prose is the case that decides the whole
// design. Its Think row belongs to the process around it and its prose does
// not, so the step is split: the Think rows close the run in front of it and
// the prose renders as its own row after the group (see `omitReasoning`). A
// step with no run in front of it is left whole, because folding a single
// Think row would cost a click and hide nothing.
//
// Two classes are deliberately not counted as work:
//   * transparent — an Assistant step carrying nothing but tool-call heads
//     renders no visible row (the heads paint as Tool rows), so it rides
//     inside the run without splitting it or inflating the counts.
//   * aside — an injected context row does render, but it is neither thinking
//     nor a tool call, so it rides along uncounted rather than forcing a break.

import type {
  AssistantBlock, ChatConversationViewNode, ChatNodeStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isRunningTool } from '../contract/chat-nodes.ts'

/** One row of a folded run, and how much of its node that row shows. */
export interface ActivityMemberPlan {
  /** The member node's flow key. */
  readonly key: string
  /** Only this node's Think rows join the run: its visible content renders as
   *  its own row after the group. */
  readonly reasoningOnly?: true
}

/** One row in the chat flow: a plain node, or a folded run of activity rows. */
export type FlowEntry =
  | {
    readonly type: 'node'
    readonly key: string
    /** Render the node without its Think rows, which the group ahead owns. */
    readonly omitReasoning?: true
  }
  | {
    readonly type: 'activity'
    /** Group identity: `group:` + the first member key. */
    readonly key: string
    /** Every member in flow order, transparent and uncounted ones included. */
    readonly members: readonly ActivityMemberPlan[]
    /** Think rows in the run. */
    readonly thoughts: number
    /** Tool roots in the run. */
    readonly calls: number
  }

/** What one node contributes to a run. */
type RowClass = 'thought' | 'call' | 'aside' | 'transparent' | 'mixed' | 'solid'

/** A block that paints something the reader must read (prose, images, or the
 *  unknown-block fallback) — as opposed to process the group may fold away. */
function isVisibleBlock(block: AssistantBlock): boolean {
  return block.kind !== 'tool-call' && block.kind !== 'reasoning'
}

/**
 * Whether an Assistant step is only process, only heads, or carries content.
 * @param blocks - the step's blocks in order.
 * @param status - the step's lifecycle status.
 * @returns the step's row class; a step with content to show is `mixed` when
 *  it also has reasoning to fold, and `solid` when it has nothing to fold.
 */
function classifyStep(
  blocks: readonly AssistantBlock[],
  status: string,
): RowClass {
  const hasReasoning = blocks.some(block => block.kind === 'reasoning')
  if (status === 'interrupted' || blocks.some(isVisibleBlock)) return hasReasoning ? 'mixed' : 'solid'
  return hasReasoning ? 'thought' : 'transparent'
}

/**
 * Classify one flow node.
 * @param node - the node, or undefined for a key the store no longer holds.
 * @returns the node's row class; an unknown key is solid, so it can only ever
 *  render as its own row.
 */
function classify(node: ChatConversationViewNode | undefined): RowClass {
  if (node === undefined) return 'solid'
  if (node.kind === 'tool-call') return 'call'
  if (node.kind === 'context') return 'aside'
  if (node.kind !== 'assistant-step') return 'solid'
  const data = node.data as { readonly blocks?: readonly AssistantBlock[]; readonly status?: string }
  return classifyStep(data.blocks ?? [], data.status ?? 'settled')
}

/**
 * Whether one node is still producing — the row a collapsed group keeps
 * visible so the reader can see what the agent is doing right now, without
 * unfolding the whole run.
 * @param node - the node, or undefined for a key the store no longer holds.
 * @returns whether the node is in flight.
 */
export function isInFlight(node: ChatConversationViewNode | undefined): boolean {
  if (node === undefined) return false
  if (node.kind === 'tool-call') {
    return isRunningTool((node.data as { readonly root: Parameters<typeof isRunningTool>[0] }).root)
  }
  if (node.kind !== 'assistant-step') return false
  return (node.data as { readonly status?: string }).status === 'running'
}

/**
 * The signal the chat view subscribes to so its grouping pass notices the one
 * change that can invalidate it.
 *
 * A running Assistant step is the only row whose class can move under a
 * settled pass: it starts as a Think row and stops being one the moment its
 * answer text arrives, at which point it must leave the folded run. Its node
 * key never changes while that happens, so the flow order alone would never
 * tell the view to re-derive — this signal does, and deliberately says
 * nothing about reasoning text, so streaming does not re-derive per chunk.
 * @param order - the flow's node keys, in display order.
 * @param nodes - lookup for the payload behind each key.
 * @returns one entry per running Assistant step; equal while none of them has
 *  changed class, empty once nothing is running.
 */
export function flowClassSignal(
  order: readonly string[],
  nodes: Pick<ChatNodeStore, 'get'>,
): string {
  const running: string[] = []
  for (const key of order) {
    const node = nodes.get(key)
    if (node === undefined || node.kind !== 'assistant-step') continue
    const data = node.data as { readonly blocks?: readonly AssistantBlock[]; readonly status?: string }
    if (data.status !== 'running') continue
    running.push(`${key}:${classifyStep(data.blocks ?? [], 'running')}`)
  }
  return running.join(';')
}

/**
 * Fold maximal runs of tool activity into single collapsed groups.
 * @param order - the flow's node keys, in display order.
 * @param nodes - lookup for the payload behind each key.
 * @returns the ordered flow rows; a run of fewer than two visible rows is left
 *  unfolded, since wrapping a lone row would cost a click and save nothing.
 */
export function groupActivity(
  order: readonly string[],
  nodes: Pick<ChatNodeStore, 'get'>,
): readonly FlowEntry[] {
  const entries: FlowEntry[] = []
  let members: ActivityMemberPlan[] = []
  let thoughts = 0
  let calls = 0
  // The step whose Think rows closed the run; its content follows the group.
  let trailing: string | null = null

  const flush = (): void => {
    if (members.length > 0) {
      if (thoughts + calls >= 2) {
        /* v8 ignore next -- a non-empty run always has a first member. */
        const first = members[0]?.key ?? ''
        entries.push({ type: 'activity', key: `group:${first}`, members, thoughts, calls })
        if (trailing !== null) entries.push({ type: 'node', key: trailing, omitReasoning: true })
      } else {
        // Too small to be worth a click: every member renders whole, and a
        // trailing step keeps its Think rows where they already are.
        for (const member of members) entries.push({ type: 'node', key: member.key })
      }
    }
    members = []
    thoughts = 0
    calls = 0
    trailing = null
  }

  for (const key of order) {
    const row = classify(nodes.get(key))
    if (row === 'solid') {
      flush()
      entries.push({ type: 'node', key })
      continue
    }
    // A step with content shows a row the run cannot swallow, so the run ends
    // at it — after its Think rows, which precede that content.
    if (row === 'mixed') {
      members.push({ key, reasoningOnly: true })
      thoughts += 1
      trailing = key
      flush()
      continue
    }
    members.push({ key })
    if (row === 'thought') thoughts += 1
    else if (row === 'call') calls += 1
  }
  flush()
  return entries
}
