import type { CountryCode, Names, StarterTrade } from '@qasa/core';
import { qs, request } from '../api.ts';

type I18nNames = (names: Names) => string;

/** Item categories (every plan): names in three languages, an order, active or not; 1.1: subcategories (two levels). */
export interface CategoryView {
  id: string; code: string; name: Names; sort: number; active: boolean; parentId: string | null;
  /** items in this category itself, and its subcategories */
  items: number; children: number;
  createdAt: string; updatedAt: string;
}
export interface CategoryInput { code?: string; name: Names; sort?: number; active?: boolean; parentId?: string | null }

export const categoriesApi = {
  /** In tree order: each category followed by its subcategories. */
  list: (f: { active?: 'true' | 'false' } = {}) => request<CategoryView[]>('GET', '/api/item-categories' + qs(f)),
  create: (input: CategoryInput) => request<CategoryView>('POST', '/api/item-categories', input),
  update: (id: string, input: CategoryInput) => request<CategoryView>('PUT', `/api/item-categories/${id}`, input),
  remove: (id: string) => request<void>('DELETE', `/api/item-categories/${id}`),
  /** Many items into one category at once (null: none). */
  setForItems: (itemIds: string[], categoryId: string | null) => request<{ updated: number }>('POST', '/api/items/category', { itemIds, categoryId })
};

/** Brands (1.1): one list for every item. */
export interface BrandView {
  id: string; code: string | null; name: string; nameAr: string; nameKu: string; country: CountryCode | null;
  sort: number; active: boolean; items: number; createdAt: string; updatedAt: string;
}
export interface BrandInput { code?: string | null; name: string; nameAr?: string; nameKu?: string; country?: string | null; sort?: number; active?: boolean }

export const brandsApi = {
  list: (f: { active?: 'true' | 'false' } = {}) => request<BrandView[]>('GET', '/api/brands' + qs(f)),
  create: (input: BrandInput) => request<BrandView>('POST', '/api/brands', input),
  update: (id: string, input: BrandInput) => request<BrandView>('PUT', `/api/brands/${id}`, input),
  remove: (id: string) => request<void>('DELETE', `/api/brands/${id}`),
  /** Adds a trade's starter categories and brands; what is there by name is skipped. */
  addStarterList: (trade: StarterTrade) => request<{ trade: StarterTrade; categories: number; subcategories: number; brands: number }>('POST', '/api/starter-lists', { trade })
};

/** "Category › Subcategory" (or just the category's name). */
export function categoryLabel(list: readonly CategoryView[], id: string | null | undefined, name: I18nNames): string {
  const c = id ? list.find((x) => x.id === id) : undefined;
  if (!c) return '';
  const parent = c.parentId ? list.find((x) => x.id === c.parentId) : undefined;
  return parent ? `${name(parent.name)} › ${name(c.name)}` : name(c.name);
}

/** A brand's name in the language shown: its own spelling for Arabic or Kurdish when it has one. */
export function brandLabel(b: Pick<BrandView, 'name' | 'nameAr' | 'nameKu'> | undefined, lang: 'ar' | 'en' | 'ku'): string {
  if (!b) return '';
  return (lang === 'ar' && b.nameAr) || (lang === 'ku' && b.nameKu) || b.name;
}

/**
 * Is an item in the category picked as a filter? '' (all): yes; 'none': only an item with no category; a category: an
 * item in it or in one of its subcategories.
 */
export function inCategory(list: readonly CategoryView[], itemCategoryId: string | null | undefined, filter: string): boolean {
  if (!filter) return true;
  if (filter === 'none') return !itemCategoryId;
  if (!itemCategoryId) return false;
  if (itemCategoryId === filter) return true;
  return list.find((c) => c.id === itemCategoryId)?.parentId === filter;
}
