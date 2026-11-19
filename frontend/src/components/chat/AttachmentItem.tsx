import { useEffect, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Loader2 } from 'lucide-react';
import { fetchAttachmentBlob } from '@/services/attachments.api';
import type { Attachment } from '@/types/api';
import { cn } from '@/utils/cn';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AttachmentItemProps {
  attachment: Attachment;
  isOwn?: boolean;
  compact?: boolean;
}

export function AttachmentItem({ attachment, isOwn = false, compact = false }: AttachmentItemProps) {
  const isImage = attachment.mimeType.startsWith('image/');
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(isImage);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!isImage) return;
    let active = true;
    let createdUrl: string | null = null;

    setLoading(true);
    fetchAttachmentBlob(attachment.id)
      .then((blob) => {
        if (!active) return;
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [attachment.id, isImage]);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const blob = await fetchAttachmentBlob(attachment.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.originalName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setDownloading(false);
    }
  };

  if (isImage) {
    return (
      <div className="overflow-hidden rounded-xl border border-black/10 dark:border-white/10">
        {loading ? (
          <div className="flex h-36 w-52 items-center justify-center bg-black/10">
            <Loader2 className="h-5 w-5 animate-spin opacity-70" />
          </div>
        ) : objectUrl ? (
          <a href={objectUrl} target="_blank" rel="noreferrer" className="block">
            <img
              src={objectUrl}
              alt={attachment.originalName}
              className={cn(
                'block object-cover transition-opacity hover:opacity-95',
                compact ? 'h-24 w-full' : 'max-h-64 max-w-full',
              )}
            />
          </a>
        ) : (
          <div className="flex h-24 w-44 items-center justify-center gap-2 bg-black/10 text-xs">
            <ImageIcon className="h-4 w-4" />
            <span>Image unavailable</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={downloading}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer',
        isOwn
          ? 'border-white/20 bg-white/12 text-white hover:bg-white/20'
          : 'border-border-subtle bg-bg-subtle text-text-primary hover:bg-bg-hover',
      )}
    >
      <div
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
          isOwn ? 'bg-white/15' : 'bg-brand-50 text-brand-500',
        )}
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{attachment.originalName}</p>
        <p className={cn('text-[10px]', isOwn ? 'text-indigo-100/80' : 'text-text-muted')}>
          {formatBytes(attachment.sizeBytes)}
        </p>
      </div>
      <Download className="h-3.5 w-3.5 shrink-0 opacity-75" />
    </button>
  );
}
