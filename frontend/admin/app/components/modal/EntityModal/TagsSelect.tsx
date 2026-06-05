'use client';

import React, { useState, useEffect } from 'react';

interface Tag {
  id: string;
  name: string;
}

interface TagsSelectProps {
  selected: Tag[];
  fetchTags: () => Promise<Tag[]>;
  onChange: (tags: Tag[]) => void;
}

export function TagsSelect({ selected, fetchTags, onChange }: TagsSelectProps) {
  const [available, setAvailable] = useState<Tag[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetchTags().then(setAvailable).catch(() => {});
  }, [fetchTags]);

  const toggle = (tag: Tag) => {
    const isSelected = selected.some((t) => t.id === tag.id);
    onChange(isSelected ? selected.filter((t) => t.id !== tag.id) : [...selected, tag]);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((tag) => (
          <span
            key={tag.id}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-brand/10 text-brand"
          >
            {tag.name}
            <button
              onClick={() => toggle(tag)}
              className="hover:text-red-500"
              aria-label={`Удалить тег ${tag.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen(!open)}
          className="text-xs px-2 py-0.5 rounded-full border border-dashed"
          style={{ borderColor: 'var(--line)', color: 'var(--ink-light)' }}
        >
          + Тег
        </button>
      </div>
      {open && (
        <div
          className="flex flex-wrap gap-1 p-2 rounded-lg border"
          style={{ borderColor: 'var(--line)', backgroundColor: 'var(--surface)' }}
        >
          {available
            .filter((t) => !selected.some((s) => s.id === t.id))
            .map((tag) => (
              <button
                key={tag.id}
                onClick={() => toggle(tag)}
                className="text-xs px-2 py-0.5 rounded-full border hover:bg-brand/10"
                style={{ borderColor: 'var(--line)' }}
              >
                {tag.name}
              </button>
            ))}
          {available.length === 0 && (
            <span className="text-xs" style={{ color: 'var(--ink-light)' }}>
              Нет тегов
            </span>
          )}
        </div>
      )}
    </div>
  );
}
