import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, DatabaseZap, EyeOff, MessageSquareWarning, RefreshCw, ShieldAlert, Upload } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';
import { dateTime } from '../lib/format.js';

const statusLabels = {
  all: '전체',
  recommendable: '추천 가능',
  review_needed: '검토 필요',
  excluded: '제외',
  ocr_needed: 'OCR 필요',
  privacy_risk: '개인정보 위험',
  conflict: '충돌'
};

const statusClass = {
  recommendable: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review_needed: 'border-amber-200 bg-amber-50 text-amber-700',
  excluded: 'border-slate-200 bg-slate-50 text-slate-500',
  ocr_needed: 'border-violet-200 bg-violet-50 text-violet-700',
  privacy_risk: 'border-rose-200 bg-rose-50 text-rose-700',
  conflict: 'border-red-200 bg-red-50 text-red-700'
};

const reviewStatuses = ['recommendable', 'review_needed', 'excluded', 'conflict'];
const sourceStatuses = ['recommendable', 'review_needed', 'excluded', 'ocr_needed', 'privacy_risk', 'conflict'];
const feedbackLabels = {
  good: '좋음',
  unclear: '애매함',
  wrong: '틀림'
};

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

function StatusPill({ status }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass[status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      {statusLabels[status] || status}
    </span>
  );
}

function SourceBadge({ item }) {
  if (!item?.imported) return null;
  return (
    <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
      이관 DB
    </span>
  );
}

function SummaryCard({ label, value, icon: Icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900 hover:border-slate-300'}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className={`text-sm font-semibold ${active ? 'text-slate-200' : 'text-slate-500'}`}>{label}</span>
        {Icon && <Icon size={17} className={active ? 'text-white' : 'text-slate-400'} />}
      </div>
      <div className="mt-2 text-2xl font-black">{value || 0}</div>
    </button>
  );
}

