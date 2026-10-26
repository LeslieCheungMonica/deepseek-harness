/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useEffect, useRef, useState } from 'react'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const [expanded, setExpanded] = useState(false)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  return (
    <div className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}

/**
 * The Think rows of one Assistant step, in block order.
 *
 * A step that carries both reasoning and content is SPLIT by the chat view's
 * grouping pass: its Think rows render inside the activity group ahead of it
 * while its content renders as its own row. This renders that half, over the
 * step's whole block list rather than a filtered copy, so the streaming tail is
 * still computed against the step's real last block — content that follows
 * reasoning ends its running state, exactly as it does in AssistantMarkdown.
 * @param props.blocks - the step's complete block list.
 * @param props.streaming - whether the step is still arriving.
 * @param props.t - conversation locale seat for the running status.
 * @returns the step's Think rows.
 */
export function StepReasoningRows({ blocks, streaming, t }: {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  t: ChatViewSlotProps['t']
}) {
  return (
    <>
      {blocks.map((block, i) => block.kind === 'reasoning'
        ? <ReasoningRow key={i} text={block.text} running={isRunningReasoning(blocks, i, streaming)} t={t} />
        : null)}
    </>
  )
}

/**
 * Whether the reasoning block at `index` is the step's streaming tail.
 * @param blocks - the step's complete block list.
 * @param index - the block's position.
 * @param streaming - whether the step is still arriving.
 * @returns whether that Think row is still being written.
 */
export function isRunningReasoning(
  blocks: readonly AssistantBlock[],
  index: number,
  streaming: boolean,
): boolean {
  return streaming && index === blocks.length - 1
}
