import { MarkEdit } from 'markedit-api';
import { resolveImageURL } from './image';

/**
 * Obsidian-style resolution of `[[wikilinks]]` and `![[embeds]]` across a vault.
 *
 * Mirrors MarkEdit-wikilinks, so the preview agrees with where a click goes:
 *   1. the current note's folder,
 *   2. a vault-relative path when the target contains `/`,
 *   3. any file with that name in the vault.
 *
 * The vault root is the closest folder containing `.obsidian`, `.git` or `.markedit-vault`.
 */

// Same as MarkEdit-wikilinks
const vaultMarkers = ['.obsidian', '.git', '.markedit-vault'];
const noteExtensions = ['.md', '.markdown', '.mdown', '.txt'];
const skippedFolders = new Set(['node_modules', 'dist', 'build', 'target']);
const maxParentLevels = 12;

const indexBudget = 20_000;
const indexMaxAge = 30_000;
const indexRetryAge = 5_000;

export const unresolvedClass = 'is-unresolved';

export interface VaultIndex {
  root: string;
  builtAt: number;
  // Lowercased vault-relative path → vault-relative path, macOS and Obsidian ignore case
  paths: Map<string, string>;
  // Lowercased file name → vault-relative paths, in MarkEdit-wikilinks' search order
  names: Map<string, string[]>;
  // False when a folder couldn't be listed or the budget ran out, then misses aren't certain
  complete: boolean;
}

/**
 * After the preview renders: point image embeds at their files and mark links to missing notes.
 *
 * @param isCurrent Returns false once a newer render replaced this one.
 */
export async function resolveVaultLinks(container: HTMLElement, isCurrent: () => boolean = () => true) {
  if (typeof MarkEdit.listFiles !== 'function' || typeof MarkEdit.getFileInfo !== 'function') {
    return;
  }

  // Also gives MarkEdit-wikilinks' observer the chance to turn [[…]] text into links first
  const fileInfo = await MarkEdit.getFileInfo();
  if (fileInfo === undefined || !isCurrent()) {
    return;
  }

  const images = [...container.querySelectorAll<HTMLImageElement>('img[data-embed-target]')];
  const links = [...container.querySelectorAll<HTMLAnchorElement>('a.me-wikilink[data-wikilink-target]')];
  if (images.length === 0 && links.length === 0) {
    return;
  }

  const noteFolder = fileInfo.parentPath || dirname(fileInfo.filePath);
  const resolver = await createResolver(noteFolder);
  if (resolver === undefined || !isCurrent()) {
    return;
  }

  for (const image of images) {
    const result = await resolver.resolve(image.dataset.embedTarget ?? '', false);
    if (!isCurrent()) {
      return;
    }

    if (result.path !== undefined) {
      const source = relativePath(noteFolder, result.path);
      if (source !== image.dataset.embedTarget) {
        image.src = resolveImageURL(encodeURI(source));
      }

      image.title = resolver.displayPath(result.path);
    } else if (result.certain) {
      image.classList.add(unresolvedClass);
      image.title = `${image.dataset.embedTarget} wasn't found in this vault`;
    }
  }

  for (const link of links) {
    const result = await resolver.resolve(link.dataset.wikilinkTarget ?? '', true);
    if (!isCurrent()) {
      return;
    }

    link.classList.toggle(unresolvedClass, result.path === undefined && result.certain);
    if (result.path !== undefined) {
      link.title = resolver.displayPath(result.path);
    }
  }
}

export interface Resolution {
  // Absolute path of the file, when found
  path?: string;
  // Whether a miss is certain, false when the vault couldn't be fully listed
  certain: boolean;
}

