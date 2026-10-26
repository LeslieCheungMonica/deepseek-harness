// @vitest-environment jsdom
// Flow anchoring: resolving a saved semantic row identity back to the element
// that can answer for its position.
//
// A row folded inside a collapsed activity group cannot answer — it is not
// rendered, so its box is zero-height and its offset is meaningless. The
// group's own anchor row stands in, which keeps the reader within a row of
// where they were instead of throwing the viewport to a bogus offset.

import { describe, expect, it } from 'vitest'
import { anchorElement } from '../src/client/chat/chat-anchor.ts'

/** One flow column built from literal markup. */
function column(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  return host
}

/** A folded group whose member row carries its own anchor identity. */
function group(collapsed: boolean, memberHidden: boolean): string {
  return `
    <div data-chat-anchor-key="a"></div>
    <div data-chat-anchor-key="group:c1">
      <div data-activity-members ${collapsed ? 'data-collapsed' : ''}>
        <div data-activity-member="c1" ${memberHidden ? 'hidden' : ''}>
          <div data-chat-anchor-key="c1"></div>
        </div>
      </div>
    </div>`
}

describe('anchorElement', () => {
  it('finds the rendered row that carries the saved key', () => {
    const list = column('<div data-chat-anchor-key="a"></div><div data-chat-anchor-key="b"></div>')

    expect(anchorElement(list, 'b')?.dataset.chatAnchorKey).toBe('b')
  })

  it('returns null for a key the column no longer holds', () => {
    const list = column('<div data-chat-anchor-key="a"></div>')

    expect(anchorElement(list, 'gone')).toBeNull()
  })

  it('stands in with the group for a row folded inside a collapsed run', () => {
    const list = column(group(true, true))

    expect(anchorElement(list, 'c1')?.dataset.chatAnchorKey).toBe('group:c1')
  })

  it('stands in with the group for a row hidden behind the live member', () => {
    const list = column(group(false, true))

    expect(anchorElement(list, 'c1')?.dataset.chatAnchorKey).toBe('group:c1')
  })

  it('prefers the row itself once the run is unfolded', () => {
    const list = column(group(false, false))

    expect(anchorElement(list, 'c1')?.dataset.chatAnchorKey).toBe('c1')
  })
})
