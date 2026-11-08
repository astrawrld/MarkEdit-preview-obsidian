// @vitest-environment happy-dom
import { hiddenTexts, editorText } from './support';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { createHiddenSyntaxExtension, hiddenSyntaxExtension } from '../../src/hiddenSyntax';
import { clearVaultCaches } from '../../src/features/vault';
import { markdownExtensions } from '../support/markdown';
import { wikilinkConfig } from '../support/wikilinks';

const markEditMock = vi.hoisted(() => ({
  playSystemBeep: undefined as (() => void) | undefined,
  listFiles: undefined as ((path: string) => Promise<string[] | undefined>) | undefined,
  getFileInfo: undefined as ((path?: string) => Promise<unknown>) | undefined,
  openFile: undefined as ((path: string) => Promise<boolean>) | undefined,
}));

vi.mock('markedit-api', () => ({ MarkEdit: markEditMock }));

beforeEach(() => {
  markEditMock.playSystemBeep = undefined;
  markEditMock.listFiles = undefined;
  markEditMock.getFileInfo = undefined;
  markEditMock.openFile = undefined;
  clearVaultCaches();
});

// Like MarkEdit with MarkEdit-wikilinks installed, which adds the WikiLink* syntax nodes
function setUp(doc: string, extensions: Extension = hiddenSyntaxExtension, wikilinks = true) {
  const language = markdown({ base: markdownLanguage, extensions: [...markdownExtensions, ...(wikilinks ? [wikilinkConfig] : [])] });
  window.editor = new EditorView({ doc, parent: document.body, extensions: [extensions, language] });
  window.editor.dispatch({ selection: { anchor: doc.length } });
}

const linkButton = () => window.editor.dom.querySelector<HTMLButtonElement>('.cm-md-syntaxHiddenLinkButton');

describe('Wikilink syntax', () => {
  test('hides the brackets of wikilinks', () => {
    setUp('See [[Note]] here.');
    expect(editorText()).toBe('See Note here.');
    expect(hiddenTexts()).toEqual(['[[', ']]']);
  });

  test('shows only the alias of aliased wikilinks', () => {
    setUp('See [[Folder/Note|the note]] here.');
    expect(editorText()).toBe('See the note here.');
    expect(hiddenTexts()).toEqual(['[[Folder/Note|', ']]']);
    expect(linkButton()?.title).toBe('Folder/Note');
  });

  test('reveals the syntax while the cursor is inside', () => {
    setUp('See [[Folder/Note|the note]] here.');
    window.editor.dispatch({ selection: { anchor: 8 } });
    expect(editorText()).toBe('See [[Folder/Note|the note]] here.');
    expect(hiddenTexts()).toEqual([]);
  });

  test('styles the visible text as a link', () => {
    setUp('See [[Note|alias]] here.');
    expect(window.editor.dom.querySelector('.cm-md-syntaxHiddenLinkLabel')?.textContent).toBe('alias');
  });

  test('leaves wikilinks in code alone', () => {
    setUp('`[[Note]]` here.');
    expect(window.editor.dom.querySelector('.cm-md-syntaxHiddenLinkLabel')).toBeNull();
    expect(editorText()).toContain('[[Note]]');
  });

  test('does nothing without MarkEdit-wikilinks', () => {
    setUp('See [[Note]] here.', hiddenSyntaxExtension, false);
    expect(editorText()).toBe('See [[Note]] here.');
    expect(linkButton()).toBeNull();
  });
});

