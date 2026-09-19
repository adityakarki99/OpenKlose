/**
 * Rasterizes the sandbox's rendered preview to a PNG, entirely inside the
 * sandbox.
 *
 * The preview iframe runs in an opaque origin (`sandbox="allow-scripts"`), so
 * the parent app cannot read a single pixel of it — any screenshot has to be
 * taken in here and handed back over postMessage.
 *
 * The technique is the same one html2canvas uses for its `foreignObject`
 * renderer: clone the live DOM, inline the document's stylesheets next to the
 * clone, wrap it in an `<svg><foreignObject>`, and let the browser draw that
 * SVG into a canvas. Everything stays local — the SVG is a `data:` URL, which
 * is what the sandbox CSP's `img-src data: blob:` allows, and no network
 * request is made at any point.
 */

// XML namespaces. These are identifiers, not addresses: nothing is fetched
// from them, which matters because the sandbox is not allowed to make requests.
const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

export interface CaptureOptions {
  /** Pixel density of the PNG. 2 matches a retina screenshot. */
  scale?: number;
  /** Painted behind the component, so the PNG is not transparent. */
  background?: string;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * The CSS the clone needs to look like the original: the sandbox's own inline
 * styles plus whatever Tailwind compiled for this component at runtime.
 *
 * A stylesheet served over HTTP is cross-origin to this opaque-origin document,
 * so reading its rules throws; those are skipped. In practice the preview has
 * none — its CSS is either inline in preview.html or generated in-page by
 * @tailwindcss/browser.
 */
function collectStyles(doc: Document): string {
  const sheets: CSSStyleSheet[] = [
    ...Array.from(doc.styleSheets) as CSSStyleSheet[],
    ...((doc.adoptedStyleSheets || []) as CSSStyleSheet[]),
  ];
  const chunks: string[] = [];
  for (const sheet of sheets) {
    try {
      const rules = sheet.cssRules;
      if (!rules) continue;
      for (const rule of Array.from(rules)) chunks.push(rule.cssText);
    } catch {
      // Cross-origin sheet — unreadable by design, and never ours.
    }
  }
  return chunks.join('\n');
}

/**
 * Copies the live state a plain `cloneNode` loses: current form values, and the
 * bitmap of any `<canvas>` (which clones as an empty element).
 */
function copyLiveState(source: Element, clone: Element): void {
  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);

  if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
    clone.setAttribute('value', source.value);
    if (source.checked) clone.setAttribute('checked', 'checked');
    else clone.removeAttribute('checked');
  } else if (source instanceof HTMLTextAreaElement) {
    clone.textContent = source.value;
  } else if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
    Array.from(clone.options).forEach((option, index) => {
      if (source.options[index]?.selected) option.setAttribute('selected', 'selected');
      else option.removeAttribute('selected');
    });
  } else if (source instanceof HTMLCanvasElement) {
    try {
      const image = clone.ownerDocument.createElementNS(XHTML_NS, 'img') as HTMLImageElement;
      image.setAttribute('src', source.toDataURL());
      image.setAttribute('style', `width:${source.width}px;height:${source.height}px`);
      clone.replaceWith(image);
      return;
    } catch {
      // A tainted canvas cannot be read; leave the blank clone in place.
    }
  }

  for (let i = 0; i < sourceChildren.length && i < cloneChildren.length; i += 1) {
    copyLiveState(sourceChildren[i], cloneChildren[i]);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The preview could not be rasterized in this browser.'));
    image.src = src;
  });
}

/**
 * Captures `target` and returns a PNG data URL.
 *
 * Known limits, all inherent to the foreignObject technique: `::before` and
 * `::after` survive (they come from the inlined CSS) but cross-origin images,
 * iframes nested inside the preview, and anything painted by WebGL do not.
 */
export async function capture(target: HTMLElement, options: CaptureOptions = {}): Promise<string> {
  const scale = clamp(options.scale ?? 2, 1, 4);
  const background = options.background || '#0f172a';

  const rect = target.getBoundingClientRect();
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));

  const doc = target.ownerDocument;
  const container = doc.createElementNS(XHTML_NS, 'div') as HTMLDivElement;
  // Typography is inherited from <html>/<body> in the live document, and the
  // foreignObject has neither — so the root's text styles are carried over
  // explicitly, or the capture comes back in the browser's default serif.
  const rootStyle = doc.defaultView?.getComputedStyle(doc.documentElement);
  const inherited = rootStyle
    ? `font-family:${rootStyle.fontFamily};font-size:${rootStyle.fontSize};` +
      `line-height:${rootStyle.lineHeight};color:${rootStyle.color};`
    : '';
  container.setAttribute(
    'style',
    `width:${width}px;height:${height}px;overflow:hidden;background:${background};${inherited}`
  );

  const style = doc.createElementNS(XHTML_NS, 'style') as HTMLStyleElement;
  style.textContent = collectStyles(doc);
  container.appendChild(style);

  const clone = target.cloneNode(true) as HTMLElement;
  copyLiveState(target, clone);
  // The clone keeps its id and classes so the inlined CSS still lays it out the
  // same way (`#root` centres the component). Only the viewport-relative
  // positioning is overridden inline, because inside the foreignObject the
  // clone has to size itself against the container instead.
  clone.style.position = 'relative';
  clone.style.inset = 'auto';
  clone.style.width = `${width}px`;
  clone.style.height = `${height}px`;
  clone.style.margin = '0';
  clone.style.overflow = 'hidden';
  container.appendChild(clone);

  const serialized = new XMLSerializer().serializeToString(container);
  const svg =
    `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="0" y="0" width="${width}" height="${height}">${serialized}</foreignObject>` +
    '</svg>';

  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);

  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser did not provide a 2D canvas for the screenshot.');
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    throw new Error('The preview draws content this browser refuses to export as an image.');
  }
}
