import { describe, it, expect } from 'vitest';
import { parseProductImportCsv, IMPORT_MAX_ROWS } from './importCsv';

describe('parseProductImportCsv', () => {
  it('errors when the file has no data rows', () => {
    const result = parseProductImportCsv('name,price,quantity');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/no data rows/);
  });

  it('errors when a required column is missing', () => {
    const result = parseProductImportCsv('name,quantity\nApple,10');
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/Missing required column/);
    expect(result.errors[0]?.message).toMatch(/price/);
  });

  it('matches aliased headers case/punctuation-insensitively', () => {
    const csv = ['Product Name,Price ($),Qty', 'Apple,1.50,10'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { name: 'Apple', priceCents: 150, quantity: 10, unit: 'UNIT', status: 'ACTIVE' },
    ]);
  });

  it('converts price dollars to priceCents and defaults unit/status', () => {
    const result = parseProductImportCsv('name,price,quantity\nApple,4.99,3');
    expect(result.rows).toEqual([
      { name: 'Apple', priceCents: 499, quantity: 3, unit: 'UNIT', status: 'ACTIVE' },
    ]);
  });

  it('includes optional fields only when present', () => {
    const csv = [
      'name,description,price,quantity,unit,category,imageUrl,lowStockThreshold,status',
      'Apple,Crisp fruit,1.50,10,UNIT,Produce,https://example.com/a.jpg,5,ARCHIVED',
    ].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        name: 'Apple',
        description: 'Crisp fruit',
        priceCents: 150,
        quantity: 10,
        unit: 'UNIT',
        category: 'Produce',
        imageUrl: 'https://example.com/a.jpg',
        lowStockThreshold: 5,
        status: 'ARCHIVED',
      },
    ]);
  });

  it('reports a row error with the 1-based spreadsheet row number', () => {
    const csv = ['name,price,quantity', 'Apple,1.50,10', 'Milk,not-a-number,5'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ row: 3 });
  });

  it('rejects a fractional quantity for a UNIT product', () => {
    const csv = ['name,price,quantity', 'Apple,1.50,10.5'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/whole number/);
  });

  it('allows a fractional quantity for a weight unit', () => {
    const csv = ['name,price,quantity,unit', 'Cheese,9.99,2.5,LB'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]?.quantity).toBe(2.5);
  });

  it('rejects an unknown unit', () => {
    const csv = ['name,price,quantity,unit', 'Apple,1.50,10,LBS'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors[0]?.message).toMatch(/unit: must be one of/);
  });

  it('rejects an unknown status', () => {
    const csv = ['name,price,quantity,status', 'Apple,1.50,10,DRAFT'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors[0]?.message).toMatch(/status: must be ACTIVE or ARCHIVED/);
  });

  it('rejects a non-URL imageUrl', () => {
    const csv = ['name,price,quantity,imageUrl', 'Apple,1.50,10,not-a-url'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors[0]?.message).toMatch(/imageUrl/);
  });

  it('ignores an unrecognized extra column instead of erroring', () => {
    const csv = ['name,price,quantity,sku', 'Apple,1.50,10,SKU-1'].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).not.toHaveProperty('sku');
  });

  it('collects every row error at once rather than stopping at the first', () => {
    const csv = ['name,price,quantity', 'Apple,not-a-number,10', 'Bread,1.50,not-a-number'].join(
      '\n',
    );
    const result = parseProductImportCsv(csv);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it('rejects a file over the row cap', () => {
    const rows = Array.from({ length: IMPORT_MAX_ROWS + 1 }, (_, i) => `Item ${i},1.00,1`);
    const csv = ['name,price,quantity', ...rows].join('\n');
    const result = parseProductImportCsv(csv);
    expect(result.rows).toEqual([]);
    expect(result.errors[0]?.message).toMatch(/limit is/);
  });
});
