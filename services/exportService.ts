/**
 * Browser-side helpers for getting a preview screenshot out of the app —
 * saved to disk or onto the clipboard.
 */

/** Turns a sketch name into a safe, readable file name stem. */
export function screenshotFileName(name: string): string {
  const stem =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'sketch';
  return `${stem}.png`;
}

/**
 * Decodes a data URL without `fetch`, so nothing about this depends on network
 * or CSP permissions.
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  if (!encoded) throw new Error('Malformed image data.');
  const type = header.match(/data:([^;]+)/)?.[1] || 'image/png';
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

export function downloadDataUrl(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** Copies a PNG data URL to the clipboard as an image. */
export async function copyImageToClipboard(dataUrl: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    throw new Error('This browser cannot copy images to the clipboard.');
  }
  const blob = dataUrlToBlob(dataUrl);
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
}
