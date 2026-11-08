import type { EditorState } from '@codemirror/state';
import type { SyntaxNodeRef } from '@lezer/common';
import { isImagePath } from '../features/obsidian';

const wikilinkPattern = /^(!?)\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]$/;

/**
 * `[[Note]]`, `[[Note|alias]]`, `![[image.png|300]]` and `![[Note]]` in Mixed mode.
 *
 * Links are `WikiLink` nodes from MarkEdit-wikilinks' parser, so they only apply when it's installed.
 * Embeds are always parsed as Markdown images (`![` comes before MarkEdit-wikilinks' parser runs),
 * so they're recognized from the image's text and work without it.
 */
export function wikilinkSyntax(node: SyntaxNodeRef, state: EditorState) {
  if (node.name !== 'WikiLink' && node.name !== 'Image') {
    return;
  }

  const source = state.sliceDoc(node.from, node.to);
  const match = wikilinkPattern.exec(source);
  const embed = match?.[1] === '!';
  if (match === null || embed !== (node.name === 'Image')) {
    return;
  }

  const target = match[2].trim();
  if (target === '') {
    return;
  }

  const alias = (match[3] ?? '').trim();
  const path = target.replace(/#.*$/, '');
  const image = embed && isImagePath(path);

  // `|300` or `|300x200` sizes an image embed, any other alias is shown instead of the target
  const size = image ? /^(\d+)(?:x(\d+))?$/.exec(alias) : null;
  const targetFrom = node.from + match[1].length + 2;
  const targetTo = targetFrom + match[2].length;
  const label = alias !== '' && size === null
    ? { from: targetTo + 1, to: node.to - 2 }
    : { from: targetFrom, to: targetTo };

  return {
    embed,
    image,
    target,
    path,
    alt: size === null && alias !== '' ? alias : path,
    width: size?.[1],
    height: size?.[2],
    label,
    hidden: [
      { from: node.from, to: label.from },
      { from: label.to, to: node.to },
    ],
  };
}
