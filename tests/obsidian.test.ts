import { describe, it, expect, vi } from 'vitest';
import { renderMarkdown } from '../src/render';

// Full host: plain wikilinks are left to MarkEdit-wikilinks
vi.mock('markedit-api', () => ({ MarkEdit: { addExtension: () => {} } }));

const render = (markdown: string) => renderMarkdown(markdown, false);

describe('Obsidian callouts', () => {
  it('keeps GitHub alerts working', async () => {
    const html = await render('> [!NOTE]\n> Hello');
    expect(html).toContain('class="markdown-alert markdown-alert-note"');
    expect(html).toContain('Note</span>');
    expect(html).toContain('<p>Hello</p>');
  });

  it('supports Obsidian types, aliases and custom titles with inline markdown', async () => {
    const html = await render('> [!faq] Why **this**?\n> Because');
    expect(html).toContain('markdown-alert-question');
    expect(html).toContain('data-callout="faq"');
    expect(html).toContain('Why <strong>this</strong>?');
    expect(html).toContain('<p>Because</p>');
  });

  it('falls back to note for unknown types', async () => {
    const html = await render('> [!custom-thing]\n> Body');
    expect(html).toContain('markdown-alert-note');
    expect(html).toContain('data-callout="custom-thing"');
    expect(html).toContain('Custom-thing');
  });

  it('renders foldable callouts as details', async () => {
    const collapsed = await render('> [!tip]- Click me\n> Hidden');
    expect(collapsed).toMatch(/^<details class="markdown-alert markdown-alert-tip"[^>]*>/);
    expect(collapsed).not.toContain(' open');
    expect(collapsed).toContain('<summary class="markdown-alert-title">');
    expect(collapsed.trim().endsWith('</details>')).toBe(true);

    const expanded = await render('> [!tip]+ Click me\n> Shown');
    expect(expanded).toMatch(/<details[^>]* open/);
  });

  it('balances nested callouts', async () => {
    const html = await render('> [!note] Outer\n> > [!warning] Inner\n> > Inner body\n>\n> Outer body');
    expect(html).toContain('markdown-alert-warning');
    expect(html).not.toContain('<blockquote');
    expect((html.match(/<div/g) ?? []).length).toBe((html.match(/<\/div>/g) ?? []).length);
  });

  it('renders title-only callouts without an empty paragraph', async () => {
    const html = await render('> [!success] Done');
    expect(html).not.toContain('<p></p>');
  });

  it('keeps line info for sync scroll', async () => {
    const html = await renderMarkdown('text\n\n> [!info]\n> Body');
    expect(html).toMatch(/<div[^>]*data-line-from="2"[^>]*data-line-to="3"/);
  });

  it('renders the footnote list once, outside callout titles', async () => {
    const html = await render('> [!note] Title\n> Body[^1]\n\n[^1]: Footnote');
    expect((html.match(/class="footnotes"/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<p class="markdown-alert-title">.*<span class="markdown-alert-title-inner">Title<\/span><\/p>/);
  });

  it('leaves normal blockquotes alone', async () => {
    const html = await render('> just a quote');
    expect(html).toContain('<blockquote>');
  });
});

describe('Obsidian highlights', () => {
  it('renders ==text== as mark', async () => {
    expect(await render('a ==b *c*== d')).toContain('a <mark>b <em>c</em></mark> d');
  });

  it('ignores single equals and code', async () => {
    const html = await render('a = b, `==x==`');
    expect(html).not.toContain('<mark>');
  });
});

describe('Obsidian comments', () => {
  it('hides inline comments', async () => {
    const html = await render('visible %%hidden%% text');
    expect(html).not.toContain('hidden');
    expect(html).toContain('visible  text');
  });

  it('hides block comments spanning lines and paragraphs', async () => {
    const html = await render('before\n\n%%\nsecret\n\nmore secret\n%%\n\nafter');
    expect(html).not.toContain('secret');
    expect(html).toContain('<p>before</p>');
    expect(html).toContain('<p>after</p>');
  });

  it('keeps comments inside code', async () => {
    const html = await render('```\n%% kept %%\n```\n\n`%%inline%%`');
    expect(html).toContain('%% kept %%');
    expect(html).toContain('%%inline%%');
  });

  it('keeps unterminated markers', async () => {
    expect(await render('100%% sure')).toContain('100%% sure');
  });
});

describe('Obsidian tags', () => {
  it('renders tags', async () => {
    const html = await render('Some #tag and #nested/tag-2');
    expect(html).toContain('<span class="tag" data-tag="tag">#tag</span>');
    expect(html).toContain('data-tag="nested/tag-2"');
  });

  it('ignores headings, numbers, anchors and code', async () => {
    const html = await render('# Heading\n\nIssue #123, [link](#anchor), a#b, `#code`');
    expect(html).not.toContain('class="tag"');
    expect(html).toContain('<h1');
  });
});

describe('Obsidian block IDs', () => {
  it('moves trailing block IDs to the paragraph id', async () => {
    const html = await render('A paragraph ^my-id');
    expect(html).toContain('<p id="^my-id">A paragraph</p>');
  });

  it('assigns list item block IDs to the item', async () => {
    const html = await render('- item ^abc');
    expect(html).toContain('<li id="^abc">item</li>');
  });

  it('assigns standalone block IDs to the preceding block', async () => {
    const html = await render('| a |\n| - |\n| b |\n\n^table-id');
    expect(html).toContain('<table id="^table-id">');
    expect(html).not.toContain('<p');
  });

  it('does not touch footnotes', async () => {
    const html = await render('Text[^1]\n\n[^1]: Note');
    expect(html).toContain('footnote');
  });

  it('links to block IDs and headings in the same note', async () => {
    const html = await render('## My Heading\n\n[[#My Heading]] [[#^abc|block]]');
    expect(html).toContain('<a href="#my-heading">My Heading</a>');
    expect(html).toContain('<a href="#^abc">block</a>');
  });
});

describe('Obsidian embeds', () => {
  it('renders image embeds with size', async () => {
    expect(await render('![[my pic.png]]')).toContain('<img src="my%20pic.png" alt="my pic.png" data-embed-target="my pic.png">');
    expect(await render('![[a.jpg|300]]')).toContain('<img src="a.jpg" alt="a.jpg" width="300" data-embed-target="a.jpg">');
    expect(await render('![[a.jpg#section]]')).toContain('data-embed-target="a.jpg"');
    expect(await render('![[a.jpg|300x200]]')).toContain('width="300" height="200"');
    expect(await render('![[a.jpg|A cat]]')).toContain('alt="A cat"');
  });

  it('renders note embeds as wikilinks for MarkEdit-wikilinks', async () => {
    const html = await render('![[Some Note#Section]]');
    expect(html).toContain('<a class="me-wikilink obsidian-embed" data-wikilink-target="Some Note#Section" href="#">Some Note#Section</a>');
  });

  it('escapes embed targets', async () => {
    const html = await render('![["><script>.png]]');
    expect(html).not.toContain('<script>');
  });

  it('leaves plain wikilinks as text for MarkEdit-wikilinks', async () => {
    const html = await render('See [[Other Note|alias]] and [[Folder/Note]]');
    expect(html).toContain('[[Other Note|alias]]');
    expect(html).toContain('[[Folder/Note]]');
  });

  it('keeps wikilink contents intact for MarkEdit-wikilinks', async () => {
    const html = await render('[[__init__]] [[Cost $5 or $10]] [[Note|alias #idea]] [[a ==b==]]');
    expect(html).toContain('[[__init__]] [[Cost $5 or $10]] [[Note|alias #idea]] [[a ==b==]]');
  });

  it('keeps escaped pipes in table wikilinks', async () => {
    const html = await render('| a |\n| - |\n| [[Note\\|alias]] |');
    expect(html).toContain('[[Note|alias]]');
  });
});
