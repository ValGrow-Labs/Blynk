import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import {
  ADMIN_NO_RIDER,
  ADMIN_WITH_RIDER,
  CUSTOMER,
  NETWORK_DOWN,
  RIDER,
  STAFF,
  fail,
  ok,
  renderAs,
} from './helpers';

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * F2 replaced Home's F1 placeholder (which rendered `riderCapability`
 * literally, e.g. "ADMIN_PLUS_RIDER") with the real dashboard - these
 * classification tests now read the Delivery tab's `aria-disabled` state
 * instead (the same observable `layout.test.tsx` already asserts on), since
 * it is driven by the exact same `riderCapability` value and, unlike Home's
 * own content, does not depend on mocking Home's unrelated endpoints
 * (orders/dental/riders) that these auth-flow tests have nothing to do
 * with.
 */
async function expectRiderCapable() {
  const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
  expect(deliveryTab).not.toHaveAttribute('aria-disabled');
}
async function expectAdminOnly() {
  const deliveryTab = await screen.findByRole('link', { name: /^Delivery/ });
  expect(deliveryTab).toHaveAttribute('aria-disabled', 'true');
}

describe('Operations sign-in and session classification', () => {
  it('an ADMIN with a linked, active rider profile is classified ADMIN_PLUS_RIDER', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await expectRiderCapable();
  });

  it.each(['RIDER_PROFILE_NOT_FOUND', 'RIDER_INACTIVE'])(
    'an ADMIN whose rider probe fails with %s is classified ADMIN_ONLY, and the session stays signed in',
    async (code) => {
      renderAs(ADMIN_NO_RIDER, '/', { 'GET /riders/deliveries': () => fail(403, code) });
      await expectAdminOnly();
      // A rider-profile refusal is not a session-ending event for Operations.
      expect(tokenStore.access).toBe('test-access');
    }
  );

  it('an unexpected probe failure (e.g. a dropped connection) is treated conservatively as ADMIN_ONLY, never crashes', async () => {
    renderAs(ADMIN_NO_RIDER, '/', { 'GET /riders/deliveries': () => NETWORK_DOWN });
    await expectAdminOnly();
    expect(tokenStore.access).toBe('test-access');
  });

  it.each([
    ['customer', CUSTOMER],
    ['rider', RIDER],
    ['packing staff', STAFF],
  ])('a %s session is signed out immediately with a clear message, and never probes the rider endpoint', async (_label, user) => {
    const { api } = renderAs(user, '/');
    expect(
      await screen.findByText('This app is for Blynk operators. Sign in with an admin account.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
    expect(api.find('GET', '/riders/deliveries')).toHaveLength(0);
  });

  it('OTP sign-in refuses a non-admin account and keeps no token', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: CUSTOMER }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0771234567');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    expect(
      await screen.findByText('This app is for Blynk operators. Sign in with an admin account.')
    ).toBeInTheDocument();
    expect(tokenStore.access).toBeNull();
  });

  it('OTP sign-in lets an operator in and classifies the session (ADMIN_PLUS_RIDER)', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '123456' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_WITH_RIDER }),
      'GET /riders/deliveries': () => ok({ deliveries: [] }),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0775551122');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Dev code: 123456')).toBeInTheDocument();
    await user.type(screen.getByLabelText('6-digit code'), '123456');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await expectRiderCapable();
    expect(tokenStore.access).toBe('a');
  });

  it('OTP sign-in for an operator with no linked rider profile classifies ADMIN_ONLY', async () => {
    const user = userEvent.setup();
    renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '654321' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_NO_RIDER }),
      'GET /riders/deliveries': () => fail(403, 'RIDER_PROFILE_NOT_FOUND'),
    });
    await user.type(await screen.findByLabelText('Mobile number'), '0775551133');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    await user.type(await screen.findByLabelText('6-digit code'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await expectAdminOnly();
  });

  it('session restore via GET /auth/me works and re-runs the rider probe', async () => {
    renderAs(ADMIN_WITH_RIDER, '/', { 'GET /riders/deliveries': () => ok({ deliveries: [] }) });
    await expectRiderCapable();
  });

  it('shows the dev Skip button only when a dev operator phone is configured', async () => {
    // 2026-09-24: stub it EMPTY rather than relying on it being unset. Vite
    // loads `.env.local` in tests too, so once a developer configures
    // VITE_DEV_OPERATOR_PHONE to use Skip locally, this case silently inverted
    // and failed. Stubbing makes the test hermetic — it now asserts the
    // absence for the reason it claims to, not because of ambient config.
    vi.stubEnv('VITE_DEV_OPERATOR_PHONE', '');
    renderAs(null, '/login');
    await screen.findByLabelText('Mobile number');
    expect(screen.queryByRole('button', { name: 'Skip sign-in' })).not.toBeInTheDocument();
  });

  it('dev Skip runs the normal OTP flow for the configured operator', async () => {
    vi.stubEnv('VITE_DEV_OPERATOR_PHONE', '0775551122');
    const user = userEvent.setup();
    const { api } = renderAs(null, '/login', {
      'POST /auth/otp/request': () => ok({ dev_otp: '999999' }),
      'POST /auth/otp/verify': () => ok({ access_token: 'a', refresh_token: 'r', user: ADMIN_WITH_RIDER }),
      'GET /riders/deliveries': () => ok({ deliveries: [] }),
    });
    await user.click(await screen.findByRole('button', { name: 'Skip sign-in' }));
    await expectRiderCapable();
    expect(api.find('POST', '/auth/otp/verify')[0].body).toEqual({ phone: '0775551122', otp: '999999' });
  });
});
