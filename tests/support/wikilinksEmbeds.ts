// Test fixture: MarkEdit-wikilinks' parser with embeds fixed (https://github.com/nuc/MarkEdit-wikilinks/pull/1, MIT,
// src/parser.ts, reformatted for lint), which parses ![[embeds]] as WikiLinkEmbed instead of images.

import type { InlineContext, MarkdownConfig } from '@lezer/markdown';

const OPEN_BRACKET = 91; // '['
const CLOSE_BRACKET = 93; // ']'
const BANG = 33; // '!'
const NEWLINE = 10;
const PIPE = 124; // '|'

export const wikilinkConfig: MarkdownConfig = {
  defineNodes: ['WikiLink', 'WikiLinkEmbed', 'WikiLinkMark', 'WikiLinkTarget', 'WikiLinkAlias'],
  parseInline: [
    {
      name: 'WikiLinkEmbed',
      // Run before Image, which otherwise claims the '![' of ![[target]] first.
      before: 'Image',
      parse: (ctx, next, pos) => {
        if (next !== BANG || ctx.char(pos + 1) !== OPEN_BRACKET || ctx.char(pos + 2) !== OPEN_BRACKET) {
          return -1;
        }

        return parseWikilink(ctx, pos, pos + 1, 'WikiLinkEmbed');
      },
    },
    {
      name: 'WikiLink',
      // Run before plain Link so [[…]] isn't first consumed as a stray [ … ].
      before: 'Link',
      parse: (ctx, next, pos) => {
        if (next !== OPEN_BRACKET || ctx.char(pos + 1) !== OPEN_BRACKET) {
          return -1;
        }

        return parseWikilink(ctx, pos, pos, 'WikiLink');
      },
    },
  ],
};

// Parses [[target]] or [[target|alias]] whose '[[' is at `pos`; `start` includes an embed's '!'.
function parseWikilink(ctx: InlineContext, start: number, pos: number, nodeName: 'WikiLink' | 'WikiLinkEmbed'): number {
  let pipeAt = -1;
  let p = pos + 2;
  while (p < ctx.end - 1) {
    const c = ctx.char(p);
    // Wikilinks don't span lines and can't nest a fresh '[['.
    if (c === NEWLINE) {return -1;}
    if (c === OPEN_BRACKET && ctx.char(p + 1) === OPEN_BRACKET) {return -1;}
    if (c === PIPE && pipeAt < 0) {pipeAt = p;}
    if (c === CLOSE_BRACKET && ctx.char(p + 1) === CLOSE_BRACKET) {
      const end = p + 2;
      const children = [
        ctx.elt('WikiLinkMark', pos, pos + 2),
      ];

      if (pipeAt > 0) {
        children.push(ctx.elt('WikiLinkTarget', pos + 2, pipeAt));
        children.push(ctx.elt('WikiLinkMark', pipeAt, pipeAt + 1));
        children.push(ctx.elt('WikiLinkAlias', pipeAt + 1, p));
      } else {
        children.push(ctx.elt('WikiLinkTarget', pos + 2, p));
      }

      children.push(ctx.elt('WikiLinkMark', p, end));

      return ctx.addElement(ctx.elt(nodeName, start, end, children));
    }
    p++;
  }

  return -1;
}
