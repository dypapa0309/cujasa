import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, ShieldCheck, XCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { dateTime } from '../lib/format.js';

const statusLabels = {
  candidate: '검토 대기',
  approved: '승인됨',
  rejected: '제외됨'
};

const sourceLabels = {
  text_paste: '텍스트',
  screenshot_ocr: '캡처 OCR',
  admin_seed: '관리자 seed'
};

function PatternCard({ pattern, saving, onStatus }) {
  const flags = Array.isArray(pattern.safety_flags) ? pattern.safety_flags : [];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold text-slate-600">
              {statusLabels[pattern.quality_status] || pattern.quality_status}
            </span>
            <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-bold text-blue-700">
              {sourceLabels[pattern.source_type] || pattern.source_type}
            </span>
            <span className="text-xs font-semibold text-slate-400">점수 {pattern.performance_score || 0}</span>
          </div>
          <h3 className="mt-3 text-base font-black text-slate-900">{pattern.hook_pattern}</h3>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{pattern.comment_question_pattern}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onStatus(pattern, 'approved')}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-black text-emerald-700 disabled:opacity-50"
          >
            <CheckCircle2 size={14} /> 승인
          </button>
          <button
            type="button"
            onClick={() => onStatus(pattern, 'rejected')}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-black text-rose-700 disabled:opacity-50"
          >
            <XCircle size={14} /> 제외
          </button>
        </div>
      </div>
      <div className="mt-4 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
        <div>카테고리: <span className="font-bold text-slate-700">{pattern.category || '미분류'}</span></div>
        <div>타깃: <span className="font-bold text-slate-700">{pattern.target_audience_hint || '미입력'}</span></div>
        <div>갈림: <span className="font-bold text-slate-700">{pattern.tension_type || '미분류'}</span></div>
        <div>감정: <span className="font-bold text-slate-700">{pattern.emotion_signal || '미분류'}</span></div>
      </div>
      {pattern.reusable_structure && (
        <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
          {pattern.reusable_structure}
        </div>
      )}
      {(pattern.voice_pattern || pattern.format_pattern || pattern.list_structure) && (
        <div className="mt-3 grid gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600 sm:grid-cols-2">
          {pattern.voice_pattern && <div>말투: <span className="font-bold text-slate-700">{pattern.voice_pattern}</span></div>}
          {pattern.format_pattern && <div>형식: <span className="font-bold text-slate-700">{pattern.format_pattern}</span></div>}
          {pattern.line_break_pattern && <div>줄바꿈: <span className="font-bold text-slate-700">{pattern.line_break_pattern}</span></div>}
          {pattern.list_structure && <div>목록: <span className="font-bold text-slate-700">{pattern.list_structure}</span></div>}
          {pattern.punctuation_style && <div>기호: <span className="font-bold text-slate-700">{pattern.punctuation_style}</span></div>}
          {pattern.tone_register && <div>톤: <span className="font-bold text-slate-700">{pattern.tone_register}</span></div>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span>{dateTime(pattern.created_at)}</span>
        {flags.map((flag) => <span key={flag} className="rounded-full bg-slate-100 px-2 py-0.5">{flag}</span>)}
      </div>
    </div>
  );
}

export default function AdminTrendReferencePage() {
  const toast = useToast();
  const [status, setStatus] = useState('candidate');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');

  const load = async () => {
    const query = new URLSearchParams({ status, limit: '120' });
    setRows(await api.get(`/api/admin/trend-reference-patterns?${query.toString()}`));
  };

  useEffect(() => {
    setLoading(true);
    load().catch(() => toast('패턴 검수 목록을 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, [status]);

  const counts = useMemo(() => rows.reduce((acc, row) => {
    acc[row.quality_status] = (acc[row.quality_status] || 0) + 1;
    return acc;
  }, {}), [rows]);

  const updateStatus = async (pattern, nextStatus) => {
    setSavingId(pattern.id);
    try {
      await api.patch(`/api/admin/trend-reference-patterns/${pattern.id}`, { qualityStatus: nextStatus });
      toast(nextStatus === 'approved' ? '공용 패턴으로 승인했습니다.' : '패턴을 제외했습니다.', 'success');
      await load();
    } catch (err) {
      toast(err.message || '패턴 상태 변경에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-sm font-black text-slate-500">
              <ShieldCheck size={17} /> 익명 레퍼런스 패턴
            </div>
            <h1 className="mt-2 text-2xl font-black text-slate-950">공용 콘텐츠 패턴 검수</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              고객 레퍼런스에서 원문 없이 추출된 패턴만 검수합니다. 승인된 패턴은 레퍼런스를 넣지 못한 계정의 콘텐츠 품질 개선에 사용됩니다.
            </p>
          </div>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600">
            <RefreshCw size={15} /> 새로고침
          </button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2">
          {Object.keys(statusLabels).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStatus(key)}
              className={`rounded-full border px-4 py-2 text-sm font-black ${status === key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
            >
              {statusLabels[key]} {counts[key] || ''}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm font-bold text-slate-500">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm font-bold text-slate-500">검수할 패턴이 없습니다.</div>
      ) : (
        <div className="grid gap-4">
          {rows.map((pattern) => (
            <PatternCard key={pattern.id} pattern={pattern} saving={savingId === pattern.id} onStatus={updateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}
