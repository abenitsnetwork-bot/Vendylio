'use client';

import { useRef, useState } from 'react';
import { uploadFile } from '@/lib/uploadFile';
import { ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';

const UPLOAD_ERROR_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: 'That image is too large — try one under 5MB.',
  INVALID_MIME: 'Unsupported file type — use JPG, PNG or WebP.',
  MAGIC_BYTE_MISMATCH: "That file doesn't look like a real image. Try a different one.",
  STORAGE_NOT_CONFIGURED: 'Photo storage isn’t configured yet — contact support.',
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

export function ImageDropzone({
  label,
  hint,
  value = null,
  onUploaded,
  onRemove,
}: {
  label: string;
  hint?: string;
  /** Current image URL — set when editing something that already has a photo. */
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
      const { url } = await uploadFile(file);
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
        <div className="relative w-fit">
          <img
            src={value}
            alt=""
            className="h-32 w-32 rounded-lg border border-border object-cover"
          />
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove image"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-background"
            >
              <Icon i="x" size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="mt-2 text-xs font-medium text-primary"
        >
          {uploading ? 'Uploading…' : 'Replace photo'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
        <div className="mb-2 text-4xl">📸</div>
        <p className="text-sm text-muted-foreground">{uploading ? 'Uploading…' : label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
