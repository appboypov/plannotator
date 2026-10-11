import type { SelectedLineRange as PierreSelectedLineRange } from '@pierre/diffs';
import type { SelectedLineRange } from '@plannotator/ui/types';

export function getLineNumberFromNode(node: Node | null): number | null {
  let current: Node | null = node;
  if (current?.nodeType === Node.TEXT_NODE) current = current.parentNode;
  while (current) {
    if (current instanceof HTMLElement) {
      const line = current.closest('[data-line]')?.getAttribute('data-line');
      if (line) {
        const parsed = Number(line);
        return Number.isFinite(parsed) ? parsed : null;
      }
    }
    current = current.parentNode;
  }
  return null;
}

export function getSideFromNode(node: Node | null): 'additions' | 'deletions' {
  let current: Node | null = node;
  if (current?.nodeType === Node.TEXT_NODE) current = current.parentNode;
  while (current) {
    if (current instanceof HTMLElement) {
      if (current.hasAttribute('data-deletions')) return 'deletions';
      if (current.hasAttribute('data-additions')) return 'additions';
    }
    current = current.parentNode;
  }
  return 'additions';
}

function hasSelectionSide(range: PierreSelectedLineRange): range is SelectedLineRange {
  return range.side != null;
}

/** Pierre leaves `side` off a range it did not attribute to a diff column; such
 *  a range reads as the additions side, like an unmarked node above. */
export function toSelectedLineRange(range: PierreSelectedLineRange): SelectedLineRange {
  return hasSelectionSide(range) ? range : { ...range, side: 'additions' };
}

export function getDiffSelection(root: HTMLElement | null): Selection | null {
  if (!root) return window.getSelection();
  const containers = root.querySelectorAll('diffs-container');
  for (const container of containers) {
    const sr = container.shadowRoot;
    if (!sr) continue;
    const sel = (sr as ShadowRoot & { getSelection?: () => Selection | null }).getSelection?.();
    if (sel && !sel.isCollapsed) return sel;
  }
  return window.getSelection();
}
