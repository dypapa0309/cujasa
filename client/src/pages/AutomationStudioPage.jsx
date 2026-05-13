import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { BarChart3, CalendarDays, CheckCircle2, ClipboardPen, Clock3, Edit3, Eye, Filter, Image, MousePointerClick, PauseCircle, PlayCircle, Plus, RefreshCw, Search, Send, SquareStack, Target, Trash2, TrendingUp, Upload, Users, XCircle } from 'lucide-react';

const inputClass = 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-900';
const labelClass = 'grid gap-1.5 text-xs font-bold text-slate-600';

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function statusLabel(status) {
  return {
    draft: '초안',
    running: '실행 중',
    needs_review: '검수 필요',
    stopped: '중지',
    completed: '완료'
  }[status] || status;
}

function assetStatusLabel(status) {
  return {
    draft: '초안',
    preview: '미리보기',
    needs_review: '검수 필요',
    approved: '승인됨',
    queued: '예약됨',
    posted: '게시됨',
    rejected: '반려',
    stopped: '중지'
  }[status] || status;
}

function queueStatusLabel(status) {
  return {
    scheduled: '예약됨',
    posting: '게시 중',
    posted: '게시됨',
    failed: '실패',
    retry: '재시도',
    manual_required: '수동 확인',
    skipped: '제외됨'
  }[status] || status;
}

function platformLabel(platform) {
  return platform === 'instagram' ? 'Instagram' : 'Threads';
}

function objectiveLabel(value) {
  return {
    click: '클릭 유도',
    consultation: '상담 전환',
    save_follow: '저장/팔로우',
    awareness: '제품 인지도',
    lead: '리드 수집'
  }[value] || value;
}

function priorityLabel(value) {
  return {
    low: '낮음',
    normal: '보통',
    high: '높음'
  }[value] || value;
}

function conversionDestinationLabel(value) {
  return {
    website: '웹사이트',
    lead_form: '리드 폼',
    dm_or_form: 'DM/상담 폼',
    profile: '프로필'
  }[value] || value;
}

function previewCopyForForm(form) {
  const variants = previewCopyVariantsForForm(form);
  if (variants.length) return variants[0];
  const product = form.productName?.trim() || '쿠자사';
  if (form.objectiveType === 'lead') return `${product} 자동화가 궁금하다면 ${form.leadOffer || '무료 안내'}부터 받아보세요.`;
  if (form.objectiveType === 'consultation') return `${product} 도입이 고민된다면 지금 운영 상황부터 가볍게 상담해보세요.`;
  if (form.objectiveType === 'save_follow') return `${product} 자동화가 필요할 때 다시 보려고 저장해두세요.`;
  if (form.objectiveType === 'awareness') return `${product}로 상품 찾기, 글 생성, 예약 운영을 한 번에 줄여보세요.`;
  return `${product} 소개 페이지에서 자동화 흐름을 바로 확인해보세요.`;
}

function previewMessageConcept(value) {
  return String(value || '')
    .trim()
    .replace(/수익\s*창출|수익창출/g, '수익화 운영')
    .replace(/수익\s*보장|무조건\s*수익|100%\s*수익|자동으로\s*돈\s*벌(?:기)?/g, '수익화 운영')
    .replace(/[.!?。]+$/g, '')
    .replace(/\s*(합니다|해요|한다|하다|입니다|이에요|예요|됩니다|된다|되다)$/g, '')
    .replace(/\s*(돕는다|돕습니다|도와요)$/g, '돕는 흐름')
    .replace(/\s+/g, ' ')
    .slice(0, 42);
}

function previewCopyVariantsForForm(form) {
  const concept = previewMessageConcept(form.primaryMessage);
  if (!concept) return [];
  const product = form.productName?.trim() || '쿠자사';
  const audience = String(form.targetAudience || '').split(/[,/·|]/).map((item) => item.trim()).filter(Boolean)[0] || '운영자';
  return [
    `${concept}이 목표라면 ${product}로 상품 선정부터 예약까지 흐름을 잡아보세요.`,
    `매번 손으로 반복하던 ${concept}, ${product}로 글 생성과 예약을 나눠서 줄여보세요.`,
    `${audience}에게는 ${product}처럼 ${concept} 흐름을 꾸준히 돌릴 운영 루틴이 필요합니다.`
  ];
}

function qualityScore(asset) {
  const score = asset?.metadata?.qualityScore ?? asset?.metadata?.quality?.qualityScore;
  return Number.isFinite(Number(score)) ? Number(score) : null;
}

function qualityTone(score) {
  if (score == null) return 'bg-slate-100 text-slate-500';
  if (score >= 76) return 'bg-emerald-50 text-emerald-700';
  if (score >= 58) return 'bg-amber-50 text-amber-700';
  return 'bg-rose-50 text-rose-700';
}

function qualityLabel(asset) {
  const score = qualityScore(asset);
  if (score == null) return '미검사';
  if (score >= 76) return `좋음 ${score}`;
  if (score >= 58) return `검수 ${score}`;
  return `약함 ${score}`;
}

function qualityWarnings(asset) {
  return asset?.metadata?.qualityWarnings || asset?.metadata?.quality?.warnings || [];
}

function campaignQuality(campaign) {
  const scores = (campaign.assets || []).map(qualityScore).filter((score) => score != null);
  const needsReview = (campaign.assets || []).filter((asset) => {
    const score = qualityScore(asset);
    return score != null && score < 76;
  }).length;
  if (!scores.length) return { average: null, needsReview };
  return {
    average: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    needsReview
  };
}

function emptyForm(accounts) {
  return {
    accountId: accounts[0]?.id || '',
    name: '',
    productName: '',
    productUrl: '',
    productPrice: '',
    productImageUrl: '',
    objectiveType: 'click',
    targetGoal: '제품 관심 전환과 클릭 유도',
    targetAudience: '',
    accountHandle: '',
    priority: 'normal',
    optimizationGoal: 'click',
    conversionDestination: 'website',
    leadOffer: '무료 도입 안내',
    leadFields: ['name', 'phone'],
    leadPrivacyNote: '제출한 정보는 상담 안내와 캠페인 성과 확인 목적으로만 사용합니다.',
    leadThankYouMessage: '신청이 접수되었습니다. 운영자가 확인 후 연락드릴게요.',
    audienceStage: 'cold',
    audiencePersona: '',
    audiencePain: '',
    placementMode: 'threads_instagram_feed',
    creativeFormat: 'short_copy_square_card',
    primaryMessage: '',
    proofPoint: '',
    complianceNote: '',
    toneStyle: 'clear_operator',
    hookStyle: 'situation_first',
    cardStyle: 'square_product_card',
    activeStart: '09:00',
    activeEnd: '21:00',
    nextActionNote: '',
    days: 3,
    dailyPostMin: 1,
    dailyPostMax: 2,
    platforms: ['threads', 'instagram']
  };
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve('');
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('이미지를 읽지 못했습니다.'));
    reader.readAsDataURL(file);
  });
}

