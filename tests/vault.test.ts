// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A fake file system: folders end with '/'
const files = new Set<string>();
const unlistable = new Set<string>();
const state = { currentFile: '/vault/Notes/Daily.md' };

vi.mock('markedit-api', () => ({
  MarkEdit: {
    listFiles: async (path: string) => {
      if (unlistable.has(path)) {
        return undefined;
      }

      const prefix = path.endsWith('/') ? path : path + '/';
      const entries = new Set<string>();
      for (const file of files) {
        if (file.startsWith(prefix) && file !== prefix) {
          entries.add(file.slice(prefix.length).split('/')[0]);
        }
      }

      return entries.size === 0 && ![...files].some(file => file === prefix) ? undefined : [...entries];
    },
    getFileInfo: async (path?: string) => {
      const filePath = path ?? state.currentFile;
      const isDirectory = files.has(filePath + '/');
      if (!isDirectory && !files.has(filePath)) {
        return undefined;
      }

      return { filePath, parentPath: filePath.slice(0, filePath.lastIndexOf('/')), isDirectory };
    },
  },
}));

const { resolveVaultLinks, createResolver, findVaultRoot, relativePath, clearVaultCaches, unresolvedClass } = await import('../src/features/vault');

function addFiles(...paths: string[]) {
  for (const path of paths) {
    files.add(path);
    // Register every parent folder
    const parts = path.split('/').filter(Boolean);
    for (let index = 1; index < parts.length; index += 1) {
      files.add('/' + parts.slice(0, index).join('/') + '/');
    }
  }
}

beforeEach(() => {
  files.clear();
  unlistable.clear();
  clearVaultCaches();
  state.currentFile = '/vault/Notes/Daily.md';
  addFiles(
    '/vault/.obsidian/app.json',
    '/vault/Notes/Daily.md',
    '/vault/Notes/Website.md',
    '/vault/Notes/sub/Deep Note.md',
    '/vault/Attachments/pic.png',
    '/vault/Attachments/my pic.png',
    '/vault/Projects/Website.md',
    '/vault/Projects/Plan.md',
    '/vault/Archive/Projects/Plan.md',
    '/vault/2024.10/Trip.md',
    '/vault/node_modules/pkg/Hidden.md',
    '/vault/.trash/Deleted.md',
  );
});

afterEach(() => {
  vi.useRealTimers();
});

describe('relativePath', () => {
  it('walks up and down between folders', () => {
    expect(relativePath('/vault/Notes', '/vault/Attachments/pic.png')).toBe('../Attachments/pic.png');
    expect(relativePath('/vault/Notes', '/vault/Notes/sub/a.png')).toBe('sub/a.png');
    expect(relativePath('/vault', '/vault/a.png')).toBe('a.png');
  });
});

describe('findVaultRoot', () => {
  it('finds the closest folder with a vault marker', async () => {
    expect(await findVaultRoot('/vault/Notes/sub')).toBe('/vault');
  });

  it('returns undefined outside a vault', async () => {
    addFiles('/loose/Note.md');
    expect(await findVaultRoot('/loose')).toBeUndefined();
  });
});

