import { refreshUserEntitlement } from './billingEntitlementService.js';
import { dbList } from './supabaseService.js';

function item(code, status, title, message, action = null, accountId = null) {
  return { code, status, title, message, action, accountId };
}

function hasContentSettings(account) {
  return Boolean(String(account.target_audience || '').trim() && String(account.content_scope || '').trim());
}

function hasCoupangSettings(account) {
  return Boolean(account.coupang_access_key && account.coupang_secret_key && account.coupang_partner_id);
}

function isThreadsConnected(account) {
  return Boolean(account.threads_access_token && account.threads_token_status !== 'refresh_failed');
}

function accountReadiness(account) {
  const blocking = [];
  const warnings = [];

  if (!isThreadsConnected(account)) {
    blocking.push(item(
      'threads_required',
      'blocking',
      'Threads 연결 필요',
      `${account.name || '계정'}의 Threads 연결을 완료해주세요.`,
      'settings',
      account.id
    ));
  }

  if (!hasContentSettings(account)) {
    blocking.push(item(
      'content_required',
      'blocking',
      '콘텐츠 설정 필요',
      `${account.name || '계정'}의 타겟 오디언스와 다룰 카테고리를 입력해주세요.`,
      'settings',
      account.id
    ));
  }

  if (!hasCoupangSettings(account)) {
    blocking.push(item(
      'coupang_required_for_links',
      'blocking',
      '쿠팡 API 설정 필요',
      `${account.name || '계정'}은 수익화 가능한 링크 글만 자동 업로드합니다. 쿠팡 Access Key, Secret Key, Partner ID를 입력해주세요.`,
      'settings',
      account.id
    ));
  }

  return {
    accountId: account.id,
    name: account.name,
    handle: account.account_handle,
    ready: blocking.length === 0,
    blocking,
    warnings
  };
}

export async function getSetupStatusForUser(userId, { role } = {}) {
  if (role === 'admin') {
    return {
      ready: true,
      mode: 'admin',
      blocking: [],
      warnings: [],
      accounts: []
    };
  }

  const [entitlement, mappings, accounts] = await Promise.all([
    refreshUserEntitlement(userId),
    dbList('user_accounts', { user_id: userId }),
    dbList('accounts')
  ]);
  const accountIds = new Set(mappings.map((row) => row.account_id));
  const ownedAccounts = accounts.filter((account) => accountIds.has(account.id) && account.status !== 'archived');

  const blocking = [];
  const warnings = [];

  if (!entitlement.hasAccess) {
    blocking.push(item(
      entitlement.isExpired ? 'billing_expired' : 'billing_required',
      'blocking',
      entitlement.isExpired ? '이용 기간 만료' : '상품 권한 필요',
      entitlement.isExpired ? '이용 기간이 만료되었습니다. 결제 또는 연장이 필요합니다.' : 'CUJASA 이용 권한이 필요합니다.',
      'billing'
    ));
  }

  if (ownedAccounts.length === 0) {
    blocking.push(item(
      'account_required',
      'blocking',
      '계정 생성 필요',
      '자동화를 시작할 Threads 계정을 하나 이상 생성해주세요.',
      'settings'
    ));
  }

  const accountStatuses = ownedAccounts.map(accountReadiness);
  accountStatuses.forEach((status) => {
    blocking.push(...status.blocking);
    warnings.push(...status.warnings);
  });

  return {
    ready: blocking.length === 0,
    mode: entitlement.user?.plan === 'free' ? 'self_setup' : 'paid_setup',
    billing: entitlement.billing,
    blocking,
    warnings,
    accounts: accountStatuses
  };
}
