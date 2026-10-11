import React, { useMemo } from 'react';
import { parseMarkdownToBlocks, groupBlocks, computeListIndices } from '../utils/parser';
import { BlockRenderer } from './BlockRenderer';
import { isMermaidLanguage } from './diagramLanguages';
import { RenderedMermaidBlock } from './RenderedMermaidBlock';

/**
 * Full markdown renderer for surfaces outside the plan editor (e.g. the PR
 * description). Reuses the shared {@link BlockRenderer} — so tables, HTML,
 * callouts, code, and `data-block-id` all come along — and renders a Mermaid
 * fence as the plan Viewer's diagram, read-only ({@link RenderedMermaidBlock}),
 * without dragging in the Viewer's toolbar/lightbox machinery.
 *
 * Sizing/spacing is inherited from the wrapper: pass `className="md-compact"`
 * (or any scope) to override the renderer's plan-sized defaults via CSS.
 */
export interface RenderedMarkdownProps {
  markdown: string;
  className?: string;
  onImageClick?: (src: string, alt: string) => void;
  onOpenLinkedDoc?: (path: string) => void;
  onOpenCodeFile?: (path: string) => void;
  githubRepo?: string;
  repoHost?: string;
}

export const RenderedMarkdown: React.FC<RenderedMarkdownProps> = ({
  markdown,
  className,
  onImageClick,
  onOpenLinkedDoc,
  onOpenCodeFile,
  githubRepo,
  repoHost,
}) => {
  const groups = useMemo(() => groupBlocks(parseMarkdownToBlocks(markdown)), [markdown]);
  const cb = { onImageClick, onOpenLinkedDoc, onOpenCodeFile, githubRepo, repoHost };

  return (
    <div className={className}>
      {groups.map((group) =>
        group.type === 'list-group' ? (
          (() => {
            const indices = computeListIndices(group.blocks);
            return (
              <div key={group.key}>
                {group.blocks.map((block, i) => (
                  <BlockRenderer key={block.id} block={block} orderedIndex={indices[i]} {...cb} />
                ))}
              </div>
            );
          })()
        ) : group.block.type === 'code' && isMermaidLanguage(group.block.language) ? (
          <RenderedMermaidBlock key={group.block.id} block={group.block} />
        ) : (
          <BlockRenderer key={group.block.id} block={group.block} {...cb} />
        ),
      )}
    </div>
  );
};
