import { describe, expect, test } from 'bun:test';
import type { CallFlowAnnotationTarget } from '@plannotator/ui/types';
import type { DiffFile } from '../types';
import { resolveCallFlowAnnotationPlacement } from './callFlowAnnotations';

const patch = [
  '@@ -10,3 +10,4 @@',
  ' context()',
  '+added()',
  ' existing()',
  ' tail()',
].join('\n');

const files: DiffFile[] = [{
  path: 'src/flow.ts',
  patch,
  additions: 1,
  deletions: 0,
  status: 'modified',
}];

const step: Pick<CallFlowAnnotationTarget, 'treePath' | 'entry' | 'label' | 'side'> = {
  treePath: 'entry:0/step:0',
  entry: 'entry()',
  label: 'existing()',
  side: 'new',
};

function target(
  overrides: { treePath?: string; lineStart?: number; lineEnd?: number } = {},
): CallFlowAnnotationTarget {
  return {
    ...step,
    filePath: 'src/flow.ts',
    lineStart: 12,
    lineEnd: 12,
    ...overrides,
  };
}

describe('resolveCallFlowAnnotationPlacement', () => {
  test('uses unchanged in-hunk context as a native inline anchor', () => {
    expect(resolveCallFlowAnnotationPlacement([target()], files)).toMatchObject({
      scope: 'line',
      filePath: 'src/flow.ts',
      lineStart: 12,
      lineEnd: 12,
    });
  });

  test('keeps an out-of-hunk step as file-scoped Call Flow feedback', () => {
    const placement = resolveCallFlowAnnotationPlacement([
      target({ lineStart: 200, lineEnd: 200 }),
    ], files);
    expect(placement).toMatchObject({ scope: 'file', filePath: 'src/flow.ts' });
    expect(placement?.targets[0]).toMatchObject({ lineStart: 200, lineEnd: 200 });
  });

  test('uses a later in-hunk target as primary without dropping earlier targets', () => {
    const placement = resolveCallFlowAnnotationPlacement([
      target({ treePath: 'outside', lineStart: 200, lineEnd: 200 }),
      target({ treePath: 'inside' }),
    ], files);
    expect(placement).toMatchObject({ scope: 'line', lineStart: 12 });
    expect(placement?.targets.map((candidate) => candidate.treePath)).toEqual(['outside', 'inside']);
  });

  test('keeps a source-less structural step as review-scoped feedback', () => {
    expect(resolveCallFlowAnnotationPlacement([step], files)).toMatchObject({
      scope: 'general',
      filePath: '',
      lineStart: 0,
      lineEnd: 0,
    });
  });
});
