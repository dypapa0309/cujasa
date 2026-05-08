import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';

const variantClasses = {
  light: {
    trigger: 'border-line bg-white text-slate-700 hover:bg-slate-50 focus:border-coupang',
    placeholder: 'text-slate-400',
    panel: 'border-line bg-white shadow-xl',
    searchWrap: 'border-line bg-white text-slate-700',
    searchInput: 'placeholder:text-slate-400',
    option: 'text-slate-700 hover:bg-slate-100',
    activeOption: 'bg-blue-50 text-coupang',
    empty: 'text-slate-400'
  },
  compact: {
    trigger: 'border-line bg-white text-slate-700 hover:bg-slate-50 focus:border-coupang',
    placeholder: 'text-slate-400',
    panel: 'border-line bg-white shadow-xl',
    searchWrap: 'border-line bg-white text-slate-700',
    searchInput: 'placeholder:text-slate-400',
    option: 'text-slate-700 hover:bg-slate-100',
    activeOption: 'bg-blue-50 text-coupang',
    empty: 'text-slate-400'
  },
  dark: {
    trigger: 'border-white/10 bg-black/25 text-zinc-100 hover:bg-white/5 focus:border-white/25',
    placeholder: 'text-zinc-700',
    panel: 'border-white/10 bg-zinc-950 shadow-2xl shadow-black/40',
    searchWrap: 'border-white/10 bg-black/25 text-zinc-100',
    searchInput: 'placeholder:text-zinc-700',
    option: 'text-zinc-300 hover:bg-white/5',
    activeOption: 'bg-white/10 text-white',
    empty: 'text-zinc-600'
  }
};

export default function SearchableSelect({
  value,
  onChange,
  options = [],
  placeholder = '선택',
  searchPlaceholder = '검색',
  emptyText = '검색 결과가 없습니다',
  variant = 'light',
  disabled = false,
  clearable = false,
  className = '',
  panelClassName = ''
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const styles = variantClasses[variant] || variantClasses.light;
  const selected = options.find((option) => String(option.value) === String(value));
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => {
      const haystack = String(option.searchText || option.label || '').toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [options, query]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const selectOption = (nextValue) => {
    onChange(nextValue);
    setOpen(false);
  };

  const clearSelection = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onChange('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-50 ${styles.trigger} ${variant === 'dark' ? 'rounded-2xl px-4 py-3' : ''}`}
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? '' : styles.placeholder}`}>
          {selected?.label || placeholder}
        </span>
        {clearable && selected && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="선택 해제"
            onClick={clearSelection}
            className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-current opacity-60 hover:bg-black/5 hover:opacity-100"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={16} className={`shrink-0 opacity-50 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className={`absolute left-0 right-0 z-50 mt-2 rounded-2xl border p-2 ${styles.panel} ${panelClassName}`}>
          <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${styles.searchWrap}`}>
            <Search size={17} className="shrink-0 opacity-60" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder}
              className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${styles.searchInput}`}
            />
          </div>
          <div className="mt-2 max-h-72 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className={`px-3 py-4 text-center text-sm ${styles.empty}`}>{emptyText}</div>
            ) : filteredOptions.map((option) => {
              const active = String(option.value) === String(value);
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectOption(option.value)}
                  className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold ${active ? styles.activeOption : styles.option}`}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {active && <Check size={15} className="shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
