import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export default function SensitiveInput({
  value,
  onChange,
  placeholder = '저장됨 - 변경 시에만 입력',
  className = '',
  inputClassName = '',
  ...props
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        className={`${inputClassName || 'w-full rounded border border-line px-3 py-2 pr-10 text-sm'} font-mono tracking-wide`}
      />
      <button
        type="button"
        onClick={() => setVisible((next) => !next)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        aria-label={visible ? '숨기기' : '보기'}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
