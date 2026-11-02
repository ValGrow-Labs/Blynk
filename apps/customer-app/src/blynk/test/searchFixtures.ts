import type { Category, Product } from '../api/types';
import { milk } from './fixtures';

/** A plain test product: only what search reads (name, category, description, availability, price). */
export function product(name: string, o: Partial<Product> & { category?: string; price?: number } = {}): Product {
  const { category, price, ...rest } = o;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    ...milk,
    id: `p-${slug}-${Math.round(price ?? 100)}`,
    slug,
    name,
    description: null,
    category_id: `c-${(category ?? 'Groceries').toLowerCase().replace(/[^a-z]+/g, '-')}`,
    category_name: category ?? 'Groceries',
    selling_price: price ?? 100,
    offer_price: null,
    offer_kind: null,
    offer_ends_at: null,
    is_available: true,
    ...rest,
  };
}

export function category(name: string, parent: Category | null = null): Category {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return {
    id: `c-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`, name, slug, description: null, image_url: null,
    display_order: 0, parent_id: parent ? parent.id : null, offer_percent: null, offer_ends_at: null,
  };
}

/** A small Sri Lankan grocery: the names a real catalogue has. */
export const GROCERY: Product[] = [
  product('White Sugar 1KG', { category: 'Groceries', price: 253 }),
  product('Brown Sugar 500g', { category: 'Groceries', price: 190 }),
  product('Sugar Free Sweetener', { category: 'Health', price: 640 }),
  product('Kotmale Fresh Milk 1L', { category: 'Dairy', price: 540 }),
  product('Anchor Full Cream Milk Powder 400g', { category: 'Dairy', price: 980 }),
  product('Milo 400g', { category: 'Beverages', price: 760 }),
  product('Sunlight Soap 100g', { category: 'Soap', price: 90 }),
  product('Lux Soap Rose 100g', { category: 'Soap', price: 120 }),
  product('Prima Wheat Flour 1KG', { category: 'Groceries', price: 215 }),
  product('Keeri Samba Rice 5KG', { category: 'Rice', price: 1450 }),
  product('Nadu Rice 5KG', { category: 'Rice', price: 1100 }),
  product('Red Raw Rice 5KG', { category: 'Rice', price: 1050 }),
  product('Samba Rice 1KG', { category: 'Rice', price: 260 }),
  product('Masoor Dhal 1KG', { category: 'Groceries', price: 410 }),
  product('Salt Iodised 400g', { category: 'Groceries', price: 60 }),
  product('Rock Salt 1KG', { category: 'Groceries', price: 85 }),
  product('Big Onion 1KG', { category: 'Vegetables', price: 280 }),
  product('Red Onion 500g', { category: 'Vegetables', price: 320 }),
  product('Garlic 250g', { category: 'Vegetables', price: 450 }),
  product('Potato 1KG', { category: 'Vegetables', price: 260 }),
  product('Carrot 500g', { category: 'Vegetables', price: 180 }),
  product('Tomato 500g', { category: 'Vegetables', price: 150 }),
  product('Coconut', { category: 'Vegetables', price: 110 }),
  product('Coconut Oil 750ml', { category: 'Oil', price: 1190 }),
  product('Sunflower Oil 1L', { category: 'Oil', price: 1390 }),
  product('Sliced Bread 450g', { category: 'Bakery', price: 160 }),
  product('Egg White 10', { category: 'Eggs', price: 480 }),
  product('Whole Chicken 1KG', { category: 'Meat', price: 1050 }),
  product('Chicken Breast 500g', { category: 'Meat', price: 850 }),
  product('Fresh Tuna 500g', { category: 'Fish', price: 950 }),
  product('Ceylon Tea 200g', { category: 'Beverages', price: 520 }),
  product('Nescafe Coffee 100g', { category: 'Beverages', price: 890 }),
  product('Red Chilli Powder 100g', { category: 'Spices', price: 190 }),
  product('Green Chilli 250g', { category: 'Vegetables', price: 120 }),
  product('Coriander Powder 100g', { category: 'Spices', price: 130 }),
  product('Biscuits Cream Cracker 190g', { category: 'Biscuits', price: 170 }),
  product('Banana 1KG', { category: 'Fruit', price: 220 }),
  product('Fresh Mango 1KG', { category: 'Fruit', price: 380 }),
  product('Pineapple', { category: 'Fruit', price: 250 }),
  product('Apple Red 4pcs', { category: 'Fruit', price: 580 }),
  product('Huggies Wonder Pants L 40s', { category: 'Diapers', price: 3290, description: 'Soft baby pants for all-night dryness' }),
  product('Baby Wipes 80s', { category: 'Baby Care', price: 450 }),
  product('Head and Shoulders Shampoo 180ml', { category: 'Shampoo', price: 780 }),
  product('Kellogs Cornflakes 250g', { category: 'Cereal', price: 690 }),
  product('Lanka Bath Soap Lemon', { category: 'Soap', price: 95 }),
  product('Non-stick Frying Pan 24cm', { category: 'Kitchen', price: 3200 }),
];
