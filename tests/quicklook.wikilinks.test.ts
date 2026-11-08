// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { renderMarkdown } from '../src/render';
import { highlightSourceWikilinks } from '../src/quicklook/wikilinks';

// Lite host (Quick Look): no MarkEdit API
vi.mock('markedit-api', () => ({ MarkEdit: {} }));

describe('Quick Look preview', () => {
  it('renders wikilinks itself', async () => {
    const html = await renderMarkdown('See [[Other Note|alias]], [[Folder/Note#Part]] and `[[code]]`', false);
    expect(html).toContain('<a class="me-wikilink" data-wikilink-target="Other Note" href="#">alias</a>');
    expect(html).toContain('<a class="me-wikilink" data-wikilink-target="Folder/Note#Part" href="#">Folder/Note#Part</a>');
    expect(html).toContain('<code>[[code]]</code>');
  });

  it('escapes wikilink targets', async () => {
    const html = await renderMarkdown('[["><img src=x onerror=alert(1)>]]', false);
    expect(html).not.toContain('<img');
  });
});

describe('Quick Look source highlighting', () => {
  class FakeHighlight extends Set<Range> {
    priority = 0;
  }

  const registry = new Map<string, FakeHighlight>();
  const texts = (name: string) => [...(registry.get(name) ?? [])].map(range => range.toString());

  beforeAll(() => {
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights: registry });
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0));
  });

  it('highlights wikilinks, embeds and their marks, skipping code', async () => {
    document.body.innerHTML = `
      <div class="cm-content">
        <div class="cm-line">Go to <span class="cm-md-bold">[[Some</span> Note|alias]] now</div>
        <div class="cm-line">![[pic.png|300]] and <span class="cm-md-inlineCode">[[inline]]</span></div>
        <div class="cm-line cm-md-codeBlock">[[fenced]]</div>
      </div>`;

    highlightSourceWikilinks();
    expect(texts('markedit-wikilink')).toEqual(['[[Some Note|alias]]']);
    expect(texts('markedit-wikilink-embed')).toEqual(['![[pic.png|300]]']);
    expect(texts('markedit-wikilink-mark')).toEqual(['[[', ']]', 'Some Note|', '![[', ']]', '|300']);
    expect(registry.get('markedit-wikilink-mark')?.priority).toBe(1);

    // CodeMirror renders more lines when scrolling
    const line = document.createElement('div');
    line.className = 'cm-line';
    line.textContent = 'More [[Later]]';
    document.querySelector('.cm-content')?.appendChild(line);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(texts('markedit-wikilink')).toEqual(['[[Some Note|alias]]', '[[Later]]']);
  });
});
