import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, FileText, ImageUp, RefreshCw, ShieldCheck, Upload, XCircle } from 'lucide-react';
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

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsText(file, 'utf-8');
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',').pop() || '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

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
            <span className="text-xs font-semibold text-slate-400">사용 {pattern.usage_count || 0}</span>
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
  const [studioForm, setStudioForm] = useState({
    category: '자취/살림 꿀템',
    targetAudienceHint: '2030 자취생, 생활용품 관심 사용자',
    direction: '기계적인 설명 대신 생활 속 기준, 실제 써본 듯한 판단, 쉽게 댓글 달 수 있는 질문으로 끝내기',
    qualityStatus: 'candidate',
    text: ''
  });
  const [analyzing, setAnalyzing] = useState(false);
  const [studioResult, setStudioResult] = useState(null);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [uploadedSamples, setUploadedSamples] = useState([]);
  const [uploadedFileNames, setUploadedFileNames] = useState([]);

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

  const updateStudioForm = (key, value) => {
    setStudioForm((prev) => ({ ...prev, [key]: value }));
  };

  const analyzeStudioContent = async (event) => {
    event.preventDefault();
    setAnalyzing(true);
    try {
      const result = await api.post('/api/admin/trend-reference-patterns/analyze', {
        ...studioForm,
        samples: uploadedSamples,
        useAi: true
      });
      setStudioResult(result);
      toast(`${result.savedCount || 0}개 공용 패턴을 저장했습니다.`, 'success');
      await load();
    } catch (err) {
      toast(err.message || '콘텐츠 패턴 분석에 실패했습니다.', 'error');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleReferenceFiles = async (fileList) => {
    const selected = Array.from(fileList || []).slice(0, 12);
    if (!selected.length) return;
    setUploadingFiles(true);
    try {
      const nextTexts = [];
      const nextSamples = [];
      const nextNames = [];
      for (const file of selected) {
        const lowerName = file.name.toLowerCase();
        if (file.size > 12 * 1024 * 1024) {
          toast(`${file.name}은 12MB 이하로 올려주세요.`, 'error');
          continue;
        }
        if (/\.(txt|csv)$/i.test(lowerName) || /^text\/|\/csv$/i.test(file.type || '')) {
          nextTexts.push(await readFileAsText(file));
          nextNames.push(file.name);
          continue;
        }
        if (/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) {
          const base64 = await readFileAsBase64(file);
          const sample = await api.post('/api/admin/trend-reference-patterns/ocr', {
            fileName: file.name,
            mimeType: file.type || 'image/png',
            base64,
            category: studioForm.category,
            topicKeyword: studioForm.category
          });
          if (sample?.sourceText) {
            nextSamples.push(sample);
            nextNames.push(file.name);
          }
          continue;
        }
        toast(`${file.name}은 지원하지 않는 형식입니다. TXT/CSV/이미지만 올려주세요.`, 'error');
      }
      if (nextTexts.length) {
        updateStudioForm('text', [studioForm.text, ...nextTexts].filter(Boolean).join('\n\n---\n\n'));
      }
      if (nextSamples.length) {
        setUploadedSamples((prev) => [...prev, ...nextSamples]);
      }
      if (nextNames.length) {
        setUploadedFileNames((prev) => [...prev, ...nextNames]);
        toast(`파일 ${nextNames.length}개를 학습 입력으로 준비했습니다.`, 'success');
      }
    } catch (err) {
      toast(err.message || '파일 업로드 처리에 실패했습니다.', 'error');
    } finally {
      setUploadingFiles(false);
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
              운영자가 참고 콘텐츠를 넣고, 패턴을 분석하고, 방향을 정해 CUJASA 생성 품질에 반영합니다.
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

      <form onSubmit={analyzeStudioContent} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-sm font-black text-slate-500">Content Learning Studio</div>
            <h2 className="mt-1 text-xl font-black text-slate-950">콘텐츠 업로드와 방향 지정</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              반응 좋은 글을 붙여넣으면 원문은 저장하지 않고 재사용 가능한 구조, 말투, 질문 패턴만 저장합니다.
            </p>
          </div>
          <button
            type="submit"
            disabled={analyzing || uploadingFiles || (studioForm.text.trim().length < 20 && uploadedSamples.length === 0)}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white disabled:opacity-50"
          >
            {analyzing ? '분석 중...' : '패턴 분석 저장'}
          </button>
        </div>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            적용 주제
            <input className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" value={studioForm.category} onChange={(event) => updateStudioForm('category', event.target.value)} />
          </label>
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            대상 독자
            <input className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" value={studioForm.targetAudienceHint} onChange={(event) => updateStudioForm('targetAudienceHint', event.target.value)} />
          </label>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            운영 방향
            <textarea className="min-h-24 rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" value={studioForm.direction} onChange={(event) => updateStudioForm('direction', event.target.value)} />
          </label>
          <label className="grid content-start gap-2 text-sm font-bold text-slate-700">
            저장 상태
            <select className="rounded-xl border border-slate-200 px-3 py-2 outline-none focus:border-slate-400" value={studioForm.qualityStatus} onChange={(event) => updateStudioForm('qualityStatus', event.target.value)}>
              <option value="candidate">검토 대기</option>
              <option value="approved">바로 승인</option>
            </select>
          </label>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <label className="grid gap-2 text-sm font-bold text-slate-700">
            파일 업로드
            <span className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-sm text-slate-600 hover:bg-slate-100">
              <span className="min-w-0 truncate">{uploadedFileNames.length ? `${uploadedFileNames.length}개 파일 준비됨` : 'TXT/CSV/캡처 이미지 업로드'}</span>
              <Upload size={16} />
              <input
                type="file"
                multiple
                accept=".txt,.csv,.png,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={(event) => handleReferenceFiles(event.target.files)}
              />
            </span>
          </label>
          <div className="grid content-end gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
            <div className="flex items-center gap-2"><FileText size={14} /> 텍스트는 붙여넣기 입력에 합쳐집니다.</div>
            <div className="flex items-center gap-2"><ImageUp size={14} /> 이미지는 OCR 후 샘플로 저장됩니다.</div>
          </div>
        </div>
        {(uploadingFiles || uploadedFileNames.length > 0 || uploadedSamples.length > 0) && (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-600">
            {uploadingFiles ? '파일 처리 중...' : `준비된 파일 ${uploadedFileNames.length}개 · OCR 샘플 ${uploadedSamples.length}개`}
          </div>
        )}
        <label className="mt-3 grid gap-2 text-sm font-bold text-slate-700">
          참고 콘텐츠
          <textarea
            className="min-h-48 rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed outline-none focus:border-slate-400"
            value={studioForm.text}
            onChange={(event) => updateStudioForm('text', event.target.value)}
            placeholder={'반응 좋은 글 본문을 붙여넣어 주세요.\n\n여러 개는 빈 줄 또는 --- 로 구분합니다.\n좋아요 1200 / 댓글 80 / 조회 20000 같은 수치도 같이 넣을 수 있습니다.'}
          />
        </label>
        {studioResult && (
          <div className="mt-4 grid gap-2 rounded-2xl bg-slate-50 p-4 text-sm font-bold text-slate-600 sm:grid-cols-3">
            <div>입력 콘텐츠 {studioResult.samples?.length || 0}개</div>
            <div>추출 패턴 {studioResult.patterns?.length || 0}개</div>
            <div>저장 {studioResult.savedCount || 0}개</div>
          </div>
        )}
      </form>

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
