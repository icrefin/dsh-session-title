/**
 * Version and authorship, in one place.
 *
 * The style contract makes the version chip mandatory on a page that shows its
 * own version, and the credit literal: `v<version> | Author: icrefin
 * [icrefinai@gmail.com]`, rendered as one text run inside the chip so the
 * credit never picks up a colour, size, weight or tooltip of its own.
 *
 * @module dsh-session-title/version
 */

/** Package version. Bump together with `package.json`. */
export const VERSION = '0.4.1'

/** Author credit, verbatim, as the style contract requires it. */
export const AUTHORS = 'icrefin [icrefinai@gmail.com]'