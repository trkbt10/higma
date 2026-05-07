/**
 * @file Trigger a browser download for an in-memory `Blob`.
 *
 * The implementation deliberately avoids the VS Code save-dialog
 * channel: this viewer is read-only and runs the same way in the
 * extension webview and in `bun run dev:ui`. A blob-URL anchor click
 * is the lowest-common-denominator path that works in both.
 */






export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke after the click microtask drains so Safari/Firefox have
  // time to start the download. 5s is generous and not user-visible.
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}






export function buildExportFileName(params: {
  readonly baseName: string;
  readonly suffix: string;
  readonly extension: "png" | "jpg" | "svg";
}): string {
  const safeBase = sanitiseFileName(params.baseName) || "export";
  const safeSuffix = sanitiseFileName(params.suffix);
  const join = safeSuffix.length > 0 ? `${safeBase}${safeSuffix}` : safeBase;
  return `${join}.${params.extension}`;
}

function sanitiseFileName(value: string): string {
  // Strip path separators and characters Windows reserves for paths.
  // Whitespace is collapsed to a single space rather than removed so
  // a suffix like " @1x" still produces "Rectangle 1 @1x.png" instead
  // of "Rectangle1@1x.png".
  return value
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
