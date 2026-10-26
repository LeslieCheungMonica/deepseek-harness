// ActivityGroup: one folded run of tool activity — the Think rows and the Tool
// rows a turn produced between two pieces of visible content — rendered as a
// single collapsed disclosure. A long agentic turn would otherwise push dozens
// of one-line process rows between the reader and the answer.
//
// Two rules shape the rendering:
//
//   1. Members stay MOUNTED while folded. The chat view resolves its paging
//      anchor and saved reader position by looking rows up in the DOM, so
//      unmounting a folded run would break position restore across a fold.
//      Folding is therefore a layout decision (`hidden`, and a collapsed
//      member container that leaves the flow entirely), never a mount one.
//   2. A folded run still shows the row it is working on. While the newest
//      member is in flight the group shows exactly that member and hides the
//      rest, so a running turn reads as one header plus one live row instead
//      of an unfolding wall of output that would have to be re-folded later.

import { useState, type ReactNode } from 'react'
import { DisclosureRow, IconSparkle16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { isInFlight } from './activity-group-model.ts'
import css from './ActivityGroup.module.css'

/** One member row, rendered by the chat view at its own seat. */
export interface ActivityMember {
  /** The member node's flow key. */
  readonly key: string
  /** The already-rendered seat element. */
  readonly element: ReactNode
}

export interface ActivityGroupProps {
  /** Group identity (`group:<first member key>`); the flow's React key. */
  groupKey: string
  /** Member rows in flow order. */
  members: readonly ActivityMember[]
  /** Think rows in the run. */
  thoughts: number
  /** Tool roots in the run. */
  calls: number
  /** Session hook: the group watches its newest member for in-flight state. */
  useSession: ChatViewSlotProps['useSession']
  t: ChatViewSlotProps['t']
}

/**
 * Render one folded run of tool activity.
 * @param props - Member rows, counts, and the session hook.
 * @returns the group's disclosure header and its member rows.
 */
export function ActivityGroup({
  groupKey, members, thoughts, calls, useSession, t,
}: ActivityGroupProps) {
  // Expansion is view state local to the group, exactly as it is for the Think
  // and Tool rows the group folds: the flow key survives every re-render the
  // group can expect, so nothing outside needs to drive it.
  const [open, setOpen] = useState(false)
  // The newest member is the only one that can be mid-flight, so it is the one
  // row worth subscribing to: watching every member would re-render the group
  // on unrelated activity elsewhere in the transcript.
  const newestKey = members.at(-1)?.key
  const newest = useSession(snapshot => newestKey === undefined
    ? undefined
    : snapshot.chat.nodes.get(newestKey))
  const live = isInFlight(newest)
  const plural = (count: number): 'one' | 'other' => count === 1 ? 'one' : 'other'
  const summary = [
    calls > 0 ? t(`chat.activity.calls.${plural(calls)}`, { count: calls }) : null,
    thoughts > 0 ? t(`chat.activity.thoughts.${plural(thoughts)}`, { count: thoughts }) : null,
  ].filter(part => part !== null).join(' · ')

  return (
    <div className={css.root} data-activity-group={groupKey} data-chat-anchor-key={groupKey}>
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        chevronClassName={css.chevron}
        titleClassName={css.title}
        icon={<IconSparkle16 />}
        title={t('chat.activity.title')}
        open={open}
        expandable
        expandOnRowClick
        onToggle={() => { setOpen(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary}>{summary}</span>
          </>
        )}
      />
      <div
        className={css.members}
        data-activity-members=""
        /* Folded and settled shows nothing at all: leaving an empty flex item
           in the column would double the gap on both sides of the header. */
        data-collapsed={open || live ? undefined : true}
      >
        {members.map(member => (
          <div
            key={member.key}
            className={css.member}
            data-activity-member={member.key}
            hidden={!open && member.key !== (live ? newestKey : undefined)}
          >
            {member.element}
          </div>
        ))}
      </div>
    </div>
  )
}
