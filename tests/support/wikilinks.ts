// Test fixture: MarkEdit-wikilinks' parser (https://github.com/nuc/MarkEdit-wikilinks, MIT, src/parser.ts at v0.1.3, reformatted for lint),
// so Mixed mode can be tested with the WikiLink* nodes it adds when that extension is installed.

import type { MarkdownConfig } from '@lezer/markdown';

const OPEN_BRACKET = 91; // '['
const CLOSE_BRACKET = 93; // ']'
const BANG = 33; // '!'
const NEWLINE = 10;
const PIPE = 124; // '|'

export const wikilinkConfig: MarkdownConfig = {
  defineNodes: ['WikiLink', 'WikiLinkEmbed', 'WikiLinkMark', 'WikiLinkTarget', 'WikiLinkAlias'],
  parseInline: [
    {
      name: 'WikiLink',
      // Run before plain Link so [[…]] isn't first consumed as a stray [ … ].
      before: 'Link',
      parse: (ctx, next, pos) => {
        if (next !== OPEN_BRACKET || ctx.char(pos + 1) !== OPEN_BRACKET) {
          return -1;
        }

        // ![[target]] is the embed form; consume the preceding '!' if present.
        const isEmbed = pos > ctx.offset && ctx.char(pos - 1) === BANG;
        const start = isEmbed ? pos - 1 : pos;

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

            const nodeName = isEmbed ? 'WikiLinkEmbed' : 'WikiLink';
            return ctx.addElement(ctx.elt(nodeName, start, end, children));
          }
          p++;
        }

        return -1;
      },
    },
  ],
};
