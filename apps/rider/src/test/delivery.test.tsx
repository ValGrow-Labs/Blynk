import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenStore } from '../api/client';
import type { DeliveryDetail } from '../api/types';
import { capacitorTrackingPlugin } from '../lib/tracking-plugin';
import { RIDER, TIMED_OUT, detail, fail, ok, renderAs } from './helpers';

// The real capacitorTrackingPlugin talks to a native bridge that doesn't
// exist in jsdom; requesting permission there fails closed ('unavailable'),
// which would leave tracking inert in every test. Faking it as an
// already-granted, always-succeeding plugin lets these tests exercise
// Delivery.tsx's actual start/stop wiring and TrackingStatus's real
// "sharing" state, deterministically and without a network call - the
// coordinate-secrecy test below relies on this to prove the guarantee holds
// while tracking is genuinely active, not merely while its UI is unmounted.
vi.mock('../lib/tracking-plugin', () => ({
  capacitorTrackingPlugin: {
    checkPermission: vi.fn(async () => 'granted'),
    requestPermission: vi.fn(async () => 'granted'),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  tokenStore.clear();
  vi.unstubAllGlobals();
});

const ROUTE = '/deliveries/d-1';
const onRoad = { assignment_status: 'PICKED_UP', order_status: 'OUT_FOR_DELIVERY' } as const;
const atDoor = { assignment_status: 'ARRIVED_AT_CUSTOMER', order_status: 'OUT_FOR_DELIVERY' } as const;

/** A detail endpoint whose answer the test can change between calls. */
function serving(initial: DeliveryDetail) {
  const state = { current: initial };
  return { state, handler: () => ok({ delivery: state.current }) };
}

const actionBar = () => screen.getByRole('group', { name: 'Delivery actions' });

describe('Delivery', () => {
  it('shows what the rider needs: destination, call, bag, cash, and the one next step', async () => {
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': () =>
        ok({
          delivery: detail({
            delivery_address_line2: 'Near the clock tower',
            delivery_instructions: 'Blue gate, ring twice',
            items: [
              { id: 'i1', product_name_snapshot: 'Kotmale Fresh Milk 1L', quantity: 2, item_status: 'SOURCED' },
              { id: 'i2', product_name_snapshot: 'Pelwatte Butter 200g', quantity: 1, item_status: 'SOURCED' },
            ],
          }),
        }),
    });
    expect(await screen.findByText('No. 1, Test Lane')).toBeInTheDocument();
    expect(screen.getByText('Near the clock tower')).toBeInTheDocument();
    expect(screen.getByText('Blue gate, ring twice')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call Rider Test' })).toHaveAttribute('href', 'tel:+94771234567');
    const bag = screen.getByRole('region', { name: 'In the bag' });
    expect(within(bag).getByText('Kotmale Fresh Milk 1L')).toBeInTheDocument();
    expect(within(bag).getByText('2 ×')).toBeInTheDocument();
    expect(screen.getByText('Rs. 610')).toBeInTheDocument();
    expect(within(actionBar()).getAllByRole('button')).toHaveLength(1);
    expect(within(actionBar()).getByRole('button', { name: 'Picked up' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Progress' })).toHaveTextContent('Pick up');
  });

  it('never renders coordinates, costs or supplier details even if the API sent them - including once tracking is actively sharing', async () => {
    // The trackable window (plan §2.3) opens on pickup, and TrackingStatus
    // now legitimately renders passive sharing-state copy while it's open.
    // The guarantee this test protects is narrower than "no location UI at
    // all": the rider screen must never render the raw number, even once a
    // location genuinely is being tracked. So this drives a real pickup (via
    // the mocked plugin above) rather than just rendering a static screen,
    // to prove the guarantee holds in the state where it actually matters.
    const user = userEvent.setup();
    // These fields aren't part of DeliveryDetail (the API contract the rider
    // app types against) - built via `unknown`, like the API response
    // parsing itself, so the leak these guard against isn't type-checked
    // away before it ever reaches the render the test inspects.
    const leaked = {
      delivery_latitude: 6.4351,
      delivery_longitude: 80.0243,
      actual_unit_cost: 450,
      supplier_name: 'Hidden Supplier',
    };
    let current: unknown = { ...detail(), ...leaked };
    const { container } = renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': () => ok({ delivery: current }),
      'PATCH /riders/deliveries/:id/status': () => {
        current = { ...detail(onRoad), ...leaked };
        return ok({ delivery: current });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Picked up' }));

    // Confirm tracking is genuinely active - not just that TrackingStatus
    // failed to mount - before checking that it still leaked nothing.
    expect(await screen.findByText(/sharing your location/i)).toBeInTheDocument();

    const text = container.textContent ?? '';
    for (const leakedValue of ['6.4351', '80.0243', '450', 'Hidden Supplier', 'cost', 'supplier']) {
      expect(text).not.toContain(leakedValue);
    }
  });

  it('Picked up is sent once, even on a double tap, and the next step appears', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail());
    const { api } = renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': async () => {
        await new Promise((r) => setTimeout(r, 30));
        state.current = detail(onRoad);
        return ok({ delivery: state.current });
      },
    });
    const button = await screen.findByRole('button', { name: 'Picked up' });
    await user.dblClick(button);
    expect(await screen.findByRole('button', { name: "I've arrived" })).toBeInTheDocument();
    const sent = api.find('PATCH', '/riders/deliveries/d-1/status');
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ status: 'PICKED_UP' });
    expect(within(actionBar()).getByRole('button', { name: "Can't deliver" })).toBeInTheDocument();
  });

  it('starts tracking on pickup and stops it once the rider arrives - both terminal edges, not just one', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail());
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': (call) => {
        state.current =
          call.body.status === 'PICKED_UP' ? detail(onRoad) : detail(atDoor);
        return ok({ delivery: state.current });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Picked up' }));
    await waitFor(() => expect(capacitorTrackingPlugin.start).toHaveBeenCalledTimes(1));
    expect(capacitorTrackingPlugin.stop).not.toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: "I've arrived" }));
    await waitFor(() => expect(capacitorTrackingPlugin.stop).toHaveBeenCalledTimes(1));
  });

  it('stops tracking when a failure is reported - the other terminal edge', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail(onRoad));
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': (call) => {
        state.current = detail({
          assignment_status: 'FAILED',
          order_status: 'FAILED',
          failure_reason: call.body.failure_reason,
        });
        return ok({ delivery: state.current });
      },
    });
    await user.click(await screen.findByRole('button', { name: "Can't deliver" }));
    await user.type(screen.getByLabelText('What happened?'), 'Gate locked, no answer');
    await user.click(screen.getByRole('button', { name: "Mark as couldn't deliver" }));
    expect(await screen.findByText("Couldn't deliver")).toBeInTheDocument();
    // No pickup happened in this test, so tracker.start() was never called -
    // stop() firing here is Delivery.tsx's own fail-path wiring, not
    // incidental to some earlier start.
    expect(capacitorTrackingPlugin.start).not.toHaveBeenCalled();
    await waitFor(() => expect(capacitorTrackingPlugin.stop).toHaveBeenCalledTimes(1));
  });

  it('collecting cash is confirmed in a sheet that restates the amount, and sends the fetched total', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail({ ...atDoor, total_amount: 1690 }));
    const { api } = renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'POST /riders/deliveries/:id/collect-cod': () => {
        state.current = detail({
          assignment_status: 'DELIVERED',
          order_status: 'DELIVERED',
          payment_status: 'PAID',
          total_amount: 1690,
          cod_collected_amount: 1690,
          delivered_at: '2026-09-18T09:30:00.000Z',
        });
        return ok({ settlement: { order_status: 'DELIVERED', payment_status: 'PAID', cod_collected_amount: 1690 } });
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Collect Rs. 1,690' }));
    const sheet = screen.getByRole('dialog', { name: 'Collect Rs. 1,690 in cash' });
    expect(sheet).toHaveTextContent('from Rider Test');
    expect(api.find('POST', '/riders/deliveries/d-1/collect-cod')).toHaveLength(0);
    await user.click(within(sheet).getByRole('button', { name: 'Cash collected — complete' }));
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Rs. 1,690 collected')).toBeInTheDocument();
    expect(api.find('POST', '/riders/deliveries/d-1/collect-cod')[0].body).toEqual({ amount: 1690 });
    expect(screen.queryByRole('group', { name: 'Delivery actions' })).not.toBeInTheDocument();
  });

  it('the confirm sheet can be dismissed without sending anything', async () => {
    const user = userEvent.setup();
    const { api } = renderAs(RIDER, ROUTE, { 'GET /riders/deliveries/:id': () => ok({ delivery: detail(atDoor) }) });
    await user.click(await screen.findByRole('button', { name: 'Collect Rs. 610' }));
    await user.click(screen.getByRole('button', { name: 'Not yet' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Collect Rs. 610' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.find('POST', '/riders/deliveries/d-1/collect-cod')).toHaveLength(0);
  });

  it("Can't deliver needs a reason and sends it", async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail(onRoad));
    const { api } = renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': (call) => {
        state.current = detail({
          assignment_status: 'FAILED',
          order_status: 'FAILED',
          failure_reason: call.body.failure_reason,
        });
        return ok({ delivery: state.current });
      },
    });
    await user.click(await screen.findByRole('button', { name: "Can't deliver" }));
    const sheet = screen.getByRole('dialog', { name: "Can't deliver this order" });
    const submit = within(sheet).getByRole('button', { name: "Mark as couldn't deliver" });
    expect(submit).toBeDisabled();
    await user.type(within(sheet).getByLabelText('What happened?'), '   ');
    expect(submit).toBeDisabled();
    await user.type(within(sheet).getByLabelText('What happened?'), 'Gate locked, no answer');
    await user.click(submit);
    expect(await screen.findByText("Couldn't deliver")).toBeInTheDocument();
    expect(api.find('PATCH', '/riders/deliveries/d-1/status')[0].body).toEqual({
      status: 'FAILED',
      failure_reason: 'Gate locked, no answer',
    });
  });

  it('when the backend refuses a stale step, it shows why and the latest state', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail());
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': () => {
        state.current = detail({ order_status: 'CANCELLED' });
        return fail(409, 'ORDER_NOT_ACTIVE');
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Picked up' }));
    expect(await screen.findByText('This order was cancelled or closed. Do not deliver it.')).toBeInTheDocument();
    expect(await screen.findByText("Cancelled — don't pick up")).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Delivery actions' })).not.toBeInTheDocument();
  });

  it('on a timeout it re-reads the delivery instead of re-sending, so a step that landed is not repeated', async () => {
    const user = userEvent.setup();
    const { state, handler } = serving(detail());
    const { api } = renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': handler,
      'PATCH /riders/deliveries/:id/status': () => {
        state.current = detail(onRoad); // the server applied it; the answer never arrived
        return TIMED_OUT;
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Picked up' }));
    expect(
      await screen.findByText("The server didn't answer. Check the delivery before trying again.")
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: "I've arrived" })).toBeInTheDocument();
    expect(api.find('PATCH', '/riders/deliveries/d-1/status')).toHaveLength(1);
    expect(api.find('GET', '/riders/deliveries/d-1').length).toBeGreaterThanOrEqual(2);
  });

  it('a delivery that is no longer this rider’s returns to the list with the reason', async () => {
    renderAs(RIDER, ROUTE, { 'GET /riders/deliveries/:id': () => fail(404, 'DELIVERY_NOT_FOUND') });
    expect(await screen.findByText('This delivery is no longer assigned to you.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('No deliveries assigned to you right now.')).toBeInTheDocument());
  });

  it('a delivered order shows the settlement and no actions', async () => {
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': () =>
        ok({
          delivery: detail({
            assignment_status: 'DELIVERED',
            order_status: 'DELIVERED',
            payment_status: 'PAID',
            cod_collected_amount: 610,
            delivered_at: '2026-09-18T09:30:00.000Z',
          }),
        }),
    });
    expect(await screen.findByText('Rs. 610 collected')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Delivery actions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Call/ })).not.toBeInTheDocument();
  });

  it('an order still being packed explains the wait and offers no action', async () => {
    renderAs(RIDER, ROUTE, {
      'GET /riders/deliveries/:id': () => ok({ delivery: detail({ order_status: 'PLACED' }) }),
    });
    expect(await screen.findByText('Being packed')).toBeInTheDocument();
    expect(screen.getByText("The store hasn't packed this order yet. Wait for it before leaving.")).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Delivery actions' })).not.toBeInTheDocument();
  });
});
