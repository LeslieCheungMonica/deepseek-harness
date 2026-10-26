// Flow anchoring: resolving a saved semantic row identity back to the element
// that can answer for its position.
//
// A row folded inside an activity group cannot answer for position: it is not
// rendered, so its box is zero-height and its offset is meaningless. The
// group's own anchor row stands in for it, which keeps the reader within a row
// of where they were instead of throwing the viewport to a bogus offset. This
// only matters across a reload, where the fold state — unlike the saved reader
// position — starts collapsed again.

/** A row that cannot answer for its own position. */
const UNRENDERED = '[data-collapsed], [hidden]'

/**
 * Find an already-rendered settled row without interpolating a selector.
 * @param list - the flow column.
 * @param key - the saved node/call identity.
 * @returns the row, or the folded group standing in for it; null when the
 *  column holds no such row — a group with nothing to stand in returns null
 *  rather than a row whose offset would be a lie.
 */
export function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  let standIn: HTMLElement | null = null
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey !== key) continue
    const owner = row.closest<HTMLElement>(UNRENDERED)
    if (owner === null) return row
    standIn = owner.closest<HTMLElement>('[data-chat-anchor-key]')
  }
  return standIn
}