export default function AdminPolibotKnowledgePage() {
  const toast = useToast();
  const [payload, setPayload] = useState(null);
  const [status, setStatus] = useState('review_needed');
  const [scope, setScope] = useState('all');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState('');
  const [reviewNotes, setReviewNotes] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadForm, setUploadForm] = useState({ month: '', note: '', files: [] });

  const load = async () => {
    const query = new URLSearchParams({ status, scope, limit: '160' });
    const next = await api.get(`/api/admin/polibot/knowledge-review?${query.toString()}`);
    setPayload(next);
  };

  useEffect(() => {
    setLoading(true);
    load().catch(() => toast('POLIBOT 자료 검수 큐를 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, [status, scope]);

  const summary = payload?.summary || {};
  const sourceCounts = summary.sourceStatusCounts || {};
  const catalogCounts = summary.catalogStatusCounts || {};
  const catalogItems = payload?.catalogItems || [];
  const sources = payload?.sources || [];
  const recentJobs = payload?.recentJobs || [];
  const feedback = payload?.feedback || [];

  const totals = useMemo(() => ({
    review: (sourceCounts.review_needed || 0) + (catalogCounts.review_needed || 0),
    recommendable: (sourceCounts.recommendable || 0) + (catalogCounts.recommendable || 0),
    conflict: (sourceCounts.conflict || 0) + (catalogCounts.conflict || 0),
    privacy: sourceCounts.privacy_risk || 0,
    ocr: sourceCounts.ocr_needed || 0,
    excluded: (sourceCounts.excluded || 0) + (catalogCounts.excluded || 0),
    feedbackReview: summary.feedbackNeedsReview || 0,
    importedCatalog: summary.importedCatalogItems || 0,
    importedSources: summary.importedSources || 0
  }), [catalogCounts, sourceCounts, summary.feedbackNeedsReview, summary.importedCatalogItems, summary.importedSources]);

  const updateCatalogStatus = async (item, nextStatus) => {
    setSavingId(item.id);
    try {
      await api.patch(`/api/admin/polibot/catalog-items/${item.id}/review`, {
        status: nextStatus,
        reviewNote: reviewNotes[item.id] || ''
      });
      toast('상품 후보 상태를 저장했습니다.', 'success');
      await load();
    } catch (err) {
      toast(err.message || '상품 후보 상태 저장에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const updateSourceStatus = async (source, nextStatus) => {
    setSavingId(source.id);
    try {
      await api.patch(`/api/admin/polibot/sources/${source.id}/review`, {
        status: nextStatus,
        reviewNote: reviewNotes[source.id] || ''
      });
      toast('자료 상태를 저장했습니다.', 'success');
      await load();
    } catch (err) {
      toast(err.message || '자료 상태 저장에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const runSourceOcr = async (source) => {
    setSavingId(source.id);
    try {
      const result = await api.post(`/api/admin/polibot/sources/${source.id}/ocr`);
      if (result?.summary?.status === 'failed') {
        toast(result.summary.error || 'OCR 실행이 보류되었습니다.', 'error');
      } else {
        toast(`OCR 처리 완료: 상품 후보 ${result?.summary?.insertedCatalogItems || 0}개`, 'success');
      }
      await load();
    } catch (err) {
      toast(err.message || 'OCR 실행에 실패했습니다.', 'error');
    } finally {
      setSavingId('');
    }
  };

  const uploadKnowledgeFiles = async (fileList) => {
    const selected = Array.from(fileList || []);
    if (selected.length === 0) return;
    setUploading(true);
    try {
      const files = await Promise.all(selected.map(async (file) => ({
        fileName: file.name,
        name: file.name,
        size: file.size,
        type: file.type || '',
        base64: await fileToBase64(file)
      })));
      setUploadForm((prev) => ({ ...prev, files }));
      toast(`${files.length}개 자료를 선택했습니다.`, 'success');
    } catch (err) {
      toast(err.message || '자료 파일을 읽지 못했습니다.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const saveAdminKnowledge = async () => {
    if (uploadForm.files.length === 0 && !uploadForm.note.trim()) {
      toast('업로드할 자료나 메모를 입력해주세요.', 'error');
      return;
    }
    setUploading(true);
    try {
      const result = await api.post('/api/admin/polibot/knowledge', {
        month: uploadForm.month,
        note: uploadForm.note,
        files: uploadForm.files,
        sourceLabel: uploadForm.files.map((file) => file.fileName).join(', ') || '관리자 메모'
      });
      toast(`공통 자료 저장 완료: ${result?.summary?.insertedSources || 0}개 저장`, 'success');
      setUploadForm({ month: '', note: '', files: [] });
      await load();
    } catch (err) {
      toast(err.message || '공통 자료 저장에 실패했습니다.', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading && !payload) return <div className="rounded-2xl bg-white p-6 text-sm text-slate-500 shadow-sm">POLIBOT 자료 검수 큐를 불러오는 중입니다.</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-950">POLIBOT 자료 검수</h1>
          <p className="mt-1 text-sm text-slate-500">공통/사용자 지식베이스 자료와 상품 후보 상태를 확인합니다.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
          <RefreshCw size={15} /> 새로고침
        </button>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-950">공통 자료 업로드</h2>
            <p className="mt-1 text-sm text-slate-500">관리자가 올린 자료는 모든 POLIBOT 추천에 쓰이는 공통 지식베이스로 저장됩니다.</p>
          </div>
          <button
            type="button"
            onClick={saveAdminKnowledge}
            disabled={uploading || (uploadForm.files.length === 0 && !uploadForm.note.trim())}
            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Upload size={15} /> {uploading ? '처리 중...' : '공통 자료 저장'}
          </button>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            자료 월
            <input
              value={uploadForm.month}
              onChange={(event) => setUploadForm((prev) => ({ ...prev, month: event.target.value }))}
              placeholder="예: 2026-05"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
            />
          </label>
          <label className="grid gap-1 text-sm font-semibold text-slate-700">
            자료 파일
            <span className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
              <span className="truncate">{uploadForm.files.length ? `${uploadForm.files.length}개 자료 선택됨` : 'PDF/PPTX/DOCX/HWP/CSV/TXT/이미지 업로드'}</span>
              <Upload size={15} />
              <input
                type="file"
                multiple
                accept=".pdf,.ppt,.pptx,.docx,.hwp,.csv,.txt,.jpg,.jpeg,.png,.webp"
                className="hidden"
                onChange={(event) => uploadKnowledgeFiles(event.target.files)}
              />
            </span>
          </label>
        </div>
        <label className="mt-3 grid gap-1 text-sm font-semibold text-slate-700">
          자료 메모
          <textarea
            value={uploadForm.note}
            onChange={(event) => setUploadForm((prev) => ({ ...prev, note: event.target.value }))}
            rows={3}
            placeholder="파일 없이 월별 변경사항이나 운영 메모만 저장할 수도 있습니다."
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
          />
        </label>
      </section>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
        <SummaryCard label="검토 필요" value={totals.review} icon={AlertTriangle} active={status === 'review_needed'} onClick={() => setStatus('review_needed')} />
        <SummaryCard label="추천 가능" value={totals.recommendable} icon={CheckCircle2} active={status === 'recommendable'} onClick={() => setStatus('recommendable')} />
        <SummaryCard label="실제 추출 DB" value={totals.importedCatalog} icon={DatabaseZap} />
        <SummaryCard label="충돌" value={totals.conflict} icon={ShieldAlert} active={status === 'conflict'} onClick={() => setStatus('conflict')} />
        <SummaryCard label="개인정보 위험" value={totals.privacy} icon={EyeOff} active={status === 'privacy_risk'} onClick={() => setStatus('privacy_risk')} />
        <SummaryCard label="OCR 필요" value={totals.ocr} icon={DatabaseZap} active={status === 'ocr_needed'} onClick={() => setStatus('ocr_needed')} />
        <SummaryCard label="피드백 검수" value={totals.feedbackReview} icon={MessageSquareWarning} />
      </div>

      {totals.importedSources > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-black text-slate-950">연결된 실제 추출 데이터</h2>
              <p className="mt-1 text-sm text-slate-500">
                별도 파서에서 읽은 문서 {totals.importedSources}개와 상품 후보 {totals.importedCatalog}개를 POLIBOT 추천 근거로 함께 사용합니다.
              </p>
            </div>
            <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black text-slate-700">
              최신 자료월 {summary.latestMonth || '-'}
            </div>
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {Object.keys(statusLabels).map((key) => (
          <button key={key} onClick={() => setStatus(key)} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${status === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {statusLabels[key]}
          </button>
        ))}
        <select value={scope} onChange={(event) => setScope(event.target.value)} className="ml-auto rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-sm font-semibold text-slate-700">
          <option value="all">전체 범위</option>
          <option value="global">공통 자료</option>
          <option value="user">사용자 자료</option>
        </select>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">상품 후보</h2>
          <p className="mt-1 text-sm text-slate-500">추천 가능 여부를 직접 확정하거나 충돌/제외 상태로 정리합니다.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {catalogItems.length === 0 && <div className="p-5 text-sm text-slate-500">현재 필터에 해당하는 상품 후보가 없습니다.</div>}
          {catalogItems.map((item) => (
            <div key={item.id} className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={item.status} />
                  <SourceBadge item={item} />
                  <span className="text-xs font-semibold text-slate-400">{item.scope === 'global' ? '공통' : '사용자'} · {item.effectiveMonth || '월 미확인'}</span>
                </div>
                <div className="mt-2 text-base font-black text-slate-950">{item.company} {item.productName}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {item.productGroup || '상품군 미확인'} · 보험료 {item.premiumExample || '없음'} · 가입연령 {item.ageRange || '없음'} · {item.renewalType || '갱신 정보 없음'}
                </div>
                {item.imported && (
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <span className="font-bold">연결 강도</span> {item.linkConfidence || '확인 필요'} · {item.linkScore || 0}점
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-800">담보</span> {(item.coverageDetails || item.coverageKeywords || []).length}개
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-800">보험료표</span> {(item.premiumExamples || []).length}개
                    </div>
                  </div>
                )}
                {item.coverageKeywords?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.coverageKeywords.slice(0, 8).map((keyword) => (
                      <span key={keyword} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{keyword}</span>
                    ))}
                  </div>
                )}
                {item.premiumExamples?.length > 0 && (
                  <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-600">
                    {item.premiumExamples.slice(0, 3).map((row) => [row.gender, row.age && `${row.age}세`, row.premium || row.amount].filter(Boolean).join(' · ')).join(' / ')}
                  </div>
                )}
                {item.conflictReasons?.length > 0 && (
                  <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-semibold leading-relaxed text-red-700">
                    {item.conflictReasons.join(' · ')}
                  </div>
                )}
                <div className="mt-2 text-xs text-slate-400">{item.evidence?.fileName || item.evidenceFile || '근거 파일 없음'}</div>
              </div>
              <div className="grid gap-2">
                <textarea
                  value={reviewNotes[item.id] || item.reviewNote || ''}
                  onChange={(event) => setReviewNotes((prev) => ({ ...prev, [item.id]: event.target.value }))}
                  placeholder={item.imported ? '이관 DB 상태 변경은 반영되고, 메모는 POLIBOT 전용 후보에서 저장됩니다.' : '검수 메모'}
                  disabled={item.readOnly}
                  className="min-h-16 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <div className="grid grid-cols-2 gap-2">
                  {reviewStatuses.map((nextStatus) => (
                    <button
                      key={nextStatus}
                      disabled={savingId === item.id}
                      onClick={() => updateCatalogStatus(item, nextStatus)}
                      className="rounded-xl border border-slate-200 px-2 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {statusLabels[nextStatus]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">원본 자료</h2>
          <p className="mt-1 text-sm text-slate-500">개인정보 위험, OCR 필요, 제외 자료를 별도로 관리합니다.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {sources.length === 0 && <div className="p-5 text-sm text-slate-500">현재 필터에 해당하는 원본 자료가 없습니다.</div>}
          {sources.map((source) => (
            <div key={source.id} className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPill status={source.status} />
                  <SourceBadge item={source} />
                  <span className="text-xs font-semibold text-slate-400">{source.scope === 'global' ? '공통' : '사용자'} · {source.sourceChannel || '출처 미확인'} · {dateTime(source.createdAt)}</span>
                </div>
                <div className="mt-2 text-base font-black text-slate-950">{source.fileName}</div>
                <div className="mt-1 text-sm text-slate-500">
                  품질 {source.evidenceQualityScore || 0}점 · 개인정보 위험 {source.privacyRiskScore || 0}점 · {source.company || '미분류'}
                </div>
                {source.imported && (
                  <div className="mt-2 grid gap-2 md:grid-cols-4">
                    <div className="rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-800">
                      <span className="font-bold">상품 후보</span> {source.catalogItemCount || 0}개
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-800">보험료표</span> {source.premiumTableRowCount || 0}개
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-800">담보근거</span> {source.coverageDetailCount || 0}개
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                      <span className="font-bold text-slate-800">연결그룹</span> {source.linkedBenefitGroupCount || 0}개
                    </div>
                  </div>
                )}
                {source.textSnippet && <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-slate-500">{source.textSnippet}</p>}
                {(source.ocrStatus || source.ocrLastError) && (
                  <div className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-xs font-semibold leading-relaxed text-violet-700">
                    OCR {source.ocrStatus || '대기'} · 시도 {source.ocrAttempts || 0}회
                    {source.ocrModel ? ` · ${source.ocrModel}` : ''}
                    {source.ocrLastError ? ` · ${source.ocrLastError}` : ''}
                  </div>
                )}
              </div>
              <div className="grid gap-2">
                <textarea
                  value={reviewNotes[source.id] || source.reviewNote || ''}
                  onChange={(event) => setReviewNotes((prev) => ({ ...prev, [source.id]: event.target.value }))}
                  placeholder={source.readOnly ? '이관 원본은 원본 DB에서 관리됩니다.' : '자료 메모'}
                  disabled={source.readOnly}
                  className="min-h-16 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <select
                  disabled={savingId === source.id || source.readOnly}
                  value={source.status}
                  onChange={(event) => updateSourceStatus(source, event.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                >
                  {sourceStatuses.map((nextStatus) => <option key={nextStatus} value={nextStatus}>{statusLabels[nextStatus]}</option>)}
                </select>
                {source.status === 'ocr_needed' && !source.readOnly && (
                  <button
                    type="button"
                    disabled={savingId === source.id}
                    onClick={() => runSourceOcr(source)}
                    className="rounded-xl bg-violet-600 px-3 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-50"
                  >
                    OCR 실행
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {recentJobs.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-black text-slate-950">최근 처리</h2>
          <div className="mt-3 grid gap-2">
            {recentJobs.slice(0, 6).map((job) => (
              <div key={job.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span className="font-bold text-slate-900">{job.status}</span> · {job.scope} · {job.sourceChannel} · 저장 {job.summary?.insertedSources || 0} · 중복 {job.summary?.duplicateSources || 0} · {dateTime(job.createdAt)}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-slate-950">추천 피드백</h2>
          <p className="mt-1 text-sm text-slate-500">애매함/틀림 피드백은 검수 우선순위로 보고 추천 근거를 확인합니다.</p>
        </div>
        <div className="divide-y divide-slate-100">
          {feedback.length === 0 && <div className="p-5 text-sm text-slate-500">저장된 추천 피드백이 없습니다.</div>}
          {feedback.map((row) => (
            <div key={row.id} className="grid gap-3 p-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${
                    row.rating === 'good'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : row.rating === 'wrong'
                        ? 'border-red-200 bg-red-50 text-red-700'
                        : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {feedbackLabels[row.rating] || row.rating}
                  </span>
                  {row.routedToReview && <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">검수 필요</span>}
                  <span className="text-xs font-semibold text-slate-400">{dateTime(row.createdAt)}</span>
                </div>
                <div className="mt-2 text-base font-black text-slate-950">{row.recommendationName || row.recommendationId}</div>
                <div className="mt-1 text-sm text-slate-500">
                  {row.reason || '사유 없음'}{row.memo ? ` · ${row.memo}` : ''}
                </div>
                {row.productNames?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {row.productNames.map((name) => (
                      <span key={name} className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">{name}</span>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-500">
                <div className="font-bold text-slate-700">근거 추적</div>
                <div className="mt-1">자료 {row.usedSourceIds?.length || 0}개</div>
                <div>추천 점수 {row.recommendationScore || '-'}</div>
                <div>최신 자료 {row.knowledgeSnapshot?.latestKnowledgeMonth || '-'}</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
