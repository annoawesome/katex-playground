/**
 * Exporting documents, entirely client-side.
 *
 *  • Raw source: a Blob download of the `.tex` text.
 *  • PDF: the browser's own print pipeline. The print stylesheet in
 *    styles.css hides everything except the rendered preview, so "Save as
 *    PDF" in the print dialog produces a clean, vector, selectable-text PDF
 *    with KaTeX's fonts embedded — no PDF library or server needed.
 */

/** Turns a document name into a safe file name (without extension). */
export function sanitizeFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "") // characters forbidden on common file systems
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .slice(0, 100)
    .trim();
  return cleaned || "document";
}

/** Ensures `name` ends with `.ext`. */
export function withExtension(name: string, ext: string): string {
  const base = sanitizeFilename(name);
  return base.toLowerCase().endsWith(`.${ext}`) ? base : `${base}.${ext}`;
}

/** Triggers a download of `text` as a file. */
export function downloadText(filename: string, text: string, mime = "application/x-tex"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Opens the print dialog for the preview. The page title becomes the
 * suggested PDF file name in most browsers, so it is set temporarily.
 */
export function printToPdf(documentName: string): void {
  const previousTitle = document.title;
  document.title = sanitizeFilename(documentName);
  const restore = () => {
    document.title = previousTitle;
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  window.print();
}

/** Reads a user-chosen file as text (for "Open file…"). */
export function readFileAsText(file: File): Promise<string> {
  return file.text();
}
