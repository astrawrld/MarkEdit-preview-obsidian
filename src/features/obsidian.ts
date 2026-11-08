import type { Delimiter, MarkdownIt, StateBlock, StateCore, StateInline, Token } from 'markdown-it';

/**
 * Obsidian flavored markdown:
 *
 * - Callouts: `> [!type] Title`, foldable with `+` / `-`, nested, all Obsidian types and aliases
 * - Highlights: `==text==`
 * - Comments: `%%inline%%` and `%%` blocks
 * - Tags: `#tag`, `#nested/tag`
 * - Block IDs: trailing `^block-id`, linkable via `[[#^block-id]]`
 * - Embeds: `![[image.png]]`, `![[image.png|300]]`, `![[image.png|300x200]]`, `![[Note]]`
 * - Same-note links: `[[#Heading]]`, `[[#Heading|alias]]`
 *
 * Other `[[wikilinks]]` are intentionally left as text, they're handled by MarkEdit-wikilinks,
 * which resolves them across the vault. Embeds of notes are emitted with the same
 * `me-wikilink` class so that extension can open them.
 *
 * Everything is implemented as markdown-it rules (no source rewriting) to keep line maps intact.
 */
export function obsidianPlugin(md: MarkdownIt, options: { slugify: (text: string) => string; renderWikilinks?: boolean }) {
  md.block.ruler.before('fence', 'obsidian_comment_block', commentBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.inline.ruler.before('emphasis', 'obsidian_comment', commentInline);
  md.inline.ruler.before('image', 'obsidian_embed', embed);
  md.inline.ruler.before('link', 'obsidian_heading_link', headingLink);
  md.inline.ruler.after('obsidian_heading_link', 'obsidian_wikilink', options.renderWikilinks === true ? wikilink : wikilinkText);
  md.inline.ruler.push('obsidian_tag', tag);
  md.inline.ruler.before('emphasis', 'obsidian_mark', markTokenize);
  md.inline.ruler2.before('emphasis', 'obsidian_mark', markPostProcess);
  md.core.ruler.after('block', 'obsidian_callout', callouts);
  md.core.ruler.after('block', 'obsidian_block_id', blockIds);

  md.renderer.rules.callout_open = (tokens, idx, _options, _env, self) => {
    const token = tokens[idx];
    const { type, rawType, fold } = token.meta as CalloutMeta;
    token.attrJoin('class', `markdown-alert markdown-alert-${type}`);
    token.attrSet('data-callout', rawType);
    if (fold === '+') {
      token.attrSet('open', '');
    }

    return `<${fold === '' ? 'div' : 'details'}${self.renderAttrs(token)}>\n`;
  };

  md.renderer.rules.callout_close = (tokens, idx) => {
    return (tokens[idx].meta as CalloutMeta).fold === '' ? '</div>\n' : '</details>\n';
  };

  md.renderer.rules.callout_title_open = (tokens, idx) => {
    const { icon, fold } = tokens[idx].meta as CalloutMeta;
    return `<${fold === '' ? 'p' : 'summary'} class="markdown-alert-title">${icon}<span class="markdown-alert-title-inner">`;
  };

  md.renderer.rules.callout_title_close = (tokens, idx) => {
    return `</span></${(tokens[idx].meta as CalloutMeta).fold === '' ? 'p' : 'summary'}>\n`;
  };

  md.renderer.rules.obsidian_embed = (tokens, idx) => {
    const { target, label, width, height } = tokens[idx].meta as EmbedMeta;
    const escape = md.utils.escapeHtml;
    const path = target.replace(/#.*$/, '');

    if (isImagePath(path)) {
      const size = [width ? ` width="${width}"` : '', height ? ` height="${height}"` : ''].join('');
      // data-embed-target lets the vault resolver find the image when it isn't next to the note
      return `<img src="${escape(md.normalizeLink(path))}" alt="${escape(label ?? path)}"${size} data-embed-target="${escape(path)}">`;
    }

    return `<a class="me-wikilink obsidian-embed" data-wikilink-target="${escape(target)}" href="#">${escape(label ?? target)}</a>`;
  };

  md.renderer.rules.obsidian_wikilink = (tokens, idx) => {
    const { target, label } = tokens[idx].meta as EmbedMeta;
    const escape = md.utils.escapeHtml;
    return `<a class="me-wikilink" data-wikilink-target="${escape(target)}" href="#">${escape(label ?? target)}</a>`;
  };

  md.renderer.rules.obsidian_tag = (tokens, idx) => {
    const name = md.utils.escapeHtml(tokens[idx].content);
    return `<span class="tag" data-tag="${name}">#${name}</span>`;
  };

  function headingLink(state: StateInline, silent: boolean) {
    const match = /^\[\[#([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/.exec(state.src.slice(state.pos));
    if (match === null) {
      return false;
    }

    if (!silent) {
      const fragment = match[1].trim();
      const href = fragment.startsWith('^') ? `#${fragment}` : `#${options.slugify(fragment)}`;
      const open = state.push('link_open', 'a', 1);
      open.attrs = [['href', href]];
      open.markup = 'wikilink';
      const text = state.push('text', '', 0);
      text.content = (match[2] ?? fragment).trim();
      state.push('link_close', 'a', -1);
    }

    state.pos += match[0].length;
    return true;
  }
}

// Keep `[[target|alias]]` as one raw text run, so emphasis, math or tags inside it
// don't split it apart before MarkEdit-wikilinks turns it into a link.
function wikilinkText(state: StateInline, silent: boolean) {
  const match = /^\[\[[^[\]\n]+\]\]/.exec(state.src.slice(state.pos));
  if (match === null) {
    return false;
  }

  if (!silent) {
    state.pending += match[0];
  }

  state.pos += match[0].length;
  return true;
}

// Render `[[target|alias]]` as links, for hosts where MarkEdit-wikilinks doesn't run (e.g., Quick Look)
function wikilink(state: StateInline, silent: boolean) {
  const match = /^\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/.exec(state.src.slice(state.pos));
  if (match === null) {
    return wikilinkText(state, silent);
  }

  if (!silent) {
    const token = state.push('obsidian_wikilink', '', 0);
    token.meta = { target: match[1].trim(), label: match[2]?.trim() } satisfies EmbedMeta;
  }

  state.pos += match[0].length;
  return true;
}

// MARK: - Callouts

type CalloutMeta = { type: string; rawType: string; icon: string; fold: string };

const calloutRE = /^\[!([\w-]+)\]([+-]?)(?:[ \t]+(.*))?$/;

// Obsidian's aliases, keyed by alias, mapped to the canonical type used for styling.
// GitHub's types (note, tip, important, warning, caution) keep their own styling.
const calloutAliases: Record<string, string> = {
  note: 'note',
  abstract: 'abstract', summary: 'abstract', tldr: 'abstract',
  info: 'info',
  todo: 'todo',
  tip: 'tip', hint: 'tip',
  important: 'important',
  success: 'success', check: 'success', done: 'success',
  question: 'question', help: 'question', faq: 'question',
  warning: 'warning', attention: 'warning',
  caution: 'caution',
  failure: 'failure', fail: 'failure', missing: 'failure',
  danger: 'danger', error: 'danger',
  bug: 'bug',
  example: 'example',
  quote: 'quote', cite: 'quote',
};

const lucide = (paths: string) => `<svg class="octicon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const calloutIcons: Record<string, string> = {
  note: lucide('<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  abstract: lucide('<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>'),
  info: lucide('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  todo: lucide('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  tip: lucide('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  important: lucide('<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>'),
  success: lucide('<path d="M20 6 9 17l-5-5"/>'),
  question: lucide('<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>'),
  warning: lucide('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>'),
  caution: lucide('<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4M12 17h.01"/>'),
  failure: lucide('<path d="M18 6 6 18M6 6l12 12"/>'),
  danger: lucide('<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>'),
  bug: lucide('<path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>'),
  example: lucide('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
  quote: lucide('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'),
};

function callouts(state: StateCore) {
  const tokens = state.tokens;
  for (let index = 0; index < tokens.length; index += 1) {
    const open = tokens[index];
    if (open.type !== 'blockquote_open') {
      continue;
    }

    const paragraph = tokens[index + 1];
    const inline = tokens[index + 2];
    if (paragraph?.type !== 'paragraph_open' || inline?.type !== 'inline') {
      continue;
    }

    const newline = inline.content.indexOf('\n');
    const firstLine = newline === -1 ? inline.content : inline.content.slice(0, newline);
    const match = calloutRE.exec(firstLine.trim());
    if (match === null) {
      continue;
    }

    // Find the matching close by nesting level, so nested callouts stay balanced
    let closeIndex = index + 1;
    while (closeIndex < tokens.length && !(tokens[closeIndex].type === 'blockquote_close' && tokens[closeIndex].level === open.level)) {
      closeIndex += 1;
    }

    if (closeIndex === tokens.length) {
      continue;
    }

    const rawType = match[1].toLowerCase();
    const type = calloutAliases[rawType] ?? 'note';
    const meta: CalloutMeta = {
      type,
      rawType,
      icon: calloutIcons[type],
      fold: match[2],
    };

    open.type = 'callout_open';
    open.tag = 'div';
    open.meta = meta;
    tokens[closeIndex].type = 'callout_close';
    tokens[closeIndex].tag = 'div';
    tokens[closeIndex].meta = meta;

    inline.content = newline === -1 ? '' : inline.content.slice(newline + 1);
    if (inline.content === '') {
      paragraph.hidden = true;
      tokens[index + 3].hidden = true;
    }

    // The title is a regular inline token, so it's parsed with the rest of the document
    const titleOpen = new state.Token('callout_title_open', 'p', 1);
    const title = new state.Token('inline', '', 0);
    const titleClose = new state.Token('callout_title_close', 'p', -1);
    titleOpen.meta = titleClose.meta = meta;
    title.content = match[3]?.trim() || capitalize(rawType);
    title.map = paragraph.map;
    title.children = [];
    tokens.splice(index + 1, 0, titleOpen, title, titleClose);
  }
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// MARK: - Comments

function commentBlock(state: StateBlock, startLine: number, endLine: number, silent: boolean) {
  const start = state.bMarks[startLine] + state.tShift[startLine];
  if (state.sCount[startLine] - state.blkIndent >= 4 || !state.src.startsWith('%%', start)) {
    return false;
  }

  const lineText = (line: number) => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trimEnd();
  const first = lineText(startLine);

  // Single line `%% comment %%`, only a block if nothing follows the closing marker
  let closeLine = -1;
  if (first.length >= 4 && first.endsWith('%%') && first.indexOf('%%', 2) === first.length - 2) {
    closeLine = startLine;
  } else if (first.indexOf('%%', 2) !== -1) {
    return false;
  } else {
    for (let line = startLine + 1; line < endLine; line += 1) {
      const text = lineText(line);
      const index = text.indexOf('%%');
      if (index !== -1) {
        if (index !== text.length - 2) {
          return false;
        }

        closeLine = line;
        break;
      }
    }
  }

  if (closeLine === -1) {
    return false;
  }

  if (!silent) {
    const token = state.push('obsidian_comment', '', 0);
    token.map = [startLine, closeLine + 1];
    token.hidden = true;
  }

  state.line = closeLine + 1;
  return true;
}

function commentInline(state: StateInline, _silent: boolean) {
  if (!state.src.startsWith('%%', state.pos)) {
    return false;
  }

  const end = state.src.indexOf('%%', state.pos + 2);
  if (end === -1) {
    return false;
  }

  state.pos = end + 2;
  return true;
}

// MARK: - Embeds

type EmbedMeta = { target: string; label?: string; width?: string; height?: string };

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'ico', 'heic']);

function isImagePath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return path.includes('.') && imageExtensions.has(extension);
}

function embed(state: StateInline, silent: boolean) {
  const match = /^!\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/.exec(state.src.slice(state.pos));
  if (match === null) {
    return false;
  }

  if (!silent) {
    const meta: EmbedMeta = { target: match[1].trim() };
    const extra = match[2]?.trim();
    const size = extra === undefined ? null : /^(\d+)(?:x(\d+))?$/.exec(extra);
    if (size !== null) {
      meta.width = size[1];
      meta.height = size[2];
    } else if (extra) {
      meta.label = extra;
    }

    const token = state.push('obsidian_embed', '', 0);
    token.meta = meta;
  }

  state.pos += match[0].length;
  return true;
}

// MARK: - Tags

const tagRE = /^#([\p{L}\p{N}\p{Extended_Pictographic}_\-/]+)/u;

function tag(state: StateInline, silent: boolean) {
  if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) {
    return false;
  }

  const previous = state.pos === 0 ? '' : state.src.charAt(state.pos - 1);
  if (previous !== '' && !/\s/.test(previous)) {
    return false;
  }

  const match = tagRE.exec(state.src.slice(state.pos));
  if (match === null || /^[\d/]+$/.test(match[1]) || match[1].endsWith('/')) {
    return false;
  }

  if (!silent) {
    const token = state.push('obsidian_tag', '', 0);
    token.content = match[1];
  }

  state.pos += match[0].length;
  return true;
}

// MARK: - Block IDs

const blockIdRE = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;

function blockIds(state: StateCore) {
  const tokens = state.tokens;
  for (let index = 1; index < tokens.length; index += 1) {
    const inline = tokens[index];
    const open = tokens[index - 1];
    if (inline.type !== 'inline' || open.type !== 'paragraph_open') {
      continue;
    }

    const match = blockIdRE.exec(inline.content);
    if (match === null) {
      continue;
    }

    inline.content = inline.content.slice(0, match.index).trimEnd();
    if (inline.content !== '') {
      findBlockIdOwner(tokens, index - 1).attrSet('id', `^${match[1]}`);
      continue;
    }

    // A block ID on its own line, it belongs to the preceding block (e.g., a table or list)
    open.hidden = true;
    tokens[index + 1].hidden = true;
    (findPrecedingBlock(tokens, index - 1) ?? open).attrSet('id', `^${match[1]}`);
  }
}

// List items own the IDs of their (tight) paragraphs, like Obsidian
function findBlockIdOwner(tokens: Token[], paragraphIndex: number) {
  const previous = tokens[paragraphIndex - 1];
  return previous?.type === 'list_item_open' ? previous : tokens[paragraphIndex];
}

function findPrecedingBlock(tokens: Token[], paragraphIndex: number) {
  const close = tokens[paragraphIndex - 1];
  if (close?.nesting !== -1 || close.level !== tokens[paragraphIndex].level) {
    return undefined;
  }

  for (let index = paragraphIndex - 2; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token.nesting === 1 && token.level === close.level) {
      return token;
    }
  }

  return undefined;
}

// MARK: - Highlights, based on markdown-it's strikethrough

function markTokenize(state: StateInline, silent: boolean) {
  const start = state.pos;
  const marker = state.src.charCodeAt(start);
  if (silent || marker !== 0x3D /* = */) {
    return false;
  }

  const scanned = state.scanDelims(state.pos, true);
  let length = scanned.length;
  if (length < 2) {
    return false;
  }

  if (length % 2) {
    const token = state.push('text', '', 0);
    token.content = '=';
    length -= 1;
  }

  for (let index = 0; index < length; index += 2) {
    const token = state.push('text', '', 0);
    token.content = '==';
    state.delimiters.push({
      marker,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    });
  }

  state.pos += scanned.length;
  return true;
}

function markPostProcess(state: StateInline) {
  const process = (delimiters: Delimiter[]) => {
    const loneMarkers: number[] = [];
    for (const start of delimiters) {
      if (start.marker !== 0x3D || start.end === -1) {
        continue;
      }

      const end = delimiters[start.end];
      const open = state.tokens[start.token];
      open.type = 'mark_open';
      open.tag = 'mark';
      open.nesting = 1;
      open.markup = '==';
      open.content = '';

      const close = state.tokens[end.token];
      close.type = 'mark_close';
      close.tag = 'mark';
      close.nesting = -1;
      close.markup = '==';
      close.content = '';

      const previous = state.tokens[end.token - 1];
      if (previous.type === 'text' && previous.content === '=') {
        loneMarkers.push(end.token - 1);
      }
    }

    // Move lone `=` markers after the closing tag, same as strikethrough
    while (loneMarkers.length > 0) {
      const index = loneMarkers.pop() as number;
      let next = index + 1;
      while (next < state.tokens.length && state.tokens[next].type === 'mark_close') {
        next += 1;
      }

      next -= 1;
      if (index !== next) {
        const token = state.tokens[next];
        state.tokens[next] = state.tokens[index];
        state.tokens[index] = token;
      }
    }
  };

  process(state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) {
      process(meta.delimiters);
    }
  }

  return true;
}
