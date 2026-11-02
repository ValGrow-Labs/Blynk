import { describe, expect, it } from 'vitest';
import type { Category, Product } from '../api/types';
import { AISLE_PREFETCH_COUNT, aisleCardWidth, aislePhotoPx, aislePhotoUrls } from './aislePrefetch';

const cat = (id: string, slug: string, parent: string | null = null): Category =>
  ({ id, slug, name: slug, parent_id: parent, image_url: null } as unknown as Category);
const prod = (id: string, category_id: string, image_url: string | null, is_available = true): Product =>
  ({ id, name: id, category_id, image_url, is_available } as unknown as Product);

const categories = [cat('c1', 'dairy'), cat('c2', 'milk', 'c1'), cat('c3', 'snacks')];
const chainOf = (id: string) => (id === 'c2' ? ['c2', 'c1'] : [id]);
const many = Array.from({ length: 30 }, (_, i) => prod(`p${i}`, 'c1', `https://api/uploads/products/${i}.jpg`));

describe('aislePhotoUrls', () => {
  it('takes the first photos of the category in screen order, in stock first', () => {
    const products = [prod('a', 'c1', 'https://api/uploads/a.jpg', false), prod('b', 'c1', 'https://api/uploads/b.jpg'), prod('x', 'c3', 'https://api/uploads/x.jpg')];
    expect(aislePhotoUrls({ categories, products, chainOf }, 'dairy')).toEqual(['https://api/uploads/b.jpg', 'https://api/uploads/a.jpg']);
  });
  it('stops at the cap and skips products without a photo and repeats', () => {
    const products = [prod('n', 'c1', null), ...many, prod('dup', 'c1', 'https://api/uploads/products/0.jpg')];
    const urls = aislePhotoUrls({ categories, products, chainOf }, 'dairy');
    expect(urls).toHaveLength(AISLE_PREFETCH_COUNT);
    expect(urls[0]).toBe('https://api/uploads/products/0.jpg');
    expect(new Set(urls).size).toBe(urls.length);
    expect(aislePhotoUrls({ categories, products: many, chainOf }, 'dairy', null, 3)).toHaveLength(3);
  });
  it('follows a sub-category and gives nothing for an unknown slug or no catalogue', () => {
    const products = [prod('m', 'c2', 'https://api/uploads/m.jpg'), prod('o', 'c1', 'https://api/uploads/o.jpg')];
    expect(aislePhotoUrls({ categories, products, chainOf }, 'dairy', 'milk')).toEqual(['https://api/uploads/m.jpg']);
    expect(aislePhotoUrls({ categories, products, chainOf }, 'nope')).toEqual([]);
    expect(aislePhotoUrls(null, 'dairy')).toEqual([]);
    expect(aislePhotoUrls(undefined, 'dairy')).toEqual([]);
  });
});

describe('aisleCardWidth', () => {
  it('is half the grid beside the sidebar, or the full width without one', () => {
    expect(aisleCardWidth(390, true)).toBe(134); // (390 - 86 - 24 - 12) / 2
    expect(aisleCardWidth(390, false)).toBe(177); // (390 - 24 - 12) / 2
  });
  it('asks for the photo at 92 percent of the card', () => {
    expect(aislePhotoPx(390, true)).toBeCloseTo(134 * 0.92, 5);
  });
});