export async function createResolver(noteFolder: string) {
  const root = await findVaultRoot(noteFolder);
  let index = root === undefined ? undefined : await vaultIndex(root);

  return {
    root,
    displayPath(path: string) {
      return root !== undefined && path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
    },
    async resolve(rawTarget: string, isNote: boolean): Promise<Resolution> {
      const target = rawTarget.split(/[#^|]/)[0].trim();
      if (target === '') {
        return { certain: false };
      }

      const candidates = isNote && !hasExtension(target) ? noteExtensions.map(ext => target + ext) : [target];
      if (root === undefined || index === undefined) {
        return resolveInFolder(noteFolder, candidates);
      }

      let path = lookup(index, root, noteFolder, candidates);
      if (path === undefined && Date.now() - index.builtAt > indexRetryAge) {
        // The file may have been added since the index was built
        index = await vaultIndex(root, true);
        path = lookup(index, root, noteFolder, candidates);
      }

      return { path, certain: index.complete };
    },
  };
}

export function lookup(index: VaultIndex, root: string, noteFolder: string, candidates: string[]) {
  const absolute = (relative: string) => `${root}/${relative}`;
  const folder = noteFolder === root ? '' : noteFolder.startsWith(root + '/') ? noteFolder.slice(root.length + 1) : undefined;

  // 1. Next to the note
  if (folder !== undefined) {
    for (const candidate of candidates) {
      const hit = index.paths.get(normalize(folder === '' ? candidate : `${folder}/${candidate}`));
      if (hit !== undefined) {
        return absolute(hit);
      }
    }
  }

  // 2. Vault-relative path
  for (const candidate of candidates.filter(path => path.includes('/'))) {
    const hit = index.paths.get(normalize(candidate.replace(/^\/+/, '')));
    if (hit !== undefined) {
      return absolute(hit);
    }
  }

  // 3. Anywhere in the vault, the first match in MarkEdit-wikilinks' search order
  for (const candidate of candidates) {
    const name = candidate.slice(candidate.lastIndexOf('/') + 1);
    const first = index.names.get(name.toLowerCase())?.[0];
    if (first !== undefined) {
      return absolute(first);
    }
  }

  return undefined;
}

// MARK: - Vault index

const indexes = new Map<string, Promise<VaultIndex>>();

export function vaultIndex(root: string, refresh = false): Promise<VaultIndex> {
  const cached = indexes.get(root);
  if (cached !== undefined && !refresh) {
    return cached.then(index => Date.now() - index.builtAt < indexMaxAge ? index : vaultIndex(root, true));
  }

  const building = buildIndex(root);
  indexes.set(root, building);
  building.catch(() => indexes.delete(root));
  return building;
}

export function clearVaultCaches() {
  indexes.clear();
  vaultRoots.clear();
}

async function buildIndex(root: string): Promise<VaultIndex> {
  const index: VaultIndex = { root, builtAt: Date.now(), paths: new Map(), names: new Map(), complete: true };
  const folders = [''];
  let budget = indexBudget;

  while (folders.length > 0) {
    const folder = folders.pop() as string;
    const entries = await MarkEdit.listFiles(folder === '' ? root : `${root}/${folder}`);
    if (entries === undefined) {
      index.complete = false;
      continue;
    }

    // Depth-first in listing order, a folder's files before its subfolders, like MarkEdit-wikilinks
    const subfolders: string[] = [];
    for (const entry of entries) {
      if (--budget < 0) {
        index.complete = false;
        return index;
      }

      if (entry.startsWith('.') || skippedFolders.has(entry)) {
        continue;
      }

      const relative = folder === '' ? entry : `${folder}/${entry}`;
      // Only folders need a round trip, names with an extension are files
      if (!hasExtension(entry) && (await MarkEdit.getFileInfo(`${root}/${relative}`))?.isDirectory === true) {
        subfolders.push(relative);
        continue;
      }

      index.paths.set(relative.toLowerCase(), relative);
      const name = entry.toLowerCase();
      index.names.set(name, [...(index.names.get(name) ?? []), relative]);
    }

    folders.push(...subfolders.reverse());
  }

  return index;
}

// MARK: - Helpers

const vaultRoots = new Map<string, Promise<string | undefined>>();

export function findVaultRoot(start: string) {
  const cached = vaultRoots.get(start);
  if (cached !== undefined) {
    return cached;
  }

  const finding = (async () => {
    let folder = start;
    for (let level = 0; level < maxParentLevels && folder !== ''; level += 1) {
      const entries = await MarkEdit.listFiles(folder);
      if (entries?.some(entry => vaultMarkers.includes(entry)) === true) {
        return folder;
      }

      const parent = dirname(folder);
      if (parent === folder) {
        break;
      }

      folder = parent;
    }

    return undefined;
  })();

  vaultRoots.set(start, finding);
  return finding;
}

// Outside a vault, only the note's own folder is checked, like MarkEdit-wikilinks
async function resolveInFolder(folder: string, candidates: string[]): Promise<Resolution> {
  for (const candidate of candidates) {
    const path = candidate.startsWith('/') ? candidate : `${folder}/${candidate}`;
    if (await MarkEdit.getFileInfo(path) !== undefined) {
      return { path, certain: true };
    }
  }

  return { certain: (await MarkEdit.listFiles(folder)) !== undefined };
}

export function relativePath(from: string, to: string) {
  const fromParts = from.split('/').filter(Boolean);
  const toParts = to.split('/').filter(Boolean);
  let shared = 0;
  while (shared < fromParts.length && shared < toParts.length && fromParts[shared] === toParts[shared]) {
    shared += 1;
  }

  return [...fromParts.slice(shared).map(() => '..'), ...toParts.slice(shared)].join('/');
}

function dirname(path: string) {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '' : path.slice(0, index);
}

// An extension starts with a letter, so folders like `2024.10` aren't mistaken for files
function hasExtension(name: string) {
  return /\.[a-zA-Z][a-zA-Z0-9]{0,7}$/.test(name);
}

function normalize(path: string) {
  return path.toLowerCase();
}
