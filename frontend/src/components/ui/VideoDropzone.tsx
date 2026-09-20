'use client';

import { useRef, useState } from 'react';
import { uploadFile } from '@/lib/uploadFile';
import { ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: 'That video is too large — try one under 100MB.',
  INVALID_MIME: 'Unsupported file type — use MP4, WebM or MOV.',
  MAGIC_BYTE_MISMATCH: "That file doesn't look like a real video. Try a different one.",
  STORAGE_NOT_CONFIGURED: 'Video storage isn’t configured yet — contact support.',
};

function describeUploadError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 403) {
      return 'Your session expired — refresh the page and try again.';
    }
    const code = typeof err.body?.code === 'string' ? err.body.code : err.code;
    return UPLOAD_ERROR_MESSAGES[code] ?? 'Upload failed. Try again.';
  }
  return 'Network error. Try again.';
}

/** Mirrors ImageDropzone, but posts to the SUPERADMIN-only video upload
 * route and previews with a native <video> player instead of <img>. */
export function VideoDropzone({
  label,
  hint,
  value = null,
  onUploaded,
  onRemove,
}: {
  label: string;
  hint?: string;
  /** Current video URL — set when editing a slot that already has one. */
  value?: string | null;
  onUploaded: (url: string) => void;
  /** Omit to hide the remove control (e.g. nothing to remove yet). */
  onRemove?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setUploading(true);
    try {
      const { url } = await uploadFile(file, '/api/admin/upload-video');
      onUploaded(url);
    } catch (err) {
      setError(describeUploadError(err));
    } finally {
      setUploading(false);
    }
  }

  if (value) {
    return (
      <div>
        <video
          src={value}
          controls
          className="aspect-video w-full max-w-sm rounded-lg border border-border bg-black"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="text-xs font-medium text-primary"
          >
            {uploading ? 'Uploading…' : 'Replace video'}
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} className="text-xs font-medium text-red-600">
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm,video/quicktime"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />
        {error && (
          <p role="alert" className="mt-1.5 text-xs text-red-600">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="w-full rounded-lg border-2 border-dashed border-border bg-secondary px-6 py-8 text-center"
      >
        <Icon i="film" size={28} className="mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">{uploading ? 'Uploading…' : label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
