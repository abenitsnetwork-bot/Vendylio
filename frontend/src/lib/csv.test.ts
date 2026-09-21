import { describe, it, expect } from 'vitest';
import { parseCsv, csvRowsToObjects, buildCsv } from './csv';

describe('parseCsv', () => {
  it('parses a simple header + row', () => {
    expect(parseCsv('name,price\nApple,1.50')).toEqual([
      ['name', 'price'],
      ['Apple', '1.50'],
    ]);
  });

  it('handles a quoted field containing a comma', () => {
    expect(parseCsv('name,description\n"Apple, Red","Crisp fruit"')).toEqual([
      ['name', 'description'],
      ['Apple, Red', 'Crisp fruit'],
    ]);
  });

  it('handles an escaped quote inside a quoted field', () => {
    expect(parseCsv('name\n"Farmer""s Best"')).toEqual([['name'], ['Farmer"s Best']]);
  });

  it('handles an embedded newline inside a quoted field', () => {
    expect(parseCsv('name,description\n"Apple","Line1\nLine2"')).toEqual([
      ['name', 'description'],
      ['Apple', 'Line1\nLine2'],
    ]);
  });

  it('normalizes CRLF line endings', () => {
    expect(parseCsv('name,price\r\nApple,1.50\r\nPear,2.00')).toEqual([
      ['name', 'price'],
      ['Apple', '1.50'],
      ['Pear', '2.00'],
    ]);
  });

  it('handles a trailing newline at EOF without an extra empty row', () => {
    expect(parseCsv('name\nApple\n')).toEqual([['name'], ['Apple']]);
  });

  it('drops blank lines', () => {
    expect(parseCsv('name\nApple\n\nPear\n')).toEqual([['name'], ['Apple'], ['Pear']]);
  });

  it('returns an empty array for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('csvRowsToObjects', () => {
  it('maps each row to an object keyed by the header row', () => {
    const rows = parseCsv('name,price\nApple,1.50\nPear,2.00');
    expect(csvRowsToObjects(rows)).toEqual([
      { name: 'Apple', price: '1.50' },
      { name: 'Pear', price: '2.00' },
    ]);
  });

  it("fills a short row's missing trailing cells with an empty string", () => {
    const rows = [
      ['name', 'price', 'category'],
      ['Apple', '1.50'],
    ];
    expect(csvRowsToObjects(rows)).toEqual([{ name: 'Apple', price: '1.50', category: '' }]);
  });

  it('returns an empty array when there is no header row', () => {
    expect(csvRowsToObjects([])).toEqual([]);
  });
});

describe('buildCsv', () => {
  it('quotes a cell containing a comma', () => {
    expect(buildCsv(['name'], [['Apple, Red']])).toBe('name\r\n"Apple, Red"');
  });

  it('escapes an embedded quote', () => {
    expect(buildCsv(['name'], [['Farmer"s Best']])).toBe('name\r\n"Farmer""s Best"');
  });

  it('round-trips through parseCsv', () => {
    const csv = buildCsv(['name', 'description'], [['Apple, Red', 'Crisp, "sweet" fruit']]);
    expect(parseCsv(csv)).toEqual([
      ['name', 'description'],
      ['Apple, Red', 'Crisp, "sweet" fruit'],
    ]);
  });
});
