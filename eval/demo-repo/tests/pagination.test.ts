import { describe, expect, it } from 'vitest';
import { parsePagination } from '../src/lib/pagination';

const at = (query: string) => parsePagination(new URL(`https://shop.test/api/products${query}`));

describe('parsePagination', () => {
  it('defaults to the first page', () => {
    expect(at('')).toEqual({ page: 1, pageSize: 20, skip: 0, take: 20 });
  });

  it('skips the previous pages and caps the page size', () => {
    expect(at('?page=3&pageSize=10')).toMatchObject({ skip: 20, take: 10 });
    expect(at('?pageSize=500').pageSize).toBe(100);
    expect(at('?page=-2').page).toBe(1);
  });
});
