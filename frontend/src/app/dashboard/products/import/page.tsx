'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useUser } from '@/contexts/AuthContext';
import { api, ApiError } from '@/lib/api';
import { Icon } from '@/components/ui/Icon';
import { Button } from '@/components/ui/Button';
import { SellerModalHeader } from '@/components/seller/SellerModalHeader';
import { buildCsv } from '@/lib/csv';

interface RowError {
  row: number;
  message: string;
}

interface ImportResult {
  created: number;
  categoriesCreated: number;
}

const TEMPLATE_HEADERS = [
  'name',
  'description',
  'price',
  'quantity',
  'unit',
  'category',
  'imageUrl',
  'lowStockThreshold',
  'status',
];
const TEMPLATE_EXAMPLE = [
  'Heirloom Tomatoes',
  '1 lb bag, vine-ripened',
  '4.50',
  '25',
  'LB',
  'Produce',
  '',
  '5',
  'ACTIVE',
];

function downloadTemplate() {
  const csv = buildCsv(TEMPLATE_HEADERS, [TEMPLATE_EXAMPLE]);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vendylio-products-template.csv';
  a.click();
  URL.revokeObjectURL(url);
}

export default function ImportProductsPage() {
  const user = useUser();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<RowError[]>([]);
  const [result, setResult] = useState<ImportResult | null>(null);

  if (!user) return null;

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setError(null);
    setRowErrors([]);
    setResult(null);
    if (!file) {
      setFileName(null);
      setCsvText(null);
      return;
    }
    setFileName(file.name);
    setCsvText(await file.text());
  }

  async function onImport() {
    if (!csvText) return;
    setSubmitting(true);
    setError(null);
    setRowErrors([]);
    try {
      const res = await api<ImportResult>('/api/products/import', {
        method: 'POST',
        body: { csv: csvText },
      });
      setResult(res);
      setCsvText(null);
      setFileName(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      if (err instanceof ApiError && err.code === 'IMPORT_VALIDATION_FAILED') {
        const issues = err.body.rowErrors;
        setRowErrors(Array.isArray(issues) ? (issues as RowError[]) : []);
      } else {
        setError(err instanceof ApiError ? err.message : 'Import failed — try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background font-body">
      <SellerModalHeader closeHref="/dashboard/products" />
      <div className="mx-auto max-w-2xl px-4 py-8 lg:py-12">
        <Link
          href="/dashboard/products"
          className="mb-6 flex items-center gap-2 text-sm font-medium text-accent"
        >
          <Icon i="arrow-left" size={16} />
          Back to Products
        </Link>
        <h1
          className="mb-2 font-headings font-bold text-foreground"
          style={{ fontSize: 'clamp(26px, 5vw, 36px)', letterSpacing: '-0.8px' }}
        >
          Import products from CSV
        </h1>
        <p className="mb-8 text-base text-muted-foreground">
          Add many products at once. Every row is checked before anything is created — if a row has
          a problem, nothing gets imported until it&apos;s fixed.
        </p>

        {result ? (
          <div className="rounded-xl border border-border bg-card p-6 text-center">
            <Icon i="check-circle" size={32} className="mx-auto mb-3 text-green-600" />
            <p className="mb-1 font-headings text-lg font-bold text-foreground">
              {result.created} product{result.created === 1 ? '' : 's'} imported
            </p>
            {result.categoriesCreated > 0 && (
              <p className="mb-4 text-sm text-muted-foreground">
                {result.categoriesCreated} new categor
                {result.categoriesCreated === 1 ? 'y' : 'ies'} created
              </p>
            )}
            <div className="mt-4 flex justify-center gap-3">
              <Button variant="outline" onClick={() => setResult(null)}>
                Import more
              </Button>
              <Button variant="accent" onClick={() => router.push('/dashboard/products')}>
                View products
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="rounded-xl border border-border bg-card p-6">
              <p className="mb-3 text-sm font-semibold text-foreground">1. Get the template</p>
              <p className="mb-3 text-sm text-muted-foreground">
                Columns <code className="text-foreground">name</code>,{' '}
                <code className="text-foreground">price</code>,{' '}
                <code className="text-foreground">quantity</code> are required. Optional:
                description, unit (UNIT/LB/KG/G/OZ), category, imageUrl, lowStockThreshold, status
                (ACTIVE/ARCHIVED).
              </p>
              <Button type="button" variant="outline" onClick={downloadTemplate}>
                <Icon i="file-text" size={16} />
                Download template
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-6">
              <p className="mb-3 text-sm font-semibold text-foreground">2. Upload your file</p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={onFileChange}
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-semibold file:text-foreground"
              />
              {fileName && (
                <p className="mt-2 text-xs text-muted-foreground">Selected: {fileName}</p>
              )}
            </div>

            {error && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}

            {rowErrors.length > 0 && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <p className="mb-2 text-sm font-semibold text-red-700">
                  {rowErrors.length} problem{rowErrors.length === 1 ? '' : 's'} found — nothing was
                  imported. Fix these and re-upload.
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-red-700/70">
                        <th className="py-1 pr-3">Row</th>
                        <th className="py-1">Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rowErrors.map((e, i) => (
                        <tr key={`${e.row}-${i}`} className="border-t border-red-200/60">
                          <td className="py-1 pr-3 font-semibold text-red-700">{e.row}</td>
                          <td className="py-1 text-red-700">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <Button
              type="button"
              variant="accent"
              disabled={!csvText || submitting}
              onClick={onImport}
            >
              {submitting ? 'Importing…' : 'Import products'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
