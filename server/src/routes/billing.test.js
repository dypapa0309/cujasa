import assert from 'node:assert/strict';
import test from 'node:test';
import { assertAgreementPayload } from './billing.js';

const validSnapshot = {
  checked: {
    terms: true,
    service: true,
    platformRisk: true,
    refundPolicy: true
  }
};

test('billing agreement payload is required before checkout starts', () => {
  assert.throws(() => assertAgreementPayload({}), /동의/);
  assert.throws(() => assertAgreementPayload({
    agreementAccepted: true,
    agreementVersion: 'old-version',
    agreementSnapshot: validSnapshot
  }), /최신/);
  assert.throws(() => assertAgreementPayload({
    agreementAccepted: true,
    agreementVersion: 'jasain-payment-terms-v2',
    agreementSnapshot: { checked: { terms: true, service: true, platformRisk: true } }
  }), /필수 동의/);

  assert.deepEqual(assertAgreementPayload({
    agreementAccepted: true,
    agreementVersion: 'jasain-payment-terms-v2',
    agreementSnapshot: validSnapshot
  }), validSnapshot);
});
