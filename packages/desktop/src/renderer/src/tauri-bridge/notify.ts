// Telling the user that something they asked for did not happen.
//
// Under Electron the main process raised these through `mt::show-notification`
// when a rename, a move, an import or an export failed. The bridge inherited
// the actions but not the notifications: several of them wrote a line to a
// console nobody has open and returned, so the dialog closed, the file kept its
// old name, and there was no way to tell whether the click had even registered.
//
// The failures that stay quiet are the ones nobody asked for — a watcher that
// cannot re-read a file that has just been deleted, say, whose unlink event is
// already on its way. The rule is whether a person is waiting for the result.

import { t } from '@/i18n'
import type { DispatchLocal } from './save'

/** The message under any of the titles below: the path, then the reason. */
export const pathAndReason = (path: string, err: unknown): string =>
  t('notifications.pathFailedMessage', {
    path,
    msg: err instanceof Error ? err.message : String(err)
  })

export const notifyFailure = (
  dispatchLocal: DispatchLocal,
  titleKey: string,
  message: string
): void => {
  dispatchLocal('mt::show-notification', [{ title: t(titleKey), type: 'error', message }])
}
