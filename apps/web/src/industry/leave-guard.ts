/**
 * Pages where a person types work that is only saved when they press Save or Pay: a new or edited document, the
 * point of sale cart, a stock count, the print designer, an import. Switching the branch remounts the page and the
 * tour goes to Home, so both ask first there.
 */
export function isEditorRoute(hash: string): boolean {
  const page = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return /^(new|edit)(-|$)/.test(page) || ['pos', 'stock-count', 'print-design', 'import'].includes(page);
}

/** True when leaving the current page loses nothing, or the person said yes. */
export function mayLeave(question: string, hash = typeof location === 'undefined' ? '' : location.hash, ask: (q: string) => boolean = (q) => window.confirm(q)): boolean {
  return !isEditorRoute(hash) || ask(question);
}
