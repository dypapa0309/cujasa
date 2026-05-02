import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

const emptyForm = {
  title: '',
  message: '',
  status: 'draft',
  starts_at: '',
  ends_at: ''
};

function toInputDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromInputDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function statusLabel(status) {
  return { active: '활성', draft: '초안', inactive: '비활성' }[status] || status;
}

export default function AdminAnnouncementsPage() {
  const toast = useToast();
  const [announcements, setAnnouncements] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const rows = await api.get('/api/admin/announcements');
    setAnnouncements(rows);
  };

  useEffect(() => {
    load().catch(() => toast('공지 목록을 불러오지 못했습니다.', 'error')).finally(() => setLoading(false));
  }, []);

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId('');
  };

  const edit = (announcement) => {
    setEditingId(announcement.id);
    setForm({
      title: announcement.title || '',
      message: announcement.message || '',
      status: announcement.status || 'draft',
      starts_at: toInputDateTime(announcement.starts_at),
      ends_at: toInputDateTime(announcement.ends_at)
    });
  };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.message.trim()) {
      toast('제목과 내용을 입력해주세요.', 'error');
      return;
    }
    setSaving(true);
    const payload = {
      title: form.title.trim(),
      message: form.message.trim(),
      status: form.status,
      starts_at: fromInputDateTime(form.starts_at),
      ends_at: fromInputDateTime(form.ends_at)
    };
    try {
      if (editingId) await api.patch(`/api/admin/announcements/${editingId}`, payload);
      else await api.post('/api/admin/announcements', payload);
      await load();
      resetForm();
      toast('공지 설정이 저장되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '공지 저장에 실패했습니다.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (announcement, status) => {
    try {
      await api.patch(`/api/admin/announcements/${announcement.id}`, { status });
      await load();
      toast('공지 상태가 변경되었습니다.', 'success');
    } catch (err) {
      toast(err.message || '상태 변경에 실패했습니다.', 'error');
    }
  };

  const remove = async (announcement) => {
    if (!confirm('공지사항을 삭제하시겠습니까?')) return;
    try {
      await api.delete(`/api/admin/announcements/${announcement.id}`);
      await load();
      if (editingId === announcement.id) resetForm();
      toast('공지사항이 삭제되었습니다.', 'success');
    } catch {
      toast('삭제에 실패했습니다.', 'error');
    }
  };

  return (
    <div className="grid gap-5">
      <div>
        <div className="text-sm text-slate-400">고객 앱 전체 공지 팝업 관리</div>
        <h2 className="mt-1 text-2xl font-bold text-slate-900">공지 관리</h2>
      </div>

      <form onSubmit={save} className="grid gap-4 rounded border border-line bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="font-semibold text-sm">{editingId ? '공지 수정' : '새 공지 작성'}</div>
          {editingId && (
            <button type="button" onClick={resetForm} className="rounded border border-line px-3 py-1.5 text-xs text-slate-500 hover:text-slate-800">
              새 공지로 전환
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-[1fr_160px]">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">제목</span>
            <input className="rounded border border-line px-3 py-2" value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="예: 오늘 서버 점검 안내" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">상태</span>
            <select className="rounded border border-line px-3 py-2" value={form.status} onChange={(e) => update('status', e.target.value)}>
              <option value="draft">초안</option>
              <option value="active">활성</option>
              <option value="inactive">비활성</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1 text-sm">
          <span className="font-medium">내용</span>
          <textarea
            rows={5}
            className="resize-y rounded border border-line px-3 py-2 leading-relaxed"
            value={form.message}
            onChange={(e) => update('message', e.target.value)}
            placeholder="고객에게 보여줄 안내 문구를 입력하세요."
          />
        </label>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="font-medium">시작 시간</span>
            <input type="datetime-local" className="rounded border border-line px-3 py-2" value={form.starts_at} onChange={(e) => update('starts_at', e.target.value)} />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">종료 시간</span>
            <input type="datetime-local" className="rounded border border-line px-3 py-2" value={form.ends_at} onChange={(e) => update('ends_at', e.target.value)} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button disabled={saving} className="rounded bg-coupang px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saving ? '저장 중...' : editingId ? '공지 수정' : '공지 생성'}
          </button>
          <span className="text-xs text-slate-400">활성 상태이고 기간 안에 있는 가장 최근 공지 1개가 고객 앱에 표시됩니다.</span>
        </div>
      </form>

      <div className="grid gap-3">
        {loading ? (
          <div className="h-28 animate-pulse rounded border border-line bg-white" />
        ) : announcements.length === 0 ? (
          <div className="rounded border border-line bg-white p-8 text-center text-sm text-slate-400">등록된 공지가 없습니다</div>
        ) : (
          announcements.map((announcement) => (
            <div key={announcement.id} className="rounded border border-line bg-white p-5">
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-semibold text-slate-900">{announcement.title}</div>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${announcement.status === 'active' ? 'bg-green-100 text-green-700' : announcement.status === 'draft' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-700'}`}>
                      {statusLabel(announcement.status)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{announcement.message}</p>
                  <div className="mt-3 text-xs text-slate-400">
                    기간: {announcement.starts_at ? new Date(announcement.starts_at).toLocaleString('ko-KR') : '즉시'} ~ {announcement.ends_at ? new Date(announcement.ends_at).toLocaleString('ko-KR') : '제한 없음'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => edit(announcement)} className="rounded border border-line px-3 py-2 text-xs font-semibold text-slate-600 hover:border-coupang hover:text-coupang">수정</button>
                  {announcement.status === 'active' ? (
                    <button onClick={() => setStatus(announcement, 'inactive')} className="rounded border border-line px-3 py-2 text-xs font-semibold text-amber-600 hover:border-amber-300">비활성</button>
                  ) : (
                    <button onClick={() => setStatus(announcement, 'active')} className="rounded border border-line px-3 py-2 text-xs font-semibold text-green-600 hover:border-green-300">활성</button>
                  )}
                  <button onClick={() => remove(announcement)} className="rounded border border-line px-3 py-2 text-xs font-semibold text-red-500 hover:border-red-300">삭제</button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
