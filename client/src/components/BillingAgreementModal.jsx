import { useMemo, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';

export const BILLING_AGREEMENT_VERSION = 'jasain-payment-terms-v1';

const agreementSections = [
  {
    title: '서비스 제공 범위',
    body: 'JASAIN은 선택한 상품에 따라 자동화 설정, 콘텐츠 생성, 예약, 업로드 보조, 운영 현황 확인 기능을 제공합니다. 외부 플랫폼 계정 연결과 쿠팡 파트너스 정보는 고객이 제공하거나 직접 연결해야 합니다.'
  },
  {
    title: '자동화 및 외부 플랫폼 리스크',
    body: 'Threads, Coupang, Toss 등 외부 서비스 정책이나 API 변경, 계정 상태, 심사 또는 제한으로 자동화 결과가 달라질 수 있습니다. 회사는 확인 가능한 범위에서 복구와 안내를 제공합니다.'
  },
  {
    title: '환불/취소 기준',
    body: '입금 또는 자동결제 승인 후에는 서비스 제공 준비가 시작됩니다. 환불과 취소는 실제 제공 상태, 사용량, 세팅 진행 여부, 관련 법령 및 고지된 운영 기준에 따라 처리됩니다.'
  },
  {
    title: '계약 효력 발생',
    body: '가상계좌 입금 확인 또는 카드 자동결제 승인 시 본 이용조건에 따른 계약 효력이 발생하며, 셋업 및 서비스 제공 절차가 진행됩니다.'
  }
];

export function buildBillingAgreementSnapshot({ product, flow }) {
  return {
    version: BILLING_AGREEMENT_VERSION,
    title: 'JASAIN 서비스 이용 및 결제 계약',
    flow,
    product: {
      id: product?.id || '',
      appProductId: product?.app_product_id || product?.appProductId || 'cujasa',
      name: product?.name || '',
      amount: Number(product?.amount || 0),
      billingCycle: product?.billing_cycle || product?.billingCycle || ''
    },
    sections: agreementSections,
    checked: {
      terms: true,
      service: true,
      platformRisk: true
    }
  };
}

function price(value) {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`;
}

export default function BillingAgreementModal({ product, flow = 'payment', busy = false, onCancel, onConfirm }) {
  const [checks, setChecks] = useState({ terms: false, service: false, platformRisk: false });
  const canSubmit = checks.terms && checks.service && checks.platformRisk && product && !busy;
  const snapshot = useMemo(() => ({
    ...buildBillingAgreementSnapshot({ product, flow }),
    checked: checks
  }), [checks, flow, product]);

  const toggle = (key) => setChecks((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-gray-400">
              <ShieldCheck size={15} />
              계약 확인
            </div>
            <h2 className="mt-1 text-lg font-black text-gray-950">서비스 이용 및 결제 계약 동의</h2>
            <p className="mt-1 text-sm text-gray-500">{product?.name || '선택 상품'} · {price(product?.amount)}</p>
          </div>
          <button type="button" onClick={onCancel} className="grid h-9 w-9 place-items-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-700">
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <div className="grid gap-3">
            {agreementSections.map((section) => (
              <div key={section.title} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="text-sm font-black text-gray-900">{section.title}</div>
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{section.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <label className="flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2 text-sm font-bold text-gray-700">
              <input type="checkbox" checked={checks.terms} onChange={() => toggle('terms')} className="mt-1" />
              이용조건과 결제 계약 내용을 확인하고 동의합니다.
            </label>
            <label className="flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2 text-sm font-bold text-gray-700">
              <input type="checkbox" checked={checks.service} onChange={() => toggle('service')} className="mt-1" />
              결제 또는 입금 확인 후 서비스 제공 및 셋업 절차가 진행되는 것에 동의합니다.
            </label>
            <label className="flex items-start gap-2 rounded-xl border border-gray-100 px-3 py-2 text-sm font-bold text-gray-700">
              <input type="checkbox" checked={checks.platformRisk} onChange={() => toggle('platformRisk')} className="mt-1" />
              외부 플랫폼 정책 변경과 계정 상태에 따라 자동화 결과가 달라질 수 있음을 확인했습니다.
            </label>
          </div>
        </div>
        <div className="grid gap-2 border-t border-gray-100 px-5 py-4 sm:grid-cols-[1fr_auto]">
          <button type="button" onClick={onCancel} className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-black text-gray-500 hover:bg-gray-50">
            취소
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm?.(snapshot)}
            className="rounded-xl bg-gray-950 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '진행 중...' : '동의하고 결제 진행'}
          </button>
        </div>
      </div>
    </div>
  );
}