export default function AutomationStudioPage({ accounts = [] }) {
  const [campaigns, setCampaigns] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [form, setForm] = useState(() => emptyForm(accounts));
  const [loading, setLoading] = useState(false);
  const [analytics, setAnalytics] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [createStep, setCreateStep] = useState(0);
  const [activeView, setActiveView] = useState('campaigns');
  const [tableLevel, setTableLevel] = useState('campaigns');
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const selected = campaigns.find((campaign) => campaign.id === selectedId) || campaigns[0] || null;
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const selectedAccount = accountById.get(form.accountId);
  const filteredCampaigns = useMemo(() => {
    const q = query.trim().toLowerCase();
    return campaigns.filter((campaign) => {
      if (statusFilter !== 'all' && campaign.status !== statusFilter) return false;
      if (channelFilter !== 'all' && !(campaign.platforms || []).includes(channelFilter)) return false;
      if (!q) return true;
      return [campaign.name, campaign.product_name, campaign.target_goal, campaign.objective_type, campaign.generation_input?.objectiveType, accountById.get(campaign.account_id)?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [accountById, campaigns, query, statusFilter, channelFilter]);
  const totals = useMemo(() => ({
    campaigns: campaigns.length,
    scheduled: campaigns.reduce((sum, row) => sum + (row.stats?.scheduled || 0), 0),
    posted: campaigns.reduce((sum, row) => sum + (row.stats?.posted || 0), 0),
    clicks: campaigns.reduce((sum, row) => sum + (row.stats?.clicks || 0), 0),
    reviewNeeded: campaigns.reduce((sum, row) => sum + campaignQuality(row).needsReview, 0)
  }), [campaigns]);

  const loadAnalytics = async (campaignId = '') => {
    setAnalyticsLoading(true);
    try {
      const suffix = campaignId ? `?campaignId=${encodeURIComponent(campaignId)}` : '';
      setAnalytics(await api.get(`/api/admin/automation-studio/analytics${suffix}`));
    } finally {
      setAnalyticsLoading(false);
    }
  };

  const load = async () => {
    setLoading(true);
    try {
      const rows = await api.get('/api/admin/automation-studio/campaigns');
      setCampaigns(rows);
      if (!rows.some((row) => row.id === selectedId)) setSelectedId(rows[0]?.id || '');
      await loadAnalytics();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    setForm((prev) => prev.accountId ? prev : { ...prev, accountId: accounts[0]?.id || '' });
  }, [accounts]);

  useEffect(() => {
    if (!selectedId) return undefined;
    let cancelled = false;
    api.get(`/api/admin/automation-studio/campaigns/${selectedId}`)
      .then((detail) => {
        if (cancelled) return;
        setCampaigns((rows) => rows.some((row) => row.id === detail.id)
          ? rows.map((row) => row.id === detail.id ? detail : row)
          : [detail, ...rows]);
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [selectedId]);

  useEffect(() => {
    const applyLocationState = () => {
      const params = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
      const view = params.get('view');
      const campaignId = params.get('campaign');
      const level = params.get('level');
      const platform = params.get('platform');
      if (view) setActiveView(view);
      if (campaignId) setSelectedId(campaignId);
      if (level) setTableLevel(level);
      setSelectedPlatform(platform || 'all');
    };
    applyLocationState();
    window.addEventListener('popstate', applyLocationState);
    window.addEventListener('hashchange', applyLocationState);
    return () => {
      window.removeEventListener('popstate', applyLocationState);
      window.removeEventListener('hashchange', applyLocationState);
    };
  }, []);

  const navigateWorkspace = (next = {}) => {
    const view = next.view || activeView;
    const campaignId = Object.prototype.hasOwnProperty.call(next, 'campaignId') ? next.campaignId : selectedId;
    const level = next.level || tableLevel;
    const platform = next.platform || 'all';
    setActiveView(view);
    if (campaignId) setSelectedId(campaignId);
    setTableLevel(level);
    setSelectedPlatform(platform);
    const params = new URLSearchParams();
    params.set('view', view);
    if (campaignId) params.set('campaign', campaignId);
    params.set('level', level);
    if (platform !== 'all') params.set('platform', platform);
    window.history.pushState({}, '', `#${params.toString()}`);
  };

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const togglePlatform = (platform) => {
    setForm((prev) => {
      const has = prev.platforms.includes(platform);
      const platforms = has ? prev.platforms.filter((item) => item !== platform) : [...prev.platforms, platform];
      return { ...prev, platforms: platforms.length ? platforms : [platform] };
    });
  };

  const uploadProductImage = async (file) => {
    if (!file) return;
    const dataUrl = await readImageFile(file);
    update('productImageUrl', dataUrl);
  };

  const createCampaign = async (event) => {
    event.preventDefault();
    if (!form.accountId) {
      setCreateStep(1);
      return;
    }
    if (!form.productName.trim()) {
      setCreateStep(2);
      return;
    }
    setSaving(true);
    try {
      const created = await api.post('/api/admin/automation-studio/campaigns', {
        ...form,
        days: Number(form.days),
        dailyPostMin: Number(form.dailyPostMin),
        dailyPostMax: Number(form.dailyPostMax),
        productPrice: form.productPrice ? Number(form.productPrice) : null
      });
      setCampaigns((rows) => [created, ...rows]);
      setSelectedId(created.id);
      navigateWorkspace({ view: 'detail', campaignId: created.id, platform: 'all' });
      setForm(emptyForm(accounts));
      setCreateStep(0);
    } finally {
      setSaving(false);
    }
  };

  const runCampaign = async (campaignId) => {
    const next = await api.post(`/api/admin/automation-studio/campaigns/${campaignId}/run`, {});
    setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
    setSelectedId(next.id);
    loadAnalytics(next.id).catch(console.error);
    navigateWorkspace({ view: 'detail', campaignId: next.id });
  };

  const regenerateCampaignAssets = async (campaignId) => {
    setUpdatingId(`${campaignId}:regenerate`);
    try {
      const next = await api.post(`/api/admin/automation-studio/campaigns/${campaignId}/regenerate-assets`, {});
      setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
      setSelectedId(next.id);
      loadAnalytics(next.id).catch(console.error);
      navigateWorkspace({ view: 'detail', campaignId: next.id });
    } finally {
      setUpdatingId('');
    }
  };

  const stopCampaign = async (campaignId) => {
    const next = await api.post(`/api/admin/automation-studio/campaigns/${campaignId}/stop`, {});
    setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
    setSelectedId(next.id);
    loadAnalytics(next.id).catch(console.error);
  };

  const updateAsset = async (campaignId, assetId, patch) => {
    setUpdatingId(assetId);
    try {
      const next = await api.patch(`/api/admin/automation-studio/campaigns/${campaignId}/assets/${assetId}`, patch);
      setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
      setSelectedId(next.id);
    } finally {
      setUpdatingId('');
    }
  };

  const rewriteAsset = async (campaignId, assetId) => {
    setUpdatingId(`rewrite:${assetId}`);
    try {
      const next = await api.post(`/api/admin/automation-studio/campaigns/${campaignId}/assets/${assetId}/rewrite`, {});
      setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
      setSelectedId(next.id);
      loadAnalytics(next.id).catch(console.error);
    } finally {
      setUpdatingId('');
    }
  };

  const expandAsset = async (campaignId, assetId) => {
    setUpdatingId(`expand:${assetId}`);
    try {
      const created = await api.post(`/api/admin/automation-studio/campaigns/${campaignId}/assets/${assetId}/expand`, {});
      setCampaigns((rows) => [created, ...rows.filter((row) => row.id !== created.id)]);
      setSelectedId(created.id);
      navigateWorkspace({ view: 'detail', campaignId: created.id, platform: 'all' });
      loadAnalytics(created.id).catch(console.error);
    } finally {
      setUpdatingId('');
    }
  };

  const bulkApproveAssets = async (campaignId, assets = []) => {
    const targetAssets = assets.filter((asset) => !['approved', 'posted', 'stopped'].includes(asset.review_status || asset.status));
    if (!targetAssets.length) return;
    setUpdatingId(`${campaignId}:bulk`);
    try {
      let nextCampaign = null;
      for (const asset of targetAssets) {
        nextCampaign = await api.patch(`/api/admin/automation-studio/campaigns/${campaignId}/assets/${asset.id}`, { status: 'approved' });
      }
      if (nextCampaign) {
        setCampaigns((rows) => rows.map((row) => row.id === nextCampaign.id ? nextCampaign : row));
        setSelectedId(nextCampaign.id);
      }
    } finally {
      setUpdatingId('');
    }
  };

  const updateCampaignNote = async (campaignId, nextActionNote) => {
    setUpdatingId(campaignId);
    try {
      const next = await api.patch(`/api/admin/automation-studio/campaigns/${campaignId}`, { nextActionNote });
      setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
      setSelectedId(next.id);
    } finally {
      setUpdatingId('');
    }
  };

  const updateCampaignImage = async (campaignId, productImageUrl) => {
    setUpdatingId(`${campaignId}:image`);
    try {
      const next = await api.patch(`/api/admin/automation-studio/campaigns/${campaignId}`, { productImageUrl });
      setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
      setSelectedId(next.id);
    } finally {
      setUpdatingId('');
    }
  };

  const deleteCampaign = async (campaignId) => {
    if (!window.confirm('캠페인을 삭제할까요?')) return;
    await api.delete(`/api/admin/automation-studio/campaigns/${campaignId}`);
    setCampaigns((rows) => rows.filter((row) => row.id !== campaignId));
    if (selectedId === campaignId) setSelectedId(campaigns.find((row) => row.id !== campaignId)?.id || '');
  };

  const deleteSet = async (campaignId, platform) => {
    if (!window.confirm(`${platformLabel(platform)} 세트를 삭제할까요?`)) return;
    const next = await api.delete(`/api/admin/automation-studio/campaigns/${campaignId}/sets/${platform}`);
    setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
  };

  const deleteAsset = async (campaignId, assetId) => {
    if (!window.confirm('소재를 삭제할까요?')) return;
    const next = await api.delete(`/api/admin/automation-studio/campaigns/${campaignId}/assets/${assetId}`);
    setCampaigns((rows) => rows.map((row) => row.id === next.id ? next : row));
  };

  return (
    <div className="grid gap-5">
      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-slate-500">JASAIN Ads Manager</div>
            <h2 className="mt-1 text-2xl font-black text-slate-950">오토메이션 스튜디오</h2>
            <p className="mt-1 text-sm text-slate-500">캠페인, 소재, 예약 큐, 성과를 한 곳에서 운영합니다.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={load} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">
              <RefreshCw size={16} /> 새로고침
            </button>
            <button type="button" onClick={() => navigateWorkspace({ view: 'create', platform: 'all' })} className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white">
              <Plus size={16} /> 새 캠페인
            </button>
          </div>
        </div>
        <div className="grid gap-px bg-slate-100 md:grid-cols-5">
          <Metric title="캠페인" value={totals.campaigns} icon={<Target size={18} />} />
          <Metric title="예약/대기" value={totals.scheduled} icon={<CalendarDays size={18} />} />
          <Metric title="게시완료" value={totals.posted} icon={<CheckCircle2 size={18} />} />
          <Metric title="클릭" value={totals.clicks} icon={<MousePointerClick size={18} />} />
          <Metric title="검수 필요" value={totals.reviewNeeded} icon={<Filter size={18} />} />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-1">
            <WorkspaceTab active={activeView === 'campaigns'} onClick={() => navigateWorkspace({ view: 'campaigns', platform: 'all' })} icon={<Filter size={16} />} label="캠페인" />
            <WorkspaceTab active={activeView === 'detail'} onClick={() => navigateWorkspace({ view: 'detail' })} icon={<Target size={16} />} label="상세" disabled={!selected} />
            <WorkspaceTab active={activeView === 'assets'} onClick={() => navigateWorkspace({ view: 'assets' })} icon={<SquareStack size={16} />} label="소재 검수" disabled={!selected} />
            <WorkspaceTab active={activeView === 'schedule'} onClick={() => navigateWorkspace({ view: 'schedule' })} icon={<CalendarDays size={16} />} label="예약/성과" disabled={!selected} />
            <WorkspaceTab active={activeView === 'analytics'} onClick={() => { navigateWorkspace({ view: 'analytics' }); loadAnalytics(selected?.id).catch(console.error); }} icon={<BarChart3 size={16} />} label="애널리틱스" disabled={!selected} />
            <WorkspaceTab active={activeView === 'create'} onClick={() => navigateWorkspace({ view: 'create', platform: 'all' })} icon={<Plus size={16} />} label="만들기" />
          </div>
          <div className="min-w-0 text-xs font-bold text-slate-500">
            {selected ? `${selected.name} · ${selected.product_name}` : '캠페인을 선택하세요'}
          </div>
        </div>

        {activeView === 'create' && (
          <CreateCampaignWizard
            accounts={accounts}
            form={form}
            update={update}
            selectedAccount={selectedAccount}
            saving={saving}
            step={createStep}
            setStep={setCreateStep}
            onSubmit={createCampaign}
            togglePlatform={togglePlatform}
            uploadProductImage={uploadProductImage}
          />
        )}

        {activeView === 'campaigns' && (
        <div className="grid gap-5 p-5">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2 text-sm font-black text-slate-900"><Filter size={16} /> 캠페인 운영판</div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-slate-900 sm:w-64"
                    value={query} onChange={(event) => setQuery(event.target.value)} placeholder="캠페인/제품 검색" />
                </div>
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="all">전체 상태</option>
                  <option value="draft">초안</option>
                  <option value="running">실행 중</option>
                  <option value="stopped">중지</option>
                  <option value="completed">완료</option>
                </select>
                <select className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700 outline-none focus:border-slate-900"
                  value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}>
                  <option value="all">전체 채널</option>
                  <option value="threads">Threads</option>
                  <option value="instagram">Instagram</option>
                </select>
              </div>
            </div>
            <ManagementTable
              campaigns={filteredCampaigns}
              accountById={accountById}
              loading={loading}
              level={tableLevel}
              onLevelChange={(level) => navigateWorkspace({ view: 'campaigns', level, platform: 'all' })}
              selectedId={selected?.id}
              onSelect={(campaignId, nextView = 'detail', platform = 'all') => navigateWorkspace({ view: nextView, campaignId, platform })}
              onDeleteCampaign={deleteCampaign}
              onDeleteSet={deleteSet}
              onDeleteAsset={deleteAsset}
            />
          </div>
        </div>
        )}

        {activeView === 'detail' && (
          <div className="p-5">
            <CampaignDetail campaign={selected} selectedPlatform={selectedPlatform} onRun={runCampaign} onRegenerateAssets={regenerateCampaignAssets} onStop={stopCampaign} onDeleteCampaign={deleteCampaign} onDeleteSet={deleteSet} onUpdateAsset={updateAsset} onRewriteAsset={rewriteAsset} onUpdateCampaignNote={updateCampaignNote} onUpdateCampaignImage={updateCampaignImage} updatingId={updatingId} />
          </div>
        )}

        {activeView === 'assets' && (
          <div className="p-5">
            <AssetsReviewWorkspace campaign={selected} selectedPlatform={selectedPlatform} onSelectPlatform={(platform) => navigateWorkspace({ view: 'assets', platform })} onUpdateAsset={updateAsset} onRewriteAsset={rewriteAsset} onBulkApprove={bulkApproveAssets} onDeleteAsset={deleteAsset} updatingId={updatingId} />
          </div>
        )}

        {activeView === 'schedule' && (
          <div className="p-5">
            <ScheduleWorkspace campaign={selected} selectedPlatform={selectedPlatform} onSelectPlatform={(platform) => navigateWorkspace({ view: 'schedule', platform })} />
          </div>
        )}

        {activeView === 'analytics' && (
          <div className="p-5">
            <AnalyticsWorkspace campaign={selected} analytics={analytics} loading={analyticsLoading} updatingId={updatingId} onRefresh={() => loadAnalytics(selected?.id)} onExpandAsset={expandAsset} />
          </div>
        )}
      </section>
    </div>
  );
}

function CreateCampaignWizard({ accounts, form, update, selectedAccount, saving, step, setStep, onSubmit, togglePlatform, uploadProductImage }) {
  const [creativeTab, setCreativeTab] = useState('settings');
  const steps = [
    { title: '캠페인 목표', desc: '무엇을 최적화할지 정합니다.', icon: <Target size={17} /> },
    { title: '운영 세트', desc: '계정, 타깃, 채널, 예약량을 잡습니다.', icon: <Filter size={17} /> },
    { title: '소재 설정', desc: '제품 정보와 이미지, 톤을 확정합니다.', icon: <SquareStack size={17} /> }
  ];
  const canGoNext = step === 0
    ? Boolean(form.objectiveType && form.targetGoal)
    : step === 1
      ? Boolean(form.platforms.length && form.days && form.dailyPostMax)
      : Boolean(form.productName);
  const maxReachableStep = !form.objectiveType || !form.targetGoal ? 0 : (!form.platforms.length || !form.days || !form.dailyPostMax ? 1 : 2);
  const next = () => setStep(Math.min(2, step + 1));
  const back = () => setStep(Math.max(0, step - 1));
  const toggleLeadField = (field) => {
    const current = Array.isArray(form.leadFields) ? form.leadFields : [];
    update('leadFields', current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  };
  return (
    <div id="automation-create" className="p-5">
      <form className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[240px_minmax(0,1fr)_300px]" onSubmit={onSubmit}>
        <div className="h-fit rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="px-2 pb-2 text-xs font-black uppercase tracking-wide text-slate-500">Create Flow</div>
          <div className="grid gap-1">
            {steps.map((item, index) => (
              <button key={item.title} type="button" onClick={() => setStep(index)} disabled={index > maxReachableStep}
                className={`rounded-lg p-3 text-left disabled:cursor-not-allowed disabled:opacity-40 ${step === index ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-white'}`}>
                <div className="flex items-center gap-2 text-sm font-black">
                  <span className={`grid h-6 w-6 place-items-center rounded-md ${step === index ? 'bg-white text-slate-900' : 'bg-white text-slate-500'}`}>{index + 1}</span>
                  {item.title}
                </div>
                <div className={`mt-1 text-xs leading-relaxed ${step === index ? 'text-slate-200' : 'text-slate-500'}`}>{item.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <div className="inline-flex items-center gap-2 text-lg font-black text-slate-950">{steps[step].icon}{steps[step].title}</div>
              <div className="mt-1 text-sm text-slate-500">{steps[step].desc}</div>
            </div>
            <div className="text-xs font-black text-slate-500">{step + 1}/3</div>
          </div>

          <div className="grid gap-4 p-5">
            {step === 0 && (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  {[
                    ['click', '클릭수 극대화', '제품 URL 이동과 상세 확인을 늘립니다.', 'website'],
                    ['consultation', '상담 전환', '문의나 상담 요청을 만들기 위한 문구로 갑니다.', 'dm_or_form'],
                    ['lead', '리드 수집', '관심 고객을 모으는 안내형 흐름입니다.', 'lead_form'],
                    ['save_follow', '저장/팔로우', '나중에 다시 보게 만드는 운영 목적입니다.'],
                    ['awareness', '인지도', '제품/서비스를 처음 알리는 목적입니다.']
                  ].map(([value, title, desc, destination]) => (
                    <button key={value} type="button" onClick={() => {
                      update('objectiveType', value);
                      update('optimizationGoal', value);
                      if (destination) update('conversionDestination', destination);
                    }}
                      className={`rounded-lg border p-4 text-left ${form.objectiveType === value ? 'border-slate-900 bg-slate-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                      <div className="font-black text-slate-950">{title}</div>
                      <div className="mt-1 text-xs leading-relaxed text-slate-500">{desc}</div>
                    </button>
                  ))}
                </div>
                <label className={labelClass}>목표 설명
                  <input className={inputClass} required value={form.targetGoal} onChange={(event) => update('targetGoal', event.target.value)} placeholder="예: 쿠자사 소개 페이지 클릭과 상담 유도" />
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={labelClass}>최적화 기준
                    <select className={inputClass} value={form.optimizationGoal} onChange={(event) => update('optimizationGoal', event.target.value)}>
                      <option value="click">클릭</option>
                      <option value="consultation">상담 문의</option>
                      <option value="lead">리드 제출</option>
                      <option value="save_follow">저장/팔로우</option>
                      <option value="awareness">도달/인지</option>
                    </select>
                  </label>
                  <label className={labelClass}>전환 위치
                    <select className={inputClass} value={form.conversionDestination} onChange={(event) => update('conversionDestination', event.target.value)}>
                      <option value="website">웹사이트/랜딩</option>
                      <option value="lead_form">리드 폼</option>
                      <option value="dm_or_form">DM/상담 폼</option>
                      <option value="profile">프로필 방문</option>
                    </select>
                  </label>
                </div>
                {form.objectiveType === 'lead' && (
                  <div className="grid gap-4 rounded-lg border border-blue-100 bg-blue-50 p-4">
                    <label className={labelClass}>리드 제공 가치
                      <input className={inputClass} value={form.leadOffer} onChange={(event) => update('leadOffer', event.target.value)} placeholder="예: 무료 도입 안내, 체크리스트, 상담 링크" />
                    </label>
                    <div className="grid gap-2">
                      <div className="text-xs font-bold text-slate-600">수집 필드</div>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ['name', '이름'],
                          ['phone', '연락처'],
                          ['email', '이메일'],
                          ['business', '사업/계정 유형'],
                          ['budget', '관심 수준']
                        ].map(([value, label]) => (
                          <button key={value} type="button" onClick={() => toggleLeadField(value)}
                            className={`rounded-lg border px-3 py-2 text-xs font-black ${form.leadFields?.includes(value) ? 'border-blue-700 bg-blue-700 text-white' : 'border-blue-200 bg-white text-blue-700'}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={labelClass}>개인정보 고지
                        <textarea className={`${inputClass} min-h-20 resize-y`} value={form.leadPrivacyNote} onChange={(event) => update('leadPrivacyNote', event.target.value)} />
                      </label>
                      <label className={labelClass}>제출 완료 문구
                        <textarea className={`${inputClass} min-h-20 resize-y`} value={form.leadThankYouMessage} onChange={(event) => update('leadThankYouMessage', event.target.value)} />
                      </label>
                    </div>
                  </div>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={labelClass}>캠페인명
                    <input className={inputClass} value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="비워두면 제품명 기준 자동 입력" />
                  </label>
                  <label className={labelClass}>우선순위
                    <select className={inputClass} value={form.priority} onChange={(event) => update('priority', event.target.value)}>
                      <option value="normal">보통</option>
                      <option value="high">높음</option>
                      <option value="low">낮음</option>
                    </select>
                  </label>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <label className={labelClass}>운영 계정
                  <select className={inputClass} value={form.accountId} onChange={(event) => update('accountId', event.target.value)}>
                    <option value="">운영 계정 선택</option>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name} {account.account_handle ? `· ${account.account_handle}` : ''}</option>)}
                  </select>
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={labelClass}>타깃
                    <input className={inputClass} value={form.targetAudience} onChange={(event) => update('targetAudience', event.target.value)} placeholder="예: 쿠팡파트너스 부업 관심자" />
                  </label>
                  <label className={labelClass}>표시 계정
                    <input className={inputClass} value={form.accountHandle} onChange={(event) => update('accountHandle', event.target.value)} placeholder="@jasain" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className={labelClass}>타깃 단계
                    <select className={inputClass} value={form.audienceStage} onChange={(event) => update('audienceStage', event.target.value)}>
                      <option value="cold">처음 보는 사람</option>
                      <option value="warm">관심은 있는 사람</option>
                      <option value="hot">구매/상담 직전</option>
                    </select>
                  </label>
                  <label className={labelClass}>타깃 페르소나
                    <input className={inputClass} value={form.audiencePersona} onChange={(event) => update('audiencePersona', event.target.value)} placeholder="예: 부업 시작자" />
                  </label>
                  <label className={labelClass}>핵심 문제
                    <input className={inputClass} value={form.audiencePain} onChange={(event) => update('audiencePain', event.target.value)} placeholder="예: 매일 상품 찾기 귀찮음" />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className={labelClass}>예약 시작
                    <input className={inputClass} type="time" value={form.activeStart} onChange={(event) => update('activeStart', event.target.value)} />
                  </label>
                  <label className={labelClass}>예약 종료
                    <input className={inputClass} type="time" value={form.activeEnd} onChange={(event) => update('activeEnd', event.target.value)} />
                  </label>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <label className={labelClass}>운영 일수
                    <input className={inputClass} type="number" min="1" max="14" value={form.days} onChange={(event) => update('days', event.target.value)} />
                  </label>
                  <label className={labelClass}>하루 최소
                    <input className={inputClass} type="number" min="1" max="3" value={form.dailyPostMin} onChange={(event) => update('dailyPostMin', event.target.value)} />
                  </label>
                  <label className={labelClass}>하루 최대
                    <input className={inputClass} type="number" min="1" max="3" value={form.dailyPostMax} onChange={(event) => update('dailyPostMax', event.target.value)} />
                  </label>
                </div>
                <div className="grid gap-2">
                  <div className="text-xs font-bold text-slate-600">채널</div>
                  <div className="flex flex-wrap gap-2">
                    {['threads', 'instagram'].map((platform) => (
                      <button key={platform} type="button" onClick={() => togglePlatform(platform)}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-bold ${form.platforms.includes(platform) ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                        {platformLabel(platform)}
                      </button>
                    ))}
                  </div>
                </div>
                <label className={labelClass}>노출 위치
                  <select className={inputClass} value={form.placementMode} onChange={(event) => update('placementMode', event.target.value)}>
                    <option value="threads_instagram_feed">Threads + Instagram 피드</option>
                    <option value="threads_only">Threads 중심</option>
                    <option value="instagram_feed_only">Instagram 피드 미리보기 중심</option>
                  </select>
                </label>
              </>
            )}

            {step === 2 && (
              <>
                <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-3">
                  <button type="button" onClick={() => setCreativeTab('settings')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black ${creativeTab === 'settings' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <SquareStack size={15} /> 설정
                  </button>
                  <button type="button" onClick={() => setCreativeTab('preview')} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black ${creativeTab === 'preview' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Eye size={15} /> 미리보기
                  </button>
                </div>
                {creativeTab === 'settings' ? (
                  <>
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={labelClass}>제품명
                        <input className={inputClass} required value={form.productName} onChange={(event) => update('productName', event.target.value)} placeholder="예: 쿠자사" />
                      </label>
                      <label className={labelClass}>가격
                        <input className={inputClass} inputMode="numeric" value={form.productPrice} onChange={(event) => update('productPrice', event.target.value)} placeholder="590000" />
                      </label>
                    </div>
                    <label className={labelClass}>제품 URL
                      <input className={inputClass} value={form.productUrl} onChange={(event) => update('productUrl', event.target.value)} placeholder="https://..." />
                    </label>
                    <CreateMediaPlanner form={form} update={update} uploadProductImage={uploadProductImage} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className={labelClass}>소재 형식
                        <select className={inputClass} value={form.creativeFormat} onChange={(event) => update('creativeFormat', event.target.value)}>
                          <option value="short_copy_square_card">짧은 문구 + 정사각 카드</option>
                          <option value="lead_hook_card">리드 후킹 카드</option>
                          <option value="proof_first_card">근거/효용 먼저 카드</option>
                        </select>
                      </label>
                      <label className={labelClass}>후킹 방식
                        <select className={inputClass} value={form.hookStyle} onChange={(event) => update('hookStyle', event.target.value)}>
                          <option value="situation_first">상황 먼저</option>
                          <option value="problem_first">문제 먼저</option>
                          <option value="comparison_first">비교 기준 먼저</option>
                        </select>
                      </label>
                      <label className={labelClass}>톤
                        <select className={inputClass} value={form.toneStyle} onChange={(event) => update('toneStyle', event.target.value)}>
                          <option value="clear_operator">명확한 운영자 톤</option>
                          <option value="friendly_review">친근한 후기 톤</option>
                          <option value="expert_brief">전문가 브리프 톤</option>
                        </select>
                      </label>
                      <label className={labelClass}>근거/차별점
                        <input className={inputClass} value={form.proofPoint} onChange={(event) => update('proofPoint', event.target.value)} placeholder="예: 상품 찾기, 글 생성, 예약까지 자동화" />
                      </label>
                    </div>
                    <label className={labelClass}>핵심 메시지 방향
                      <input className={inputClass} value={form.primaryMessage} onChange={(event) => update('primaryMessage', event.target.value)} placeholder="예: 자동화로 수익화 운영을 돕는다" />
                    </label>
                    <label className={labelClass}>주의/컴플라이언스 메모
                      <input className={inputClass} value={form.complianceNote} onChange={(event) => update('complianceNote', event.target.value)} placeholder="예: 수익 보장 표현 금지" />
                    </label>
                    <label className={labelClass}>다음 액션 메모
                      <textarea className={`${inputClass} min-h-20 resize-y`} value={form.nextActionNote} onChange={(event) => update('nextActionNote', event.target.value)} placeholder="예: 클릭 낮으면 자는 동안 예약 콘텐츠 문구로 교체" />
                    </label>
                  </>
                ) : (
                  <CreatePreview form={form} />
                )}
              </>
            )}

            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={back} disabled={step === 0} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-40">이전</button>
              {step < 2 ? (
                <button type="button" onClick={next} disabled={!canGoNext} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-40">다음</button>
              ) : (
                <button disabled={saving || !canGoNext} className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:opacity-60">
                  <Plus size={17} /> {saving ? '생성 중' : '캠페인 생성'}
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="h-fit rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-black text-slate-700">설정 요약</div>
          <div className="mt-3 grid gap-2 text-xs text-slate-600">
            <CheckRow ok={Boolean(form.objectiveType)} label={`목표: ${objectiveLabel(form.objectiveType)}`} />
            <CheckRow ok={Boolean(form.targetGoal)} label="목표 설명 입력" />
            <CheckRow ok={Boolean(selectedAccount)} label={selectedAccount ? `계정: ${selectedAccount.name}` : '운영 계정 선택'} />
            <CheckRow ok={Boolean(form.conversionDestination)} label={`전환: ${conversionDestinationLabel(form.conversionDestination)}`} />
            {form.objectiveType === 'lead' && <CheckRow ok={form.leadFields?.length > 0} label={`리드 필드 ${form.leadFields?.length || 0}개`} />}
            <CheckRow ok={form.platforms.length > 0} label={`채널: ${form.platforms.map(platformLabel).join(', ')}`} />
            <CheckRow ok={Boolean(form.productName)} label={form.productName ? `제품: ${form.productName}` : '제품명 입력'} />
            <CheckRow ok={form.platforms.includes('instagram') ? Boolean(form.productImageUrl) : true} label="Instagram 이미지" />
          </div>
          <div className="mt-4 rounded-lg bg-white p-3 text-xs leading-relaxed text-slate-500">
            생성 후 실행 버튼을 누르면 소재 생성, 품질 검수, 예약 큐 생성이 이어집니다.
          </div>
        </div>
      </form>
    </div>
  );
}

function CreatePreview({ form }) {
  const copy = previewCopyForForm(form);
  const variants = previewCopyVariantsForForm(form);
  const product = form.productName || '제품명';
  const fields = form.objectiveType === 'lead' ? (form.leadFields || []) : [];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-900"><Send size={16} /> Threads 미리보기</div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-black text-slate-500">{form.accountHandle || '@jasain'}</div>
          <div className="mt-3 whitespace-pre-line text-base font-bold leading-relaxed text-slate-950">{copy}</div>
          {form.productUrl && <div className="mt-3 truncate rounded-md bg-white px-3 py-2 text-xs font-bold text-blue-700">{form.productUrl}</div>}
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-slate-500">
            <span className="rounded-md bg-white px-2 py-1">{objectiveLabel(form.objectiveType)}</span>
            <span className="rounded-md bg-white px-2 py-1">{conversionDestinationLabel(form.conversionDestination)}</span>
          </div>
        </div>
        {variants.length > 1 && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="text-[11px] font-black text-slate-500">실제 생성 시 여러 문구로 변형됩니다.</div>
            <div className="mt-2 grid gap-1 text-xs font-bold leading-relaxed text-slate-600">
              {variants.slice(0, 3).map((variant) => <div key={variant}>{variant}</div>)}
            </div>
          </div>
        )}
      </div>
      <div className="rounded-lg border border-slate-200 p-4">
        <div className="mb-3 inline-flex items-center gap-2 text-sm font-black text-slate-900"><Image size={16} /> Instagram 카드 미리보기</div>
        <div className="aspect-square rounded-lg border border-slate-200 bg-white p-5">
          <div className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white">{objectiveLabel(form.objectiveType)}</div>
          <div className="mt-5 grid grid-cols-[110px_1fr] gap-4">
            {form.productImageUrl ? (
              <img src={form.productImageUrl} alt="preview" className="aspect-square w-full rounded-lg border border-slate-200 object-cover" />
            ) : (
              <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-slate-300 text-xs font-black text-slate-400">IMAGE</div>
            )}
            <div>
              <div className="text-lg font-black text-slate-950">{product}</div>
              <div className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{form.proofPoint || form.audiencePain || '상품 찾기, 글 생성, 예약 운영을 자동화합니다.'}</div>
            </div>
          </div>
          <div className="mt-6 text-xl font-black leading-snug text-slate-950">{copy}</div>
          <div className="mt-5 rounded-lg bg-slate-900 px-4 py-3 text-center text-sm font-black text-white">{objectiveLabel(form.objectiveType)}</div>
        </div>
      </div>
      {form.objectiveType === 'lead' && (
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 lg:col-span-2">
          <div className="inline-flex items-center gap-2 text-sm font-black text-blue-950"><Users size={16} /> 리드 수집 폼 미리보기</div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {(fields.length ? fields : ['name', 'phone']).map((field) => (
              <div key={field} className="rounded-lg bg-white px-3 py-2 text-xs font-black text-blue-800">{leadFieldLabel(field)}</div>
            ))}
          </div>
          <div className="mt-3 text-xs leading-relaxed text-blue-800">실제 Meta 리드폼 연동은 후속 작업이며, MVP에서는 수동 수집/상담 링크 기준으로 운영합니다.</div>
        </div>
      )}
    </div>
  );
}

function leadFieldLabel(value) {
  return {
    name: '이름',
    phone: '연락처',
    email: '이메일',
    business: '사업/계정 유형',
    budget: '관심 수준'
  }[value] || value;
}

function WorkspaceTab({ active, onClick, icon, label, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40 ${active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
      {icon}{label}
    </button>
  );
}

function LevelTab({ active, onClick, label, count }) {
  return (
    <button type="button" onClick={onClick}
      className={`inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-black ${active ? 'border-slate-900 text-slate-950' : 'border-transparent text-slate-500 hover:text-slate-900'}`}>
      {label}<span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{count}</span>
    </button>
  );
}

function ManagementTable({ campaigns, accountById, loading, level, onLevelChange, selectedId, onSelect, onDeleteCampaign, onDeleteSet, onDeleteAsset }) {
  const adSets = campaigns.flatMap((campaign) => (campaign.platforms || []).map((platform) => ({ campaign, platform })));
  const ads = campaigns.flatMap((campaign) => (campaign.assets || []).map((asset) => ({ campaign, asset })));
  return (
    <div>
      <div className="flex border-b border-slate-100 bg-white">
        <LevelTab active={level === 'campaigns'} onClick={() => onLevelChange('campaigns')} label="캠페인" count={campaigns.length} />
        <LevelTab active={level === 'sets'} onClick={() => onLevelChange('sets')} label="운영 세트" count={adSets.length} />
        <LevelTab active={level === 'ads'} onClick={() => onLevelChange('ads')} label="소재" count={ads.length} />
      </div>
      {level === 'campaigns' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-4 py-3">캠페인</th>
                <th className="px-4 py-3">운영 계정</th>
                <th className="px-4 py-3">목표</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">품질</th>
                <th className="px-4 py-3 text-right">소재</th>
                <th className="px-4 py-3 text-right">예약</th>
                <th className="px-4 py-3 text-right">완료</th>
                <th className="px-4 py-3 text-right">클릭</th>
                <th className="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan="10" className="px-4 py-8 text-center text-slate-500">불러오는 중</td></tr>}
              {!loading && campaigns.length === 0 && <tr><td colSpan="10" className="px-4 py-8 text-center text-slate-500">조건에 맞는 캠페인이 없습니다.</td></tr>}
              {campaigns.map((campaign) => {
                const quality = campaignQuality(campaign);
                return (
                <tr key={campaign.id} onClick={() => onSelect(campaign.id, 'detail')}
                  className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${selectedId === campaign.id ? 'bg-slate-50' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-black text-slate-950">{campaign.name}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(campaign.platforms || []).map((platform) => <span key={platform} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{platformLabel(platform)}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{accountById.get(campaign.account_id)?.name || '미리보기'}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs font-black text-slate-700">{objectiveLabel(campaign.objective_type || campaign.generation_input?.objectiveType || 'click')}</div>
                    <div className="mt-1 text-xs text-slate-500">우선순위 {priorityLabel(campaign.priority || campaign.generation_input?.priority || 'normal')}</div>
                  </td>
                  <td className="px-4 py-3"><StatusBadge status={campaign.status} /></td>
                  <td className="px-4 py-3">
                    <span className={`rounded-md px-2 py-1 text-xs font-black ${qualityTone(quality.average)}`}>{quality.average ?? '-'}</span>
                    {quality.needsReview > 0 && <div className="mt-1 text-[11px] font-bold text-amber-700">검수 {quality.needsReview}</div>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{campaign.stats?.assets || 0}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{campaign.stats?.scheduled || 0}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{campaign.stats?.posted || 0}</td>
                  <td className="px-4 py-3 text-right font-bold text-slate-700">{campaign.stats?.clicks || 0}</td>
                  <td className="px-4 py-3">
                    <RowActions
                      onEdit={(event) => { event.stopPropagation(); onSelect(campaign.id, 'detail'); }}
                      onDelete={(event) => { event.stopPropagation(); onDeleteCampaign(campaign.id); }}
                    />
                  </td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      )}
      {level === 'sets' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-4 py-3">운영 세트</th>
                <th className="px-4 py-3">캠페인</th>
                <th className="px-4 py-3">채널</th>
                <th className="px-4 py-3">발행량</th>
                <th className="px-4 py-3">시간대</th>
                <th className="px-4 py-3 text-right">예약</th>
                <th className="px-4 py-3 text-right">게시</th>
                <th className="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {adSets.length === 0 && <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500">운영 세트가 없습니다.</td></tr>}
              {adSets.map(({ campaign, platform }) => {
                const window = campaign.operation_set?.activeTimeWindow || campaign.generation_input?.operationSet?.activeTimeWindow || {};
                const queues = (campaign.queues || []).filter((queue) => queue.platform === platform);
                return (
                  <tr key={`${campaign.id}:${platform}`} onClick={() => onSelect(campaign.id, 'detail', platform)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-black text-slate-950">{platformLabel(platform)} 세트</td>
                    <td className="px-4 py-3 text-slate-600">{campaign.name}</td>
                    <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{platformLabel(platform)}</span></td>
                    <td className="px-4 py-3 text-slate-600">하루 {campaign.daily_post_min}-{campaign.daily_post_max}개 · {campaign.days}일</td>
                    <td className="px-4 py-3 text-slate-600">{window.start || '09:00'}-{window.end || '21:00'}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{queues.filter((queue) => ['scheduled', 'manual_required', 'retry'].includes(queue.status)).length}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-700">{queues.filter((queue) => queue.status === 'posted').length}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        onEdit={(event) => { event.stopPropagation(); onSelect(campaign.id, 'detail', platform); }}
                        onDelete={(event) => { event.stopPropagation(); onDeleteSet(campaign.id, platform); }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {level === 'ads' && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-4 py-3">소재</th>
                <th className="px-4 py-3">캠페인</th>
                <th className="px-4 py-3">채널</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">품질</th>
                <th className="px-4 py-3">예약</th>
                <th className="px-4 py-3">업로드</th>
                <th className="px-4 py-3 text-right">작업</th>
              </tr>
            </thead>
            <tbody>
              {ads.length === 0 && <tr><td colSpan="8" className="px-4 py-8 text-center text-slate-500">소재가 없습니다.</td></tr>}
              {ads.map(({ campaign, asset }) => {
                const link = (campaign.queueLinks || []).find((item) => item.asset_id === asset.id);
                const queue = (campaign.queues || []).find((item) => item.id === link?.queue_id);
                return (
                  <tr key={asset.id} onClick={() => onSelect(campaign.id, 'assets', asset.platform)} className="cursor-pointer border-b border-slate-100 hover:bg-slate-50">
                    <td className="max-w-xl px-4 py-3">
                      <div className="font-bold text-slate-900">{asset.metadata?.caption || asset.body || asset.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{asset.asset_type}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{campaign.name}</td>
                    <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{platformLabel(asset.platform)}</span></td>
                    <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{assetStatusLabel(asset.review_status || asset.status)}</span></td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-black ${qualityTone(qualityScore(asset))}`}>{qualityLabel(asset)}</span></td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(queue?.scheduled_at)}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-500">{asset.platform === 'instagram' ? '수동 대기' : 'Threads 큐'}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        onEdit={(event) => { event.stopPropagation(); onSelect(campaign.id, 'assets', asset.platform); }}
                        onDelete={(event) => { event.stopPropagation(); onDeleteAsset(campaign.id, asset.id); }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RowActions({ onEdit, onDelete }) {
  return (
    <div className="flex justify-end gap-1">
      <button type="button" onClick={onEdit} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" title="수정">
        <Edit3 size={15} />
      </button>
      <button type="button" onClick={onDelete} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50" title="삭제">
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function ChannelScopeTabs({ value, onChange, counts = {} }) {
  return (
    <div className="flex flex-wrap gap-1">
      {[
        ['all', '전체'],
        ['threads', 'Threads'],
        ['instagram', 'Instagram']
      ].map(([key, label]) => (
        <button key={key} type="button" onClick={() => onChange(key)}
          className={`rounded-lg px-3 py-2 text-xs font-black ${value === key ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
          {label} <span className="opacity-70">{counts[key] ?? 0}</span>
        </button>
      ))}
    </div>
  );
}

function AssetsReviewWorkspace({ campaign, selectedPlatform = 'all', onSelectPlatform, onUpdateAsset, onRewriteAsset, onBulkApprove, onDeleteAsset, updatingId }) {
  const [reviewFilter, setReviewFilter] = useState('all');
  if (!campaign) return <EmptyWorkspace label="소재를 검수할 캠페인을 선택하세요." />;
  const allAssets = campaign.assets || [];
  const inScopeAssets = allAssets.filter((asset) => selectedPlatform === 'all' || asset.platform === selectedPlatform);
  const filteredAssets = inScopeAssets.filter((asset) => {
    if (reviewFilter === 'needs_review') return qualityScore(asset) != null && qualityScore(asset) < 76;
    if (reviewFilter === 'approved') return ['approved', 'posted'].includes(asset.review_status || asset.status);
    return true;
  });
  const threadsAssets = selectedPlatform === 'instagram' ? [] : filteredAssets.filter((asset) => asset.platform === 'threads');
  const instagramAssets = selectedPlatform === 'threads' ? [] : filteredAssets.filter((asset) => asset.platform === 'instagram');
  const counts = {
    all: allAssets.length,
    threads: allAssets.filter((asset) => asset.platform === 'threads').length,
    instagram: allAssets.filter((asset) => asset.platform === 'instagram').length
  };
  const quality = campaignQuality({ assets: inScopeAssets });
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-black text-slate-950">소재 검수</div>
          <div className="mt-1 text-sm text-slate-500">{campaign.name} · 선택한 채널의 소재를 수정/승인합니다.</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded-md px-2 py-1 text-xs font-black ${qualityTone(quality.average)}`}>평균 품질 {quality.average ?? '-'}</span>
            <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600">검수 필요 {quality.needsReview}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <StatusBadge status={campaign.status} />
          <ChannelScopeTabs value={selectedPlatform} onChange={onSelectPlatform} counts={counts} />
          <div className="flex flex-wrap justify-end gap-1">
            {[
              ['all', '전체'],
              ['needs_review', '검수 필요'],
              ['approved', '승인됨']
            ].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setReviewFilter(key)}
                className={`rounded-md px-2.5 py-1.5 text-xs font-black ${reviewFilter === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}>
                {label}
              </button>
            ))}
            <button type="button" onClick={() => onBulkApprove(campaign.id, filteredAssets)} disabled={updatingId === `${campaign.id}:bulk` || filteredAssets.length === 0}
              className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-black text-white disabled:opacity-50">
              <CheckCircle2 size={14} /> {updatingId === `${campaign.id}:bulk` ? '승인 중' : '보이는 소재 승인'}
            </button>
          </div>
        </div>
      </div>
      <div className={`grid gap-4 ${selectedPlatform === 'all' ? 'xl:grid-cols-2' : ''}`}>
        {selectedPlatform !== 'instagram' && <AssetColumn
          title="Threads 문구"
          icon={<Send size={18} />}
          campaignId={campaign.id}
          assets={threadsAssets}
          queues={campaign.queues}
            queueLinks={campaign.queueLinks}
            onUpdateAsset={onUpdateAsset}
            onRewriteAsset={onRewriteAsset}
            onDeleteAsset={onDeleteAsset}
            updatingId={updatingId}
          />}
        {selectedPlatform !== 'threads' && <InstagramColumn
          campaignId={campaign.id}
          assets={instagramAssets}
          queues={campaign.queues}
            queueLinks={campaign.queueLinks}
            onUpdateAsset={onUpdateAsset}
            onRewriteAsset={onRewriteAsset}
            onDeleteAsset={onDeleteAsset}
            updatingId={updatingId}
          />}
      </div>
    </div>
  );
}

function ScheduleWorkspace({ campaign, selectedPlatform = 'all', onSelectPlatform }) {
  if (!campaign) return <EmptyWorkspace label="예약을 확인할 캠페인을 선택하세요." />;
  const allQueues = campaign.queues || [];
  const rows = allQueues.filter((queue) => selectedPlatform === 'all' || queue.platform === selectedPlatform).map((queue) => {
    const link = (campaign.queueLinks || []).find((item) => item.queue_id === queue.id);
    const asset = (campaign.assets || []).find((item) => item.id === link?.asset_id);
    return { queue, asset };
  });
  const counts = {
    all: allQueues.length,
    threads: allQueues.filter((queue) => queue.platform === 'threads').length,
    instagram: allQueues.filter((queue) => queue.platform === 'instagram').length
  };
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div>
          <div className="text-lg font-black text-slate-950">예약/성과</div>
          <div className="mt-1 text-sm text-slate-500">{campaign.name} · 선택한 채널 큐만 확인합니다.</div>
        </div>
        <ChannelScopeTabs value={selectedPlatform} onChange={onSelectPlatform} counts={counts} />
      </div>
      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:grid-cols-4">
        <Metric title="예약/대기" value={campaign.stats?.scheduled || 0} />
        <Metric title="게시완료" value={campaign.stats?.posted || 0} />
        <Metric title="중지" value={campaign.stats?.stopped || 0} />
        <Metric title="클릭" value={campaign.stats?.clicks || 0} />
      </div>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">
          <CalendarDays size={18} /> 예약 큐
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black text-slate-500">
              <tr>
                <th className="px-4 py-3">채널</th>
                <th className="px-4 py-3">상태</th>
                <th className="px-4 py-3">소재</th>
                <th className="px-4 py-3">예약 시간</th>
                <th className="px-4 py-3">업로드 정책</th>
                <th className="px-4 py-3">진단</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-500">생성된 예약 큐가 없습니다.</td></tr>}
              {rows.map(({ queue, asset }) => (
                <tr key={queue.id} className="border-b border-slate-100">
                  <td className="px-4 py-3 font-bold text-slate-700">{platformLabel(queue.platform)}</td>
                  <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black text-slate-600">{queueStatusLabel(queue.status)}</span></td>
                  <td className="max-w-xl px-4 py-3 text-slate-700">{asset?.metadata?.caption || asset?.body || asset?.title || '-'}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(queue.scheduled_at)}</td>
                  <td className="px-4 py-3 text-xs font-bold text-slate-500">{queue.platform === 'instagram' ? '자동 게시 안 됨 · 수동 업로드 전용' : 'Threads 자동 게시 흐름'}</td>
                  <td className="max-w-sm px-4 py-3 text-xs leading-relaxed text-slate-500">
                    {queue.error_category && <div className="font-black text-amber-700">{queue.error_category}</div>}
                    {queue.error_message && <div className="mt-1">{queue.error_message}</div>}
                    {!queue.error_category && !queue.error_message && <span className="text-slate-400">-</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AnalyticsWorkspace({ campaign, analytics, loading, updatingId, onRefresh, onExpandAsset }) {
  if (!campaign) return <EmptyWorkspace label="성과를 볼 캠페인을 선택하세요." />;
  const data = analytics || {};
  const totals = data.totals || {};
  const bestAssets = data.bestAssets || [];
  const byHour = data.byHour || [];
  const byChannel = data.byChannel || [];
  const assets = data.assets || [];
  const maxHourClicks = Math.max(1, ...byHour.map((row) => row.clicks || 0));
  const maxAssetClicks = Math.max(1, ...assets.map((row) => row.clicks || 0));
  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 text-lg font-black text-slate-950"><BarChart3 size={20} /> 애널리틱스</div>
          <div className="mt-1 text-sm text-slate-500">{campaign.name} · 클릭, 게시, 수동 대기, 시간대 반응을 봅니다.</div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <RefreshCw size={16} /> {loading ? '갱신 중' : '성과 갱신'}
        </button>
      </div>

      <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:grid-cols-5">
        <Metric title="추적 클릭" value={totals.clicks || 0} icon={<MousePointerClick size={18} />} />
        <Metric title="게시완료" value={totals.posted || 0} icon={<CheckCircle2 size={18} />} />
        <Metric title="예약/대기" value={totals.scheduled || 0} icon={<CalendarDays size={18} />} />
        <Metric title="수동 대기" value={totals.manualRequired || 0} icon={<Clock3 size={18} />} />
        <Metric title="소재" value={totals.assets || 0} icon={<SquareStack size={18} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_360px]">
        <div className="grid gap-4">
          <div className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">
              <TrendingUp size={18} /> 소재별 성과
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-black text-slate-500">
                  <tr>
                    <th className="px-4 py-3">소재</th>
                    <th className="px-4 py-3">채널</th>
                    <th className="px-4 py-3">상태</th>
                    <th className="px-4 py-3">품질</th>
                    <th className="px-4 py-3 text-right">클릭</th>
                    <th className="px-4 py-3 text-right">게시</th>
                    <th className="px-4 py-3 text-right">예약</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.length === 0 && <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-500">성과 데이터가 없습니다.</td></tr>}
                  {assets.map((row) => (
                    <tr key={row.assetId} className="border-b border-slate-100">
                      <td className="max-w-xl px-4 py-3">
                        <div className="font-bold text-slate-900">{row.title || '-'}</div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(4, Math.round(((row.clicks || 0) / maxAssetClicks) * 100))}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3"><span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">{platformLabel(row.platform)}</span></td>
                      <td className="px-4 py-3 text-xs font-black text-slate-600">{assetStatusLabel(row.reviewStatus)}</td>
                      <td className="px-4 py-3"><span className={`rounded-md px-2 py-1 text-xs font-black ${qualityTone(row.qualityScore)}`}>{row.qualityScore ?? '-'}</span></td>
                      <td className="px-4 py-3 text-right font-black text-slate-900">{row.clicks || 0}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-600">{row.posted || 0}</td>
                      <td className="px-4 py-3 text-right font-bold text-slate-600">{row.scheduled || 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <AnalyticsPanel title="시간대별 클릭" icon={<Clock3 size={18} />}>
              <div className="grid gap-2">
                {byHour.length === 0 && <div className="text-sm text-slate-500">아직 클릭 시간 데이터가 없습니다.</div>}
                {byHour.map((row) => (
                  <div key={row.key} className="grid grid-cols-[48px_1fr_40px] items-center gap-2 text-xs">
                    <div className="font-black text-slate-600">{row.key}시</div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.round(((row.clicks || 0) / maxHourClicks) * 100)}%` }} />
                    </div>
                    <div className="text-right font-black text-slate-900">{row.clicks || 0}</div>
                  </div>
                ))}
              </div>
            </AnalyticsPanel>
            <AnalyticsPanel title="채널별 상태" icon={<Filter size={18} />}>
              <div className="grid gap-2">
                {byChannel.map((row) => (
                  <div key={row.key} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-black text-slate-900">{platformLabel(row.key)}</div>
                      <div className="text-lg font-black text-slate-950">{row.clicks || 0}</div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1 text-[11px] font-bold text-slate-500">
                      <span className="rounded-md bg-slate-100 px-2 py-1">예약 {row.scheduled || 0}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">게시 {row.posted || 0}</span>
                      <span className="rounded-md bg-slate-100 px-2 py-1">수동 {row.manualRequired || 0}</span>
                    </div>
                  </div>
                ))}
              </div>
            </AnalyticsPanel>
          </div>
        </div>

        <div className="grid h-fit gap-4">
          <AnalyticsPanel title="확장 후보" icon={<TrendingUp size={18} />}>
            <div className="grid gap-2">
              {bestAssets.length === 0 && <div className="text-sm leading-relaxed text-slate-500">클릭이 쌓이면 여기서 재사용할 소재가 자동으로 올라옵니다.</div>}
              {bestAssets.map((row) => (
                <div key={row.assetId} className="rounded-lg border border-slate-200 p-3">
                  <div className="text-xs font-black text-slate-500">{platformLabel(row.platform)} · 클릭 {row.clicks}</div>
                  <div className="mt-1 text-sm font-bold leading-relaxed text-slate-900">{row.title}</div>
                  <button type="button" onClick={() => onExpandAsset(row.campaignId, row.assetId)} disabled={updatingId === `expand:${row.assetId}`}
                    className="mt-3 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-xs font-black text-white disabled:opacity-50">
                    <Plus size={14} /> {updatingId === `expand:${row.assetId}` ? '생성 중' : '확장 초안 만들기'}
                  </button>
                </div>
              ))}
            </div>
          </AnalyticsPanel>
          <AnalyticsPanel title="다음 액션" icon={<ClipboardPen size={18} />}>
            <div className="grid gap-2">
              {(data.nextActions || []).map((item) => (
                <div key={item} className="rounded-lg bg-slate-50 p-3 text-sm leading-relaxed text-slate-700">{item}</div>
              ))}
            </div>
          </AnalyticsPanel>
        </div>
      </div>
    </div>
  );
}

function AnalyticsPanel({ title, icon, children }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">{icon}{title}</div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function EmptyWorkspace({ label }) {
  return <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">{label}</div>;
}

function Metric({ title, value, icon }) {
  return (
    <div className="bg-white px-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-bold text-slate-500">{title}</div>
        <div className="text-slate-400">{icon}</div>
      </div>
      <div className="mt-1 text-2xl font-black text-slate-950">{value}</div>
    </div>
  );
}

function CheckRow({ ok, label }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className={`rounded-md px-2 py-1 text-[11px] font-black ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
        {ok ? '준비됨' : '확인'}
      </span>
    </div>
  );
}

function CreateMediaPlanner({ form, update, uploadProductImage }) {
  const [previewTab, setPreviewTab] = useState('instagram');
  const copy = previewCopyForForm(form);
  const product = form.productName || '제품명';
  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">이미지 소스</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">업로드한 이미지는 Instagram 카드 생성 때 제품 영역에 들어갑니다.</div>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          {form.productImageUrl ? (
            <img src={form.productImageUrl} alt="제품 이미지 소스" className="aspect-video w-full object-cover" />
          ) : (
            <div className="grid aspect-video place-items-center bg-slate-100 text-xs font-black text-slate-400">이미지 없음</div>
          )}
        </div>
        <input className={inputClass} value={form.productImageUrl} onChange={(event) => update('productImageUrl', event.target.value)} placeholder="https://... 또는 업로드된 이미지 데이터" />
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
            <Upload size={14} /> 이미지 업로드
            <input type="file" accept="image/*" className="hidden" onChange={(event) => uploadProductImage(event.target.files?.[0]).catch(console.error)} />
          </label>
          <button type="button" onClick={() => update('productImageUrl', '')} disabled={!form.productImageUrl}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            제거
          </button>
        </div>
      </div>
      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-black text-slate-900">실제 미리보기</div>
          <div className="flex rounded-lg bg-white p-1 text-xs font-black">
            {['instagram', 'threads'].map((tab) => (
              <button key={tab} type="button" onClick={() => setPreviewTab(tab)}
                className={`rounded-md px-3 py-1.5 ${previewTab === tab ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>
                {platformLabel(tab)}
              </button>
            ))}
          </div>
        </div>
        {previewTab === 'instagram' ? (
          <div className="aspect-square overflow-hidden rounded-lg border border-slate-200 bg-white p-5">
            <div className="rounded-lg bg-slate-900 px-4 py-3 text-sm font-black text-white">{objectiveLabel(form.objectiveType)}</div>
            <div className="mt-5 grid grid-cols-[minmax(84px,120px)_1fr] gap-4">
              {form.productImageUrl ? (
                <img src={form.productImageUrl} alt="preview" className="aspect-square w-full rounded-lg border border-slate-200 object-cover" />
              ) : (
                <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-slate-300 text-xs font-black text-slate-400">IMAGE</div>
              )}
              <div className="min-w-0">
                <div className="break-words text-lg font-black leading-snug text-slate-950">{product}</div>
                <div className="mt-2 max-h-20 overflow-hidden text-xs font-bold leading-relaxed text-slate-500">{form.proofPoint || form.audiencePain || '상품 찾기, 글 생성, 예약 운영을 자동화합니다.'}</div>
              </div>
            </div>
            <div className="mt-6 max-h-24 overflow-hidden text-xl font-black leading-snug text-slate-950">{copy}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="text-xs font-black text-slate-500">{form.accountHandle || '@jasain'}</div>
            <div className="mt-3 whitespace-pre-line text-base font-bold leading-relaxed text-slate-950">{copy}</div>
            {(form.productUrl || form.objectiveType === 'lead') && (
              <div className="mt-4 truncate rounded-md bg-slate-50 px-3 py-2 text-xs font-bold text-blue-700">
                {form.objectiveType === 'lead' ? 'JASAIN 리드폼 URL 자동 연결' : form.productUrl}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const tone = {
    running: 'bg-emerald-50 text-emerald-700',
    draft: 'bg-slate-100 text-slate-600',
    stopped: 'bg-rose-50 text-rose-700',
    completed: 'bg-blue-50 text-blue-700'
  }[status] || 'bg-slate-100 text-slate-600';
  return <span className={`rounded-md px-2 py-1 text-xs font-black ${tone}`}>{statusLabel(status)}</span>;
}

function CampaignDetail({ campaign, selectedPlatform = 'all', onRun, onRegenerateAssets, onStop, onDeleteCampaign, onDeleteSet, onUpdateAsset, onRewriteAsset, onUpdateCampaignNote, onUpdateCampaignImage, updatingId }) {
  if (!campaign) {
    return <div className="rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-500">캠페인을 선택하세요.</div>;
  }
  const threadsAssets = selectedPlatform === 'instagram' ? [] : (campaign.assets?.filter((asset) => asset.platform === 'threads') || []);
  const instagramAssets = selectedPlatform === 'threads' ? [] : (campaign.assets?.filter((asset) => asset.platform === 'instagram') || []);
  const nextActionNote = campaign.next_action_note || campaign.summary?.nextActionNote || campaign.generation_input?.nextActionNote || '';
  const hasAssets = (campaign.assets || []).length > 0;
  const quality = campaignQuality(campaign);
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-black text-slate-950">{campaign.name}</div>
          <div className="mt-1 text-sm text-slate-500">
            {campaign.product_name} · {objectiveLabel(campaign.objective_type || campaign.generation_input?.objectiveType || 'click')} · {statusLabel(campaign.status)} · {formatDate(campaign.created_at)}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onRun(campaign.id)}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white">
            <PlayCircle size={17} /> {(campaign.assets || []).length > 0 ? '새 소재 재생성' : '소재 생성'}
          </button>
          <button type="button" onClick={() => onStop(campaign.id)} disabled={campaign.status === 'stopped'}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-700 disabled:opacity-50">
            <PauseCircle size={17} /> 중지
          </button>
          {selectedPlatform !== 'all' && (
            <button type="button" onClick={() => onDeleteSet(campaign.id, selectedPlatform)}
              className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-black text-rose-700">
              <Trash2 size={17} /> 세트 삭제
            </button>
          )}
          <button type="button" onClick={() => onDeleteCampaign(campaign.id)}
            className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-sm font-black text-rose-700">
            <Trash2 size={17} /> 삭제
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5">
        {!hasAssets && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-black text-amber-900">소재 생성 전 캠페인입니다</div>
                <p className="mt-1 text-sm leading-relaxed text-amber-800">
                  캠페인 설정만 저장된 상태입니다. 실행을 누르면 Threads 글, Instagram 카드, 예약 큐가 생성됩니다.
                </p>
              </div>
              <button type="button" onClick={() => onRun(campaign.id)}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-700 px-3 py-2 text-sm font-black text-white">
                <PlayCircle size={17} /> 소재 생성 및 예약
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-100 md:grid-cols-5">
          <Metric title="소재" value={campaign.stats?.assets || 0} />
          <Metric title="예약/대기" value={campaign.stats?.scheduled || 0} />
          <Metric title="게시완료" value={campaign.stats?.posted || 0} />
          <Metric title="클릭" value={campaign.stats?.clicks || 0} />
          <Metric title="평균 품질" value={quality.average ?? '-'} />
        </div>

        <div className="grid gap-3 rounded-lg border border-slate-200 p-4 lg:grid-cols-[1fr_280px]">
          <div>
            <div className="text-sm font-black text-slate-900">운영 세트</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-slate-600">
              {(campaign.platforms || []).map((platform) => <span key={platform} className="rounded-md bg-slate-100 px-2 py-1">{platformLabel(platform)}</span>)}
              <span className="rounded-md bg-slate-100 px-2 py-1">하루 {campaign.daily_post_min}-{campaign.daily_post_max}개</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">{campaign.days}일 운영</span>
              <span className="rounded-md bg-slate-100 px-2 py-1">우선순위 {priorityLabel(campaign.priority || campaign.generation_input?.priority || 'normal')}</span>
            </div>
          </div>
          <NoteEditor value={nextActionNote} onSave={(value) => onUpdateCampaignNote(campaign.id, value)} saving={updatingId === campaign.id} />
        </div>

        <CampaignImageEditor
          campaign={campaign}
          onSave={(value) => onUpdateCampaignImage(campaign.id, value)}
          onRegenerate={() => onRegenerateAssets(campaign.id)}
          saving={updatingId === `${campaign.id}:image`}
          regenerating={updatingId === `${campaign.id}:regenerate`}
        />

        <CampaignDiagnosticsPanel campaign={campaign} />

        {campaign.leadForm && <LeadSubmissionsPanel campaign={campaign} />}

        <div className={`grid gap-4 ${selectedPlatform === 'all' ? 'xl:grid-cols-2' : ''}`}>
          {selectedPlatform !== 'instagram' && <AssetColumn
            title="Threads 글/CTA"
            icon={<Send size={18} />}
            campaignId={campaign.id}
            assets={threadsAssets}
            queues={campaign.queues}
            queueLinks={campaign.queueLinks}
            onUpdateAsset={onUpdateAsset}
            onRewriteAsset={onRewriteAsset}
            updatingId={updatingId}
          />}
          {selectedPlatform !== 'threads' && <InstagramColumn
            campaignId={campaign.id}
            assets={instagramAssets}
            queues={campaign.queues}
            queueLinks={campaign.queueLinks}
            onUpdateAsset={onUpdateAsset}
            onRewriteAsset={onRewriteAsset}
            updatingId={updatingId}
          />}
        </div>
      </div>
    </div>
  );
}

function CampaignImageEditor({ campaign, onSave, onRegenerate, saving, regenerating }) {
  const current = campaign.product_image_url || campaign.generation_input?.productImageUrl || '';
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current, campaign.id]);
  const media = campaign.diagnostics?.media || {};
  const isDirty = draft !== current;
  const statusTone = media.needsRegeneration ? 'bg-amber-50 text-amber-700' : media.appliedToCurrentAssets ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600';
  const upload = async (file) => {
    if (!file) return;
    const dataUrl = await readImageFile(file);
    setDraft(dataUrl);
  };
  return (
    <div className="grid gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="grid content-start gap-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-black text-slate-900">이미지 소스</div>
            <div className="mt-1 text-xs leading-relaxed text-slate-500">저장 후 소재 재생성을 해야 생성 카드에 반영됩니다.</div>
          </div>
          <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-black ${isDirty ? 'bg-blue-50 text-blue-700' : statusTone}`}>
            {isDirty ? '저장 전' : (media.status || '이미지 없음')}
          </span>
        </div>
        {draft ? (
          <img src={draft} alt="Instagram product" className="aspect-video w-full rounded-lg border border-slate-200 bg-white object-cover" />
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-lg border border-dashed border-slate-300 bg-white text-xs font-bold text-slate-400">이미지 없음</div>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className={inputClass} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="이미지 URL 또는 업로드 데이터" />
          <button type="button" onClick={() => onSave(draft)} disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
            <Image size={16} /> {saving ? '저장 중' : '이미지 저장'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-50">
            <Upload size={16} /> 이미지 파일 업로드
            <input type="file" accept="image/*" className="hidden" onChange={(event) => upload(event.target.files?.[0]).catch(console.error)} />
          </label>
          <button type="button" onClick={() => setDraft('')} disabled={!draft}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-500 hover:bg-slate-50 disabled:opacity-40">
            제거
          </button>
        </div>
      </div>
      <div className="grid content-start gap-3">
        <div className="text-sm font-black text-slate-900">생성 카드 미리보기</div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="aspect-square overflow-hidden rounded-lg border border-slate-100 bg-slate-50 p-4">
            <div className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-black text-white">{objectiveLabel(campaign.objective_type || campaign.generation_input?.objectiveType || 'click')}</div>
            <div className="mt-4 grid grid-cols-[96px_1fr] gap-3">
              {draft ? <img src={draft} alt="draft preview" className="aspect-square w-full rounded-lg border border-slate-200 object-cover" /> : <div className="grid aspect-square place-items-center rounded-lg border border-dashed border-slate-300 text-xs font-black text-slate-400">IMAGE</div>}
              <div className="min-w-0">
                <div className="break-words text-lg font-black leading-snug text-slate-950">{campaign.product_name}</div>
                <div className="mt-2 text-xs font-bold leading-relaxed text-slate-500">{campaign.operation_set?.proofPoint || campaign.target_goal}</div>
              </div>
            </div>
            <div className="mt-5 text-lg font-black leading-snug text-slate-950">{campaign.operation_set?.primaryMessage || `${campaign.product_name} 운영 흐름을 자동화하세요.`}</div>
          </div>
          <button type="button" onClick={onRegenerate} disabled={regenerating || isDirty}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-black text-white disabled:opacity-50">
            <RefreshCw size={16} /> {regenerating ? '재생성 중' : '이미지 적용하고 소재 재생성'}
          </button>
          {isDirty && <div className="mt-2 text-xs font-bold text-amber-700">먼저 이미지 저장을 눌러야 재생성할 수 있습니다.</div>}
        </div>
      </div>
    </div>
  );
}

function CampaignDiagnosticsPanel({ campaign }) {
  const diagnostics = campaign.diagnostics || {};
  const reliability = diagnostics.cujasaReliability;
  const checks = [
    ['목표/전환', `${objectiveLabel(diagnostics.objective || campaign.objective_type || 'click')} · ${diagnostics.destination || '-'}`],
    ['계정', diagnostics.account ? `${diagnostics.account.status || '-'} · 자동화 ${diagnostics.account.automationStatus || 'paused'}` : '계정 없음'],
    ['이미지', diagnostics.media?.status || '이미지 없음'],
    ['소재', `Threads ${diagnostics.assets?.threads || 0}개 · Instagram ${diagnostics.assets?.instagram || 0}개`],
    ['예약 큐', `예약 ${diagnostics.queues?.scheduled || 0}개 · 확인 ${diagnostics.queues?.manualRequired || 0}개 · 실패 ${diagnostics.queues?.failed || 0}개`],
    ['리드폼', diagnostics.leadForm?.connected ? '연결됨' : '없음']
  ];
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-black text-slate-900">운영 진단</div>
          <div className="mt-1 text-xs leading-relaxed text-slate-500">목표, 소재, 큐, 리드폼, CUJASA 기본 흐름을 한 번에 확인합니다.</div>
        </div>
        <span className={`rounded-md px-2 py-1 text-xs font-black ${reliability?.issueCount ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {reliability?.status || '진단 대기'}
        </span>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-6">
        {checks.map(([label, value]) => (
          <div key={label} className="rounded-lg bg-slate-50 px-3 py-3">
            <div className="text-[11px] font-black text-slate-400">{label}</div>
            <div className="mt-1 text-sm font-black leading-snug text-slate-800">{value}</div>
          </div>
        ))}
      </div>
      {reliability?.issues?.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {reliability.issues.map((issue) => (
            <div key={issue.label} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-black text-amber-800">
              {issue.label} {issue.count}건
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LeadSubmissionsPanel({ campaign }) {
  const leadForm = campaign.leadForm;
  const submissions = campaign.leadSubmissions || [];
  const copyUrl = async () => {
    if (!leadForm?.public_url) return;
    await navigator.clipboard?.writeText(leadForm.public_url);
  };
  const exportCsv = () => {
    const fields = leadForm.fields || [];
    const header = ['created_at', 'status', ...fields];
    const lines = [header, ...submissions.map((submission) => [
      submission.created_at,
      submission.status,
      ...fields.map((field) => submission.payload?.[field] || '')
    ])].map((row) => row.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${campaign.name || 'lead-submissions'}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="text-sm font-black text-blue-950">리드 수집 양식</div>
          <div className="mt-1 break-all text-xs font-bold leading-relaxed text-blue-800">{leadForm.public_url}</div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs font-black text-blue-800">
            {(leadForm.fields || []).map((field) => <span key={field} className="rounded-md bg-white px-2 py-1">{leadFieldLabel(field)}</span>)}
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={copyUrl} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-800">URL 복사</button>
          <button type="button" onClick={exportCsv} disabled={!submissions.length} className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-black text-blue-800 disabled:opacity-40">CSV</button>
          <a href={leadForm.public_url} target="_blank" rel="noreferrer" className="rounded-lg bg-blue-700 px-3 py-2 text-xs font-black text-white">양식 열기</a>
        </div>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-blue-100 bg-white">
        <div className="border-b border-blue-50 px-3 py-2 text-xs font-black text-slate-600">제출 {submissions.length}건</div>
        {submissions.length ? submissions.slice(0, 6).map((submission) => (
          <div key={submission.id} className="grid gap-1 border-b border-slate-100 px-3 py-3 text-xs last:border-b-0 md:grid-cols-[1fr_auto]">
            <div className="font-bold text-slate-700">
              {Object.entries(submission.payload || {}).map(([key, value]) => `${leadFieldLabel(key)}: ${value}`).join(' · ')}
            </div>
            <div className="font-bold text-slate-400">{formatDate(submission.created_at)}</div>
          </div>
        )) : <div className="px-3 py-5 text-sm text-slate-500">아직 제출된 리드가 없습니다.</div>}
      </div>
    </div>
  );
}

function NoteEditor({ value, onSave, saving }) {
  const [draft, setDraft] = useState(value || '');
  useEffect(() => setDraft(value || ''), [value]);
  return (
    <div className="grid gap-2">
      <label className="text-xs font-black text-slate-600">다음 액션 메모</label>
      <textarea className="min-h-20 w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
        value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="다음 운영 액션을 기록" />
      <button type="button" onClick={() => onSave(draft)} disabled={saving}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        <ClipboardPen size={14} /> {saving ? '저장 중' : '메모 저장'}
      </button>
    </div>
  );
}

function queueForAsset(asset, queues = [], queueLinks = []) {
  const link = queueLinks.find((item) => item.asset_id === asset.id);
  return queues.find((row) => row.id === link?.queue_id) || null;
}

function AssetColumn({ title, icon, campaignId, assets, queues, queueLinks, onUpdateAsset, onRewriteAsset, onDeleteAsset, updatingId }) {
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900">{icon}{title}</div>
      <div className="grid max-h-[620px] gap-3 overflow-y-auto p-4">
        {assets.length === 0 && <div className="text-sm text-slate-500">이 캠페인에는 Threads 소재가 없습니다.</div>}
        {assets.map((asset, index) => {
          const queue = queueForAsset(asset, queues, queueLinks) || queues?.[index];
          return (
            <article key={asset.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-black text-slate-900">{asset.title}</div>
                <div className="flex items-center gap-1">
                  <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{assetStatusLabel(asset.review_status || asset.status)}</span>
                  {onRewriteAsset && (
                    <button type="button" onClick={() => onRewriteAsset(campaignId, asset.id)} disabled={updatingId === `rewrite:${asset.id}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50" title="랜덤 재작성">
                      <RefreshCw size={14} />
                    </button>
                  )}
                  {onDeleteAsset && (
                    <button type="button" onClick={() => onDeleteAsset(campaignId, asset.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50" title="소재 삭제">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{asset.body}</p>
              <AssetQualityPanel asset={asset} />
              <AssetCopyEditor
                asset={asset}
                campaignId={campaignId}
                field="body"
                label="Threads 문구"
                onUpdateAsset={onUpdateAsset}
                saving={updatingId === asset.id}
              />
              <AssetReviewControls asset={asset} campaignId={campaignId} onUpdateAsset={onUpdateAsset} saving={updatingId === asset.id} />
              <div className="mt-3 text-xs font-bold text-slate-500">예약 {formatDate(queue?.scheduled_at)}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function InstagramColumn({ campaignId, assets, queues, queueLinks, onUpdateAsset, onRewriteAsset, onDeleteAsset, updatingId }) {
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 text-sm font-black text-slate-900"><Image size={18} />Instagram 카드 미리보기</div>
      <div className="grid max-h-[620px] gap-3 overflow-y-auto p-4">
        {assets.length === 0 && <div className="text-sm text-slate-500">이 캠페인에는 Instagram 채널이 선택되지 않았습니다.</div>}
        {assets.map((asset, index) => {
          const queue = queueForAsset(asset, queues, queueLinks) || queues?.filter((row) => row.platform === 'instagram')[index];
          return (
            <article key={asset.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-2 text-sm font-black text-slate-900"><SquareStack size={16} />{asset.title}</div>
                <div className="flex items-center gap-1">
                  <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-700">Graph API 제외</span>
                  {onRewriteAsset && (
                    <button type="button" onClick={() => onRewriteAsset(campaignId, asset.id)} disabled={updatingId === `rewrite:${asset.id}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-50" title="랜덤 재작성">
                      <RefreshCw size={14} />
                    </button>
                  )}
                  {onDeleteAsset && (
                    <button type="button" onClick={() => onDeleteAsset(campaignId, asset.id)} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 text-rose-600 hover:bg-rose-50" title="소재 삭제">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
              {asset.image_data_url && <img src={asset.image_data_url} alt={asset.title} className="aspect-square w-full rounded-lg border border-slate-100 object-cover" />}
              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">{asset.metadata?.caption}</p>
              <AssetQualityPanel asset={asset} />
              <AssetCopyEditor
                asset={asset}
                campaignId={campaignId}
                field="caption"
                label="Instagram 캡션"
                onUpdateAsset={onUpdateAsset}
                saving={updatingId === asset.id}
              />
              <AssetReviewControls asset={asset} campaignId={campaignId} onUpdateAsset={onUpdateAsset} saving={updatingId === asset.id} />
              <div className="mt-3 text-xs font-bold text-slate-500">예약/대기 {formatDate(queue?.scheduled_at)}</div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function AssetQualityPanel({ asset }) {
  const score = qualityScore(asset);
  const warnings = qualityWarnings(asset);
  const pattern = asset.metadata?.quality?.engagementPattern;
  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-md px-2 py-1 text-xs font-black ${qualityTone(score)}`}>품질 {score ?? '-'}</span>
        {pattern && <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600">{pattern}</span>}
        <span className="rounded-md bg-white px-2 py-1 text-xs font-bold text-slate-600">위험 {asset.metadata?.riskLevel || 'low'}</span>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 grid gap-1 text-xs leading-relaxed text-slate-600">
          {warnings.slice(0, 3).map((warning) => <div key={warning}>· {warning}</div>)}
        </div>
      )}
    </div>
  );
}

function AssetCopyEditor({ asset, campaignId, field, label, onUpdateAsset, saving }) {
  const current = field === 'caption' ? (asset.metadata?.caption || asset.body || '') : (asset.body || '');
  const [draft, setDraft] = useState(current);
  useEffect(() => setDraft(current), [current, asset.id]);
  const save = () => {
    const value = draft.trim();
    onUpdateAsset(campaignId, asset.id, field === 'caption' ? { caption: value } : { body: value, title: value });
  };
  return (
    <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
      <label className="text-xs font-black text-slate-600">{label} 직접 수정</label>
      <textarea
        className="min-h-16 w-full resize-y rounded-md border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-900"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button type="button" onClick={save} disabled={saving || !draft.trim()}
        className="justify-self-start rounded-md bg-slate-900 px-2.5 py-1.5 text-xs font-black text-white disabled:opacity-50">
        {saving ? '저장 중' : '문구 저장'}
      </button>
    </div>
  );
}

function AssetReviewControls({ asset, campaignId, onUpdateAsset, saving }) {
  const [note, setNote] = useState(asset.operation_note || '');
  useEffect(() => setNote(asset.operation_note || ''), [asset.operation_note, asset.id]);
  const save = (patch) => onUpdateAsset(campaignId, asset.id, {
    operationNote: note,
    reusable: Boolean(asset.reusable),
    ...patch
  });
  return (
    <div className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => save({ status: 'approved' })} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-black text-white disabled:opacity-50">
          <CheckCircle2 size={14} /> 승인
        </button>
        <button type="button" onClick={() => save({ status: 'rejected' })} disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-black text-rose-700 disabled:opacity-50">
          <XCircle size={14} /> 반려
        </button>
        <button type="button" onClick={() => save({ reusable: !asset.reusable })} disabled={saving}
          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-black disabled:opacity-50 ${asset.reusable ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600'}`}>
          재사용 {asset.reusable ? 'ON' : 'OFF'}
        </button>
      </div>
      <textarea className="min-h-16 w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-slate-900"
        value={note} onChange={(event) => setNote(event.target.value)} placeholder="운영 메모" />
      <button type="button" onClick={() => save({})} disabled={saving}
        className="justify-self-start rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
        {saving ? '저장 중' : '메모 저장'}
      </button>
    </div>
  );
}
