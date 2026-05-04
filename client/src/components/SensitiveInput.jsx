import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

export default function SensitiveInput({
  value,
  onChange,
  placeholder = '저장됨 - 변경 시에만 입력',
  className = '',
  inputClassName = '',
  hasStoredValue = false,
  onRevealStored,
  ...props
}) {
  const [visible, setVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState('');

  const handleToggle = async () => {
    setRevealError('');
    if (visible) {
      setVisible(false);
      return;
    }

    const hasLocalValue = String(value || '').length > 0;
    if (!hasLocalValue && hasStoredValue && onRevealStored) {
      setRevealing(true);
      try {
        const revealed = await onRevealStored();
        if (revealed !== undefined && revealed !== null) {
          onChange?.({ target: { value: String(revealed) } });
        }
      } catch {
        setRevealError('저장값을 불러오지 못했습니다.');
        return;
      } finally {
        setRevealing(false);
      }
    }

    setVisible(true);
  };

  return (
    <div className={className}>
      <div className="relative">
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
          onClick={handleToggle}
          disabled={revealing}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-wait disabled:opacity-50"
          aria-label={visible ? '숨기기' : '보기'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {revealError && <div className="mt-1 text-[11px] font-medium text-rose-500">{revealError}</div>}
    </div>
  );
}
