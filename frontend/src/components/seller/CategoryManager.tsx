'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card } from '@/components/ui/Card';
import { Icon } from '@/components/ui/Icon';
import { inputClass } from '@/components/ui/Field';

interface Category {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  sortOrder: number;
  productCount: number;
}

export function CategoryManager() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function load() {
    setError(null);
    api<{ categories: Category[] }>('/api/categories')
      .then((res) => setCategories(res.categories))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : 'Could not load categories.');
      });
  }

  useEffect(load, []);

  async function onAdd() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    setError(null);
    try {
      await api('/api/categories', {
        method: 'POST',
        body: { name, icon: newIcon.trim() || null },
      });
      setNewName('');
      setNewIcon('');
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not add this category.');
    } finally {
      setAdding(false);
    }
  }

  async function onSetIcon(id: string, raw: string) {
    const icon = raw.trim();
    const current = categories?.find((c) => c.id === id)?.icon ?? '';
    if (icon === current) return;
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/categories/${id}`, { method: 'PATCH', body: { icon: icon || null } });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the icon.');
    } finally {
      setBusyId(null);
    }
  }

  async function onRename(id: string) {
    const name = editingName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/categories/${id}`, { method: 'PATCH', body: { name } });
      setEditingId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not rename this category.');
    } finally {
      setBusyId(null);
    }
  }

  async function onMove(index: number, dir: -1 | 1) {
    if (!categories) return;
    const other = categories[index + dir];
    const current = categories[index];
    if (!other || !current) return;
    setBusyId(current.id);
    setError(null);
    try {
      await Promise.all([
        api(`/api/categories/${current.id}`, {
          method: 'PATCH',
          body: { sortOrder: other.sortOrder },
        }),
        api(`/api/categories/${other.id}`, {
          method: 'PATCH',
          body: { sortOrder: current.sortOrder },
        }),
      ]);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reorder.');
    } finally {
      setBusyId(null);
    }
  }

  async function onDelete(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api(`/api/categories/${id}`, { method: 'DELETE' });
      setConfirmDeleteId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this category.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card className="p-8">
      <div className="mb-6 border-b border-border pb-6">
        <h2 className="font-headings text-lg font-bold text-foreground">Product Categories</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Group your products for the storefront. Deleting a category moves its products to
          &ldquo;Uncategorized&rdquo; — it never deletes products.
        </p>
      </div>

      {error && (
        <p role="alert" className="mb-4 text-sm text-red-600">
          {error}
        </p>
      )}

      {categories === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul className="mb-6 space-y-2">
          {categories.length === 0 && (
            <li className="text-sm text-muted-foreground">No categories yet.</li>
          )}
          {categories.map((cat, i) => (
            <li
              key={cat.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
            >
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label="Move up"
                  disabled={i === 0 || busyId !== null}
                  onClick={() => onMove(i, -1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <Icon i="chevron-up" size={14} />
                </button>
                <button
                  type="button"
                  aria-label="Move down"
                  disabled={i === categories.length - 1 || busyId !== null}
                  onClick={() => onMove(i, 1)}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30"
                >
                  <Icon i="chevron-down" size={14} />
                </button>
              </div>

              <input
                type="text"
                maxLength={8}
                aria-label={`Icon for ${cat.name}`}
                defaultValue={cat.icon ?? ''}
                disabled={busyId !== null}
                onBlur={(e) => onSetIcon(cat.id, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                placeholder="🙂"
                className="h-9 w-10 flex-shrink-0 rounded-lg border border-border bg-background text-center text-base"
              />

              <div className="min-w-0 flex-1">
                {editingId === cat.id ? (
                  <input
                    autoFocus
                    className={`${inputClass} py-1.5 text-sm`}
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => onRename(cat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') onRename(cat.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(cat.id);
                      setEditingName(cat.name);
                    }}
                    className="text-left text-sm font-semibold text-foreground hover:text-primary"
                  >
                    {cat.name}
                  </button>
                )}
                <p className="text-xs text-muted-foreground">
                  {cat.productCount} product{cat.productCount === 1 ? '' : 's'}
                </p>
              </div>

              {confirmDeleteId === cat.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {cat.productCount > 0
                      ? `Move ${cat.productCount} product${cat.productCount === 1 ? '' : 's'} to Uncategorized?`
                      : 'Delete?'}
                  </span>
                  <button
                    type="button"
                    disabled={busyId === cat.id}
                    onClick={() => onDelete(cat.id)}
                    className="rounded-md bg-red-600 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  aria-label={`Delete ${cat.name}`}
                  onClick={() => setConfirmDeleteId(cat.id)}
                  className="text-muted-foreground hover:text-red-600"
                >
                  <Icon i="trash" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          maxLength={8}
          aria-label="Icon for the new category"
          placeholder="🙂"
          value={newIcon}
          onChange={(e) => setNewIcon(e.target.value)}
          className="h-10 w-12 flex-shrink-0 rounded-lg border border-border bg-background text-center text-base"
        />
        <input
          className={`${inputClass} text-sm`}
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAdd();
          }}
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={adding || !newName.trim()}
          className="flex-shrink-0 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Add
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        The optional icon shows before the category name on your storefront.
      </p>
    </Card>
  );
}
