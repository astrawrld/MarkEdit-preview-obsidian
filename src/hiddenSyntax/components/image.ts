import { WidgetType } from '@codemirror/view';
import { resolveImageURL } from '../../features/image';
import { resolveEmbedSource } from '../../features/vault';

export class InlineImageWidget extends WidgetType {
  constructor(
    private readonly destination: string,
    private readonly label: string,
  ) {
    super();
  }

  toDOM() {
    const image = document.createElement('img');
    image.className = 'cm-md-syntaxHiddenImage';
    image.src = resolveImageURL(this.destination);
    image.alt = this.label;
    image.title = this.destination;
    image.draggable = false;
    return image;
  }

  eq(other: InlineImageWidget) {
    return other.destination === this.destination && other.label === this.label;
  }

  ignoreEvent() {
    return false;
  }
}

/**
 * `![[image.png|300]]`, shown from the note's folder first, then from wherever it is in the vault.
 */
export class WikilinkImageWidget extends WidgetType {
  constructor(
    private readonly path: string,
    private readonly alt: string,
    private readonly width?: string,
    private readonly height?: string,
  ) {
    super();
  }

  toDOM() {
    const image = document.createElement('img');
    image.className = 'cm-md-syntaxHiddenImage';
    image.src = resolveImageURL(encodeURI(this.path));
    image.alt = this.alt;
    image.title = this.path;
    image.draggable = false;

    if (this.width !== undefined) {
      image.width = Number(this.width);
    }

    if (this.height !== undefined) {
      image.height = Number(this.height);
    }

    void resolveEmbedSource(this.path).then(source => {
      if (source !== undefined && source !== this.path) {
        image.src = resolveImageURL(encodeURI(source));
        image.title = source;
      }
    });

    return image;
  }

  eq(other: WikilinkImageWidget) {
    return other.path === this.path && other.alt === this.alt && other.width === this.width && other.height === this.height;
  }

  ignoreEvent() {
    return false;
  }
}