describe('createResolver', () => {
  const resolve = async (target: string, isNote = true, folder = '/vault/Notes') => {
    return (await createResolver(folder)).resolve(target, isNote);
  };

  it('prefers the note folder, like MarkEdit-wikilinks', async () => {
    expect((await resolve('Website')).path).toBe('/vault/Notes/Website.md');
    expect((await resolve('Website', true, '/vault/Archive')).path).toBe('/vault/Notes/Website.md');
  });

  it('picks the same duplicate as MarkEdit-wikilinks, depth-first in listing order', async () => {
    addFiles('/vault/Notes/sub/Report.md', '/vault/Projects/Report.md');
    expect((await resolve('Report', true, '/vault/Archive')).path).toBe('/vault/Notes/sub/Report.md');
  });

  it('resolves vault-relative paths', async () => {
    expect((await resolve('Archive/Projects/Plan')).path).toBe('/vault/Archive/Projects/Plan.md');
    expect((await resolve('Projects/Plan')).path).toBe('/vault/Projects/Plan.md');
  });

  it('finds files anywhere in the vault, ignoring case', async () => {
    expect((await resolve('deep note')).path).toBe('/vault/Notes/sub/Deep Note.md');
    expect((await resolve('Trip')).path).toBe('/vault/2024.10/Trip.md');
    expect((await resolve('pic.png', false)).path).toBe('/vault/Attachments/pic.png');
  });

  it('strips headings, block IDs and aliases', async () => {
    expect((await resolve('Plan#Goals')).path).toBe('/vault/Projects/Plan.md');
    expect((await resolve('Plan#^block')).path).toBe('/vault/Projects/Plan.md');
    expect((await resolve('Plan|alias')).path).toBe('/vault/Projects/Plan.md');
  });

  it('skips hidden folders and build folders', async () => {
    expect(await resolve('Hidden')).toEqual({ path: undefined, certain: true });
    expect(await resolve('Deleted')).toEqual({ path: undefined, certain: true });
  });

  it('is unsure about misses when a folder can\'t be listed', async () => {
    unlistable.add('/vault/Projects');
    expect(await resolve('Missing')).toEqual({ path: undefined, certain: false });
  });

  it('only checks the note folder outside a vault', async () => {
    addFiles('/loose/Note.md', '/loose/Other.md');
    expect((await resolve('Other', true, '/loose')).path).toBe('/loose/Other.md');
    expect(await resolve('Website', true, '/loose')).toEqual({ certain: true });
  });

  it('picks up new files after a miss', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    expect((await resolve('New')).path).toBeUndefined();

    addFiles('/vault/Inbox/New.md');
    expect((await resolve('New')).path).toBeUndefined(); // Too soon to rebuild

    vi.setSystemTime(Date.now() + 6_000);
    expect((await resolve('New')).path).toBe('/vault/Inbox/New.md');
  });
});

describe('resolveVaultLinks', () => {
  const render = () => {
    const container = document.createElement('div');
    container.innerHTML = `
      <img src="image-loader://pic.png" data-embed-target="pic.png">
      <img src="image-loader://my%20pic.png" data-embed-target="my pic.png">
      <img src="image-loader://gone.png" data-embed-target="gone.png">
      <a class="me-wikilink" data-wikilink-target="Deep Note" href="#">Deep Note</a>
      <a class="me-wikilink" data-wikilink-target="Nowhere" href="#">Nowhere</a>
      <a class="me-wikilink obsidian-embed" data-wikilink-target="Plan#Goals" href="#">Plan</a>`;
    return container;
  };

  it('points image embeds at their files and marks missing ones', async () => {
    const container = render();
    await resolveVaultLinks(container);

    const [pic, spaced, gone] = container.querySelectorAll('img');
    expect(pic.getAttribute('src')).toBe('image-loader://../Attachments/pic.png');
    expect(pic.title).toBe('Attachments/pic.png');
    expect(spaced.getAttribute('src')).toBe('image-loader://../Attachments/my%20pic.png');
    expect(gone.classList.contains(unresolvedClass)).toBe(true);
  });

  it('marks links to missing notes', async () => {
    const container = render();
    await resolveVaultLinks(container);

    const [deep, nowhere, plan] = container.querySelectorAll('a');
    expect(deep.classList.contains(unresolvedClass)).toBe(false);
    expect(deep.title).toBe('Notes/sub/Deep Note.md');
    expect(nowhere.classList.contains(unresolvedClass)).toBe(true);
    expect(plan.classList.contains(unresolvedClass)).toBe(false);
  });

  it('stops when a newer render replaced this one', async () => {
    const container = render();
    await resolveVaultLinks(container, () => false);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('image-loader://pic.png');
    expect(container.querySelector(`.${unresolvedClass}`)).toBeNull();
  });

  it('does nothing for unsaved notes', async () => {
    state.currentFile = '/vault/Unsaved.md';
    const container = render();
    await resolveVaultLinks(container);
    expect(container.querySelector(`.${unresolvedClass}`)).toBeNull();
  });
});
