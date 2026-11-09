import type { Names } from '@qasa/core';
import { qs, request } from '../api.ts';

/** Item categories (every plan): names in three languages, an order, active or not. */
export interface CategoryView { id: string; code: string; name: Names; sort: number; active: boolean; items: number; createdAt: string; updatedAt: string }
export interface CategoryInput { code?: string; name: Names; sort?: number; active?: boolean }

export const categoriesApi = {
  list: (f: { active?: 'true' | 'false' } = {}) => request<CategoryView[]>('GET', '/api/item-categories' + qs(f)),
  create: (input: CategoryInput) => request<CategoryView>('POST', '/api/item-categories', input),
  update: (id: string, input: CategoryInput) => request<CategoryView>('PUT', `/api/item-categories/${id}`, input),
  remove: (id: string) => request<void>('DELETE', `/api/item-categories/${id}`),
  /** Many items into one category at once (null: none). */
  setForItems: (itemIds: string[], categoryId: string | null) => request<{ updated: number }>('POST', '/api/items/category', { itemIds, categoryId })
};