describe('Following wikilinks', () => {
  const vault: Record<string, string[]> = {
    '/vault': ['.obsidian', 'Notes', 'Projects'],
    '/vault/Notes': ['Daily.md'],
    '/vault/Projects': ['Plan.md'],
  };

  beforeEach(() => {
    markEditMock.listFiles = async path => vault[path];
    markEditMock.getFileInfo = async path => {
      const filePath = path ?? '/vault/Notes/Daily.md';
      const parentPath = filePath.slice(0, filePath.lastIndexOf('/'));
      const exists = filePath in vault || vault[parentPath]?.includes(filePath.slice(parentPath.length + 1)) === true;
      return exists ? { filePath, parentPath, isDirectory: filePath in vault } : undefined;
    };
  });

  test('opens the note from its button without moving the cursor', async () => {
    const openFile = vi.fn(async () => true);
    markEditMock.openFile = openFile;
    setUp('See [[Plan|the plan]] here.');
    const selection = window.editor.state.selection;
    linkButton()?.click();

    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith('/vault/Projects/Plan.md'));
    expect(window.editor.state.selection).toEqual(selection);
  });

  test('opens note embeds the same way', async () => {
    const openFile = vi.fn(async () => true);
    markEditMock.openFile = openFile;
    setUp('![[Plan]] after', createHiddenSyntaxExtension(['image']));
    linkButton()?.click();
    await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith('/vault/Projects/Plan.md'));
  });

  test('beeps for notes that don\'t exist', async () => {
    const beep = vi.fn();
    markEditMock.playSystemBeep = beep;
    markEditMock.openFile = vi.fn(async () => true);
    setUp('See [[Missing]] here.');
    linkButton()?.click();
    await vi.waitFor(() => expect(beep).toHaveBeenCalledOnce());
    expect(markEditMock.openFile).not.toHaveBeenCalled();
  });
});

describe('Wikilink embeds', () => {
  test('shows image embeds inline, with their size', () => {
    setUp('![[my pic.png|300]] after', createHiddenSyntaxExtension(['image']));
    const image = window.editor.dom.querySelector<HTMLImageElement>('img.cm-md-syntaxHiddenImage');
    expect(image?.getAttribute('src')).toBe('image-loader://my%20pic.png');
    expect(image?.width).toBe(300);
    expect(image?.alt).toBe('my pic.png');
  });

  test('loads image embeds from wherever they are in the vault', async () => {
    const files: Record<string, string[]> = {
      '/vault': ['.obsidian', 'Notes', 'Attachments'],
      '/vault/Notes': ['Daily.md'],
      '/vault/Attachments': ['pic.png'],
    };
    markEditMock.listFiles = async path => files[path];
    markEditMock.getFileInfo = async path => {
      const filePath = path ?? '/vault/Notes/Daily.md';
      return { filePath, parentPath: filePath.slice(0, filePath.lastIndexOf('/')), isDirectory: filePath in files };
    };

    setUp('![[pic.png]] after', createHiddenSyntaxExtension(['image']));
    await vi.waitFor(() => {
      expect(window.editor.dom.querySelector('img.cm-md-syntaxHiddenImage')?.getAttribute('src')).toBe('image-loader://../Attachments/pic.png');
    });
  });

  test('shows the description of image embeds when images aren\'t rendered inline', () => {
    setUp('![[pic.png|A cat]] after', createHiddenSyntaxExtension([]));
    expect(editorText()).toBe('A cat after');
    expect(hiddenTexts()).toEqual(['![[pic.png|', ']]']);
    expect(window.editor.dom.querySelector('.cm-md-syntaxHiddenImageLabel')?.textContent).toBe('A cat');
    expect(linkButton()?.dataset.kind).toBe('image');
  });

  test('shows the file name of image embeds sized with an alias', () => {
    setUp('![[pic.png|300]] after', createHiddenSyntaxExtension([]));
    expect(editorText()).toBe('pic.png after');
    expect(hiddenTexts()).toEqual(['![[', '|300]]']);
  });

  test('hides note embed brackets and follows them like links', () => {
    setUp('![[Some Note]] after', createHiddenSyntaxExtension(['image']));
    expect(editorText()).toBe('Some Note after');
    expect(hiddenTexts()).toEqual(['![[', ']]']);
    expect(linkButton()?.dataset.kind).toBe('wikilink');
  });

  test('works without MarkEdit-wikilinks', () => {
    setUp('![[Some Note]] after', createHiddenSyntaxExtension(['image']), false);
    expect(editorText()).toBe('Some Note after');
  });

  test('leaves regular images alone', () => {
    setUp('![cat](cat.png) after', createHiddenSyntaxExtension(['image']));
    expect(window.editor.dom.querySelector('img.cm-md-syntaxHiddenImage')?.getAttribute('src')).toBe('image-loader://cat.png');
  });

  test('reveals embeds while the cursor is inside', () => {
    setUp('![[pic.png]] after', createHiddenSyntaxExtension(['image']));
    window.editor.dispatch({ selection: { anchor: 4 } });
    expect(window.editor.dom.querySelector('img.cm-md-syntaxHiddenImage')).toBeNull();
    expect(editorText()).toBe('![[pic.png]] after');
  });
});
