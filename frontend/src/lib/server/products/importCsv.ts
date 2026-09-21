import 'server-only';
import { z } from 'zod';
import { PRODUCT_UNIT_VALUES } from '@/lib/productUnits';
import { isValidQuantityForUnit, roundQuantity } from '@/lib/quantity';
import { parseCsv, csvRowsToObjects } from '@/lib/csv';

export interface ImportedProductRow {
  name: string;
  description?: string;
  priceCents: number;
  quantity: number;
  unit: string;
  category?: string;
  imageUrl?: string;
  lowStockThreshold?: number;
  status: string;
}

export interface RowError {
  /** 1-based; the header row is row 1, so the first data row is row 2 —
   *  matches what the seller sees if they open the file in a spreadsheet. */
  row: number;
  message: string;
}

export interface ParsedImport {
  rows: ImportedProductRow[];
  errors: RowError[];
}

// Lenient header matching — "Image URL", "image_url", "photo" all resolve
// to the same field. Unrecognized columns are silently ignored rather than
// erroring, so an extra "SKU" or "notes" column a seller exported from
// somewhere else doesn't block the import.
const HEADER_ALIASES: Record<string, string> = {
  name: 'name',
  productname: 'name',
  title: 'name',
  description: 'description',
  desc: 'description',
  price: 'price',
  priceusd: 'price',
  quantity: 'quantity',
  qty: 'quantity',
  stock: 'quantity',
  unit: 'unit',
  category: 'category',
  imageurl: 'imageUrl',
  image: 'imageUrl',
  photo: 'imageUrl',
  photourl: 'imageUrl',
  lowstockthreshold: 'lowStockThreshold',
  reorderpoint: 'lowStockThreshold',
  status: 'status',
};

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const RowSchema = z
  .object({
    name: z.string().trim().min(2, 'must be at least 2 characters').max(120, 'max 120 characters'),
    description: z.string().trim().max(1000, 'max 1000 characters').optional(),
    price: z.coerce.number().positive('must be greater than 0'),
    quantity: z.coerce.number().min(0, 'cannot be negative'),
    unit: z
      .string()
      .trim()
      .toUpperCase()
      .default('UNIT')
      .refine((u) => (PRODUCT_UNIT_VALUES as readonly string[]).includes(u), {
        message: `must be one of: ${PRODUCT_UNIT_VALUES.join(', ')}`,
      }),
    category: z.string().trim().max(60, 'max 60 characters').optional(),
    imageUrl: z.string().trim().url('must be a valid URL').optional(),
    lowStockThreshold: z.coerce
      .number()
      .int('must be a whole number')
      .min(0, 'cannot be negative')
      .optional(),
    status: z
      .string()
      .trim()
      .toUpperCase()
      .default('ACTIVE')
      .refine((s) => s === 'ACTIVE' || s === 'ARCHIVED', {
        message: 'must be ACTIVE or ARCHIVED',
      }),
  })
  .superRefine((data, ctx) => {
    if (!isValidQuantityForUnit(data.quantity, data.unit)) {
      ctx.addIssue({
        code: 'custom',
        path: ['quantity'],
        message: 'must be a whole number for a per-item (UNIT) product',
      });
    }
  });

const REQUIRED_FIELDS = ['name', 'price', 'quantity'];
export const IMPORT_MAX_ROWS = 2000;
const MAX_REPORTED_ERRORS = 200;

function stripEmpty(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v.trim() !== '') out[k] = v.trim();
  }
  return out;
}

/**
 * Parses + validates raw CSV text into rows ready for product creation.
 *
 * All-or-nothing: if ANY row fails validation, `rows` is empty and every
 * problem is reported in `errors` (capped at 200) so the seller fixes the
 * file once and re-uploads, rather than ending up with a half-imported
 * catalog to clean up by hand.
 */
export function parseProductImportCsv(csvText: string): ParsedImport {
  const parsedRows = csvRowsToObjects(parseCsv(csvText));
  if (parsedRows.length === 0) {
    return { rows: [], errors: [{ row: 1, message: 'The file has no data rows.' }] };
  }
  if (parsedRows.length > IMPORT_MAX_ROWS) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: `The file has ${parsedRows.length} rows — the limit is ${IMPORT_MAX_ROWS} per import. Split it into smaller files.`,
        },
      ],
    };
  }

  const rawHeaders = Object.keys(parsedRows[0]!);
  const fieldByHeader = new Map<string, string>();
  for (const h of rawHeaders) {
    const canonical = HEADER_ALIASES[normalizeHeader(h)];
    if (canonical) fieldByHeader.set(h, canonical);
  }
  const presentFields = new Set(fieldByHeader.values());
  const missingRequired = REQUIRED_FIELDS.filter((f) => !presentFields.has(f));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      errors: [
        {
          row: 1,
          message: `Missing required column(s): ${missingRequired.join(', ')}. Expected headers: name, price, quantity (optional: description, unit, category, imageUrl, lowStockThreshold, status).`,
        },
      ],
    };
  }

  const errors: RowError[] = [];
  const rows: ImportedProductRow[] = [];

  parsedRows.forEach((raw, i) => {
    const mapped: Record<string, string> = {};
    for (const [header, cell] of Object.entries(raw)) {
      const field = fieldByHeader.get(header);
      if (field) mapped[field] = cell;
    }
    const rowNumber = i + 2;
    const result = RowSchema.safeParse(stripEmpty(mapped));
    if (!result.success) {
      for (const issue of result.error.issues) {
        errors.push({
          row: rowNumber,
          message: `${issue.path.join('.') || 'row'}: ${issue.message}`,
        });
      }
      return;
    }
    const d = result.data;
    rows.push({
      name: d.name,
      ...(d.description ? { description: d.description } : {}),
      priceCents: Math.round(d.price * 100),
      quantity: roundQuantity(d.quantity),
      unit: d.unit,
      ...(d.category ? { category: d.category } : {}),
      ...(d.imageUrl ? { imageUrl: d.imageUrl } : {}),
      ...(d.lowStockThreshold !== undefined ? { lowStockThreshold: d.lowStockThreshold } : {}),
      status: d.status,
    });
  });

  if (errors.length > 0) return { rows: [], errors: errors.slice(0, MAX_REPORTED_ERRORS) };
  return { rows, errors: [] };
}
