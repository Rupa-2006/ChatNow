import path from 'node:path';

export type SniffedFile = {
  mimeType: string;
  extension: string;
  isImage: boolean;
  width: number | null;
  height: number | null;
};

const OFFICE_EXT_TO_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

const AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * Parses basic dimensions from PNG, GIF, JPEG, or WebP headers without external native libraries.
 */
function parseImageDimensions(buf: Buffer, mimeType: string): { width: number | null; height: number | null } {
  try {
    if (mimeType === 'image/png' && buf.length >= 24) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mimeType === 'image/gif' && buf.length >= 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
    if (mimeType === 'image/webp' && buf.length >= 30) {
      const chunk = buf.toString('ascii', 12, 16);
      if (chunk === 'VP8 ' && buf.length >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (chunk === 'VP8L' && buf.length >= 25) {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X' && buf.length >= 30) {
        const w = 1 + (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16));
        const h = 1 + (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16));
        return { width: w, height: h };
      }
    }
    if (mimeType === 'image/jpeg') {
      let offset = 2;
      while (offset + 9 < buf.length) {
        if (buf[offset] !== 0xff) break;
        const marker = buf[offset + 1]!;
        if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
          return { width: buf.readUInt16BE(offset + 7), height: buf.readUInt16BE(offset + 5) };
        }
        const segLen = buf.readUInt16BE(offset + 2);
        if (segLen < 2) break;
        offset += 2 + segLen;
      }
    }
  } catch {
    // Ignore malformed dimension headers
  }
  return { width: null, height: null };
}

/**
 * Checks whether a buffer looks like valid UTF-8 plain text (no NUL bytes, mostly printable/whitespace).
 */
function isSafePlainText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  let controlCount = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const b = sample[i]!;
    if (b === 0x00) return false;
    if (b < 0x09 || (b > 0x0d && b < 0x20)) controlCount += 1;
  }
  return controlCount / sample.length < 0.02;
}

/**
 * Detects file type strictly from magic bytes (never trusting client-supplied Content-Type).
 * Rejects executables, SVG/HTML (stored XSS vectors), and unknown binary formats.
 */
export function sniffFileContent(buf: Buffer, originalName: string): SniffedFile | null {
  const ext = path.extname(originalName).toLowerCase();

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    const dims = parseImageDimensions(buf, 'image/png');
    return { mimeType: 'image/png', extension: '.png', isImage: true, ...dims };
  }

  // JPEG: FF D8 FF
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    const dims = parseImageDimensions(buf, 'image/jpeg');
    return { mimeType: 'image/jpeg', extension: '.jpg', isImage: true, ...dims };
  }

  // GIF: GIF87a / GIF89a
  if (buf.length >= 6 && (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a')) {
    const dims = parseImageDimensions(buf, 'image/gif');
    return { mimeType: 'image/gif', extension: '.gif', isImage: true, ...dims };
  }

  // WebP: RIFF....WEBP
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const dims = parseImageDimensions(buf, 'image/webp');
    return { mimeType: 'image/webp', extension: '.webp', isImage: true, ...dims };
  }

  // PDF: %PDF-
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') {
    return { mimeType: 'application/pdf', extension: '.pdf', isImage: false, width: null, height: null };
  }

  // ZIP / OOXML (docx, xlsx, pptx): PK\x03\x04
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
    const mapped = OFFICE_EXT_TO_MIME[ext] ?? 'application/zip';
    const safeExt = ext in OFFICE_EXT_TO_MIME ? ext : '.zip';
    return { mimeType: mapped, extension: safeExt, isImage: false, width: null, height: null };
  }

  // Plain text (.txt, .csv, .md, .json) — strictly reject HTML/SVG/JS extensions
  if (['.txt', '.csv', '.md', '.json'].includes(ext) && isSafePlainText(buf)) {
    const mime = ext === '.csv' ? 'text/csv' : 'text/plain';
    return { mimeType: mime, extension: ext, isImage: false, width: null, height: null };
  }

  return null;
}

export function isAllowedAvatarMime(mimeType: string): boolean {
  return AVATAR_MIMES.has(mimeType);
}

/** Strips path separators and control chars so the stored originalName is safe in Content-Disposition. */
export function sanitizeFilename(raw: string): string {
  const base = path.basename(raw).replace(/[\r\n\0"\\]/g, '_').trim();
  return (base || 'file').slice(0, 200);
}
