import { appendStyle } from '../shared/utils';

/**
 * Highlight `[[wikilinks]]` and `![[embeds]]` in the Quick Look source view.
 *
 * The lite host has no CodeMirror modules to add decorations with, so this paints ranges
 * with the CSS Custom Highlight API, which never touches the editor's DOM. Lines are
 * re-scanned whenever CodeMirror renders new content (e.g., scrolling a long document).
 */
export function highlightSourceWikilinks(root: ParentNode = document) {
  if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight === 'undefined') {
    return;
  }

  const content = root.querySelector<HTMLElement>('.cm-content');
  if (content === null) {
    // The host may create the editor after this script runs
    const observer = new MutationObserver(() => {
      if (root.querySelector('.cm-content') !== null) {
        observer.disconnect();
        highlightSourceWikilinks(root);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return;
  }

  const highlights = {
    link: new Highlight(),
    embed: new Highlight(),
    mark: new Highlight(),
  };

  highlights.mark.priority = 1;
  CSS.highlights.set(HighlightNames.link, highlights.link);
  CSS.highlights.set(HighlightNames.embed, highlights.embed);
  CSS.highlights.set(HighlightNames.mark, highlights.mark);
  appendStyle(highlightCss);

  const refresh = () => {
    Object.values(highlights).forEach(highlight => highlight.clear());
    content.querySelectorAll<HTMLElement>('.cm-line').forEach(line => highlightLine(line, highlights));
  };

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      refresh();
    });
  });

  refresh();
  observer.observe(content, { childList: true, subtree: true, characterData: true });
}

// MARK: - Internal

const HighlightNames = {
  link: 'markedit-wikilink',
  embed: 'markedit-wikilink-embed',
  mark: 'markedit-wikilink-mark',
};

const wikilinkRE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

type Highlights = { link: Highlight; embed: Highlight; mark: Highlight };
type Segment = { node: Text; start: number };

function highlightLine(line: HTMLElement, highlights: Highlights) {
  if (line.classList.contains('cm-md-codeBlock') || !line.textContent?.includes('[[')) {
    return;
  }

  // Concatenate the line's text nodes, keeping track of where each one starts
  const segments: Segment[] = [];
  let text = '';
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    segments.push({ node, start: text.length });
    text += node.data;
  }

  for (const match of text.matchAll(wikilinkRE)) {
    const from = match.index;
    const to = from + match[0].length;
    const start = locate(segments, from);
    if (start === undefined || (start.node.parentElement?.closest('.cm-md-inlineCode') ?? null) !== null) {
      continue;
    }

    const isEmbed = match[1] === '!';
    const openEnd = from + match[1].length + 2;
    const closeStart = to - 2;

    (isEmbed ? highlights.embed : highlights.link).add(createRange(segments, from, to));
    highlights.mark.add(createRange(segments, from, openEnd));
    highlights.mark.add(createRange(segments, closeStart, to));

    // `[[target|alias]]` dims the target so the alias reads as the link text,
    // `![[file.png|300]]` dims the size so the file name stands out
    const pipe = match[2].indexOf('|');
    if (pipe !== -1) {
      const range = isEmbed ? createRange(segments, openEnd + pipe, closeStart) : createRange(segments, openEnd, openEnd + pipe + 1);
      highlights.mark.add(range);
    }
  }
}

function locate(segments: Segment[], offset: number, preferEnd = false) {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    const inside = preferEnd ? offset > segment.start : offset >= segment.start;
    if (inside && offset <= segment.start + segment.node.length) {
      return { node: segment.node, offset: offset - segment.start };
    }
  }

  return undefined;
}

function createRange(segments: Segment[], from: number, to: number) {
  const range = document.createRange();
  const start = locate(segments, from);
  const end = locate(segments, to, true);
  if (start !== undefined && end !== undefined) {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  }

  return range;
}

const highlightCss = `
::highlight(${HighlightNames.link}),
::highlight(${HighlightNames.embed}) {
  color: #0969da;
  text-decoration: underline;
  text-decoration-color: rgba(9, 105, 218, 0.4);
}

::highlight(${HighlightNames.embed}) {
  background-color: rgba(9, 105, 218, 0.08);
}

::highlight(${HighlightNames.mark}) {
  color: #8c959f;
  text-decoration: none;
}

@media (prefers-color-scheme: dark) {
  ::highlight(${HighlightNames.link}),
  ::highlight(${HighlightNames.embed}) {
    color: #4493f8;
    text-decoration-color: rgba(68, 147, 248, 0.4);
  }

  ::highlight(${HighlightNames.embed}) {
    background-color: rgba(68, 147, 248, 0.12);
  }

  ::highlight(${HighlightNames.mark}) {
    color: #6e7681;
  }
}
`;
