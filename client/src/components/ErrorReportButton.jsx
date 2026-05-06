import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api } from '../lib/api.js';
import { useToast } from '../lib/toast.jsx';

export default function ErrorReportButton({
  account,
  currentUser,
  context = {},
  label = '관리자에게 오류 보내기',
  className = ''
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      const result = await api.post('/api/support/error-report', {
        accountId: account?.id || context.accountId,
        accountName: account?.name || context.accountName,
        accountHandle: account?.account_handle || context.accountHandle,
        userEmail: currentUser?.email,
        buyerName: currentUser?.buyer_name || currentUser?.buyerName,
        page: window.location.href,
        browserTime: new Date().toISOString(),
        note,
        ...context
      });
      toast(result?.message || '관리자에게 전달했습니다. 확인 후 안내드릴게요.', 'success');
      setOpen(false);
      setNote('');
    } catch (error) {
      toast(error.message || '오류 신고를 보내지 못했습니다.', 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className || 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-600'}
      >
        <AlertCircle size={14} />
        {label}
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/45 px-5 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="text-lg font-black text-gray-900">오류를 관리자에게 보낼까요?</div>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              화면 정보와 오류 내용을 함께 전달합니다. 필요한 내용을 짧게 남겨주세요.
            </p>
            <textarea
              rows="4"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="예: 저장 버튼을 누르면 계속 실패해요."
              className="mt-4 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm outline-none focus:border-coupang"
            />
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-bold text-gray-600 disabled:opacity-50"
              >
                닫기
              </button>
              <button
                type="button"
                onClick={send}
                disabled={sending}
                className="rounded-xl bg-coupang px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {sending ? '전송 중...' : '전송하기'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
