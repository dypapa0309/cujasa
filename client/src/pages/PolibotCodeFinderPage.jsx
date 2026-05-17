import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, BadgeCheck, FileText, Search, ShieldCheck } from 'lucide-react';
import { api, setAuthToken } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

const quickSearches = ['33', '305', '암 진단비', '뇌혈관', '심장', '운전자'];

const statusLabels = {
  recommendable: '추천 가능',
  review_needed: '검수 필요',
  conflict: '충돌',
  privacy_risk: '개인정보 위험',
  ocr_needed: 'OCR 필요',
  excluded: '제외'
};

const statusClass = {
  recommendable: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  review_needed: 'border-amber-200 bg-amber-50 text-amber-700',
  conflict: 'border-red-200 bg-red-50 text-red-700',
  privacy_risk: 'border-rose-200 bg-rose-50 text-rose-700',
  ocr_needed: 'border-violet-200 bg-violet-50 text-violet-700',
  excluded: 'border-slate-200 bg-slate-50 text-slate-500'
};

function hasPolibotAccess(currentUser) {
  return (currentUser?.products || []).some((product) => product.productId === 'polibot' || product.id === 'polibot');
}

function statusLabel(status) {
  return statusLabels[status] || status || '상태 미확인';
}

function sourceStatusLabel(result) {
  if (result.sourceStatus && result.sourceStatus !== result.status) return `${statusLabel(result.status)} · 원본 ${statusLabel(result.sourceStatus)}`;
  return statusLabel(result.status);
}

export default function PolibotCodeFinderPage({ currentUser, onBack, onLogout }) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('');
  const [coverage, setCoverage] = useState('');
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const allowed = hasPolibotAccess(currentUser);

  const companies = useMemo(() => {
    const rows = payload?.results || [];
    return [...new Set(rows.flatMap((row) => row.companies || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [payload]);

  const coverages = useMemo(() => {
    const rows = payload?.results || [];
    return [...new Set(rows.flatMap((row) => row.coverageKeywords || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  }, [payload]);

  const runSearch = async (nextQuery = query) => {
    if (!allowed) {
      toast('POLIBOT 사용 권한이 필요합니다.', 'error');
      return;
    }
    const cleanQuery = String(nextQuery || '').trim();
    if (!cleanQuery && !company && !coverage) {
      toast('코드, 보장명, 보험사 중 하나를 입력해주세요.', 'error');
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (cleanQuery) params.set('q', cleanQuery);
      if (company) params.set('company', company);
      if (coverage) params.set('coverage', coverage);
      params.set('limit', '40');
      const next = await api.get(`/api/product-workspace/polibot/code-search?${params.toString()}`);
      setPayload(next);
      setQuery(cleanQuery);
    } catch (err) {
      toast(err.message || '코드 후보를 찾지 못했습니다.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!allowed) return;
    runSearch('33').catch(() => {});
  }, [allowed]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={onBack} className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label="뒤로">
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="text-lg font-black">POLIBOT 보장코드 찾기</div>
              <div className="text-xs font-semibold text-slate-500">{currentUser?.email || currentUser?.username}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setAuthToken('');
              onLogout?.();
            }}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5">
        {!allowed && (
          <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-800">
            <div className="flex items-center gap-2 text-sm font-black"><AlertTriangle size={17} /> POLIBOT 권한 필요</div>
            <p className="mt-2 text-sm leading-relaxed">이 미니앱은 POLIBOT 권한이 있는 계정에서만 사용할 수 있습니다.</p>
          </section>
        )}

        {allowed && (
          <>
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px_auto]">
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  코드 / 보장명
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 focus-within:border-slate-500">
                    <Search size={16} className="text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') runSearch();
                      }}
                      placeholder="예: 33, 305, 암 진단비"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  보험사
                  <input value={company} onChange={(event) => setCompany(event.target.value)} placeholder="선택 입력" list="polibot-code-companies" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </label>
                <label className="grid gap-1 text-sm font-bold text-slate-700">
                  보장
                  <input value={coverage} onChange={(event) => setCoverage(event.target.value)} placeholder="선택 입력" list="polibot-code-coverages" className="rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-500" />
                </label>
                <button type="button" onClick={() => runSearch()} disabled={loading} className="self-end rounded-xl bg-slate-950 px-4 py-2 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">
                  {loading ? '검색 중' : '검색'}
                </button>
              </div>
              <datalist id="polibot-code-companies">{companies.map((item) => <option key={item} value={item} />)}</datalist>
              <datalist id="polibot-code-coverages">{coverages.map((item) => <option key={item} value={item} />)}</datalist>
              <div className="mt-3 flex flex-wrap gap-2">
                {quickSearches.map((item) => (
                  <button key={item} type="button" onClick={() => runSearch(item)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-200">
                    {item}
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-bold text-slate-600">검색 결과 {payload?.count || 0}개</div>
                {payload?.notice && <div className="text-xs font-semibold text-slate-500">{payload.notice}</div>}
              </div>
              {(payload?.results || []).length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">아직 표시할 코드 후보가 없습니다.</div>
              )}
              {(payload?.results || []).map((result) => (
                <article key={`${result.code}-${result.sourceId}-${result.chunkId}-${result.context}`} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-lg bg-slate-950 px-3 py-1.5 text-lg font-black text-white">{result.code}</span>
                        <span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass[result.status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>{sourceStatusLabel(result)}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-500">{result.month || '월 미확인'}</span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(result.companies || []).slice(0, 5).map((item) => <span key={item} className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">{item}</span>)}
                        {(result.coverageKeywords || []).slice(0, 7).map((item) => <span key={item} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">{item}</span>)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
                      {result.status === 'recommendable' ? <BadgeCheck size={16} className="text-emerald-600" /> : <ShieldCheck size={16} className="text-amber-600" />}
                      점수 {result.score}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-slate-700">{result.context}</p>
                  <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-400">
                    <FileText size={14} />
                    <span className="truncate">{result.fileName || '근거 파일 없음'}</span>
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
