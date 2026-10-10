import React, { lazy, Suspense } from 'react';
import type { Block } from '../types';
import { DiagramBlockPending } from './diagram/DiagramPending';

const MermaidBlock = lazy(async () => ({ default: (await import('./MermaidBlock')).MermaidBlock }));

/** Read-only diagrams reuse the Viewer's renderer and preserve block anchors. */
export const RenderedMermaidBlock: React.FC<{ block: Block }> = ({ block }) => (
  <Suspense fallback={<DiagramBlockPending block={block} kind="mermaid" />}>
    <MermaidBlock block={block} readOnly />
  </Suspense>
);
