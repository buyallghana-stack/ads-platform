'use client'

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const onClient = () => true
const onServer = () => false

/**
 * True only after the component is running in the browser.
 *
 * ⚠️ A PORTAL NEEDS THIS OR IT BREAKS HYDRATION. `createPortal(…,
 * document.body)` guarded with `typeof document === 'undefined'` looks right
 * and is not: the server renders nothing, and then the CLIENT'S FIRST RENDER
 * already has a document, so it renders the portal. React compares the two,
 * finds a `<div role="status">` where it expected the app shell, and throws a
 * hydration mismatch that takes the whole page down to a client re-render.
 *
 * Caught in the dev log while photographing the walkthrough: every screen
 * carrying the task bar was logging one.
 *
 * `useSyncExternalStore` is the fix rather than a `useState` flipped in an
 * effect, because React knows about it: the server snapshot is false, the
 * client snapshot is true, and it schedules the change itself instead of
 * causing a cascading render.
 */
export function useMounted() {
  return useSyncExternalStore(subscribe, onClient, onServer)
}
