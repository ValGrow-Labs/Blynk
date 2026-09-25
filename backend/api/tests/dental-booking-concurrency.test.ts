import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool } from '../src/database/connection.js';
import { adminToken, auth, dentalFixtures, type TestCustomer } from './helpers/dental.js';

/**
 * THE flagship proof for this feature (plan §7.4, §22): two customers, one
 * slot, exactly one confirmed appointment - never two rows, never a 500,
 * never a hang.
 *
 * Every race below is genuinely in flight at once: `Promise.all` over two
 * real supertest calls, the same mechanism tests/inventory-integrity.test.ts
 * already uses for the order-lifecycle races. Each `Promise.all` race is
 * repeated, because a single pass can land either side of the interleaving.
 *
 * The one case `SELECT ... FOR UPDATE` provably cannot cover - two brand-new
 * inserts for a slot with no row to lock yet - is additionally pinned down
 * deterministically, with a real second connection, so the 23505 backstop is
 * proven to be exercised rather than hoped for.
 */
describe('Dental booking concurrency (two customers, one slot)', () => {
  const app = createApp();
  const fx = dentalFixtures({
    idPrefix: 'b3b00002',
    namePrefix: 'B3B Concurrency',
    phoneBase: '+9474200',
  });

  const REPS = 5;

  let alice: TestCustomer;
  let bob: TestCustomer;
  let carol: TestCustomer;

  beforeAll(async () => {
    await fx.purge();
    alice = await fx.customer(1);
    bob = await fx.customer(2);
    carol = await fx.customer(3);
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  const hold = (customer: TestCustomer, clinicDoctorId: string, startAt: string) =>
    request(app)
      .post('/api/v1/dental/appointments/holds')
      .set(auth(customer.token))
      .send({ clinic_doctor_id: clinicDoctorId, start_at: startAt });

  const confirm = (customer: TestCustomer, id: string) =>
    request(app)
      .post(`/api/v1/dental/appointments/${id}/confirm`)
      .set(auth(customer.token))
      .send({ patient_name: 'Race Patient', patient_phone: '0771234567' });

  const adminCancel = (id: string) =>
    request(app)
      .post(`/api/v1/admin/dental/appointments/${id}/cancel`)
      .set(auth(adminToken))
      .send({ reason: 'Race test' });

  type Res = { status: number; body: { data?: { appointment?: { id: string } }; error?: { code: string } } };
  const noServerError = (...responses: Res[]) => responses.forEach((r) => expect(r.status).toBeLessThan(500));
  const code = (r: Res) => r.body.error?.code;

  async function repeat(times: number, fn: (attempt: number) => Promise<void>) {
    for (let i = 1; i <= times; i++) await fn(i);
  }

  // ==========================================================================
  // THE FLAGSHIP
  // ==========================================================================
  it('two customers, one slot: exactly one hold wins, exactly one confirmed appointment exists', async () => {
    const observedLoserCodes = new Set<string>();

    await repeat(REPS, async () => {
      const s = await fx.slot();
      const startAt = s.slots[0];

      // Genuinely concurrent: both requests are in flight before either resolves.
      const [first, second] = (await Promise.all([
        hold(alice, s.clinicDoctorId, startAt),
        hold(bob, s.clinicDoctorId, startAt),
      ])) as [Res, Res];

      noServerError(first, second);
      const winners = [first, second].filter((r) => r.status === 201);
      const losers = [first, second].filter((r) => r.status !== 201);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].status).toBe(409);
      // Which 409 depends on whether the loser lost at the row lock
      // (SLOT_HELD) or at the unique index (SLOT_UNAVAILABLE); both are the
      // same promise to the customer.
      expect(['SLOT_HELD', 'SLOT_UNAVAILABLE']).toContain(code(losers[0]));
      observedLoserCodes.add(code(losers[0])!);

      // The database itself, not the response codes, is the real assertion.
      expect(await fx.activeRowsForSlot(s.clinicDoctorId, startAt)).toHaveLength(1);

      // ... and the winner is the one who can actually book it.
      const winnerId = winners[0].body.data!.appointment!.id;
      const winnerIsAlice = winners[0] === first;
      const confirmed = await confirm(winnerIsAlice ? alice : bob, winnerId);
      expect(confirmed.status).toBe(200);

      const retry = await hold(winnerIsAlice ? bob : alice, s.clinicDoctorId, startAt);
      expect(retry.status).toBe(409);
      expect(code(retry as Res)).toBe('SLOT_UNAVAILABLE');

      const active = await fx.activeRowsForSlot(s.clinicDoctorId, startAt);
      expect(active).toHaveLength(1);
      expect(active[0].status).toBe('CONFIRMED');
      expect(active[0].id).toBe(winnerId);
    });

    // Measured: this race consistently loses at the unique index
    // (SLOT_UNAVAILABLE), i.e. the 23505 backstop - not the FOR UPDATE
    // pre-check - is what actually settles it. See task-B3-report.md.
    expect(observedLoserCodes.size).toBeGreaterThan(0);
  });

  // ==========================================================================
  // THE 23505 BACKSTOP - the case FOR UPDATE cannot cover
  // ==========================================================================
  it('translates a raw 23505 on uq_appointments_active_slot into a 409 (two first-time inserts, nothing to lock)', async () => {
    const s = await fx.slot();
    const startAt = s.slots[1];
    const client = await pool.connect();

    try {
      // A competing transaction that has INSERTED but not COMMITTED. Its row
      // is invisible to the API request below, so the request's
      // `SELECT ... FOR UPDATE` finds nothing to lock and has no choice but
      // to try its own INSERT - exactly the interleaving the pre-check cannot
      // protect against.
      await client.query('BEGIN');
      await client.query(
        `SELECT id FROM appointments
          WHERE clinic_doctor_id = $1 AND start_at = $2 AND status IN ('HELD','CONFIRMED')
          FOR UPDATE`,
        [s.clinicDoctorId, startAt]
      );
      await client.query(
        `INSERT INTO appointments
           (clinic_doctor_id, customer_id, start_at, end_at, status, held_by, held_until, idempotency_key)
         VALUES ($1, $2, $3, $3::timestamptz + interval '30 minutes', 'HELD', $2,
                 now() + interval '5 minutes', $4)`,
        [s.clinicDoctorId, alice.id, startAt, `b3b-backstop-${Date.now()}`]
      );

      // Starts the HTTP request now (supertest sends on .then()); it will
      // block inside its own INSERT, waiting on the unique index.
      const pending = hold(bob, s.clinicDoctorId, startAt).then((r) => r as Res);
      await new Promise((resolve) => setTimeout(resolve, 500));

      await client.query('COMMIT');

      const res = await pending;
      expect(res.status).toBe(409);
      expect(code(res)).toBe('SLOT_UNAVAILABLE');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }

    const rows = await fx.rowsForSlot(s.clinicDoctorId, startAt);
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe(alice.id);
  });

  it('two genuinely concurrent first-time holds never produce two rows, over repeated attempts', async () => {
    await repeat(REPS, async () => {
      const s = await fx.slot();
      const startAt = s.slots[2];

      const [first, second] = (await Promise.all([
        hold(bob, s.clinicDoctorId, startAt),
        hold(carol, s.clinicDoctorId, startAt),
      ])) as [Res, Res];

      noServerError(first, second);
      expect([first.status, second.status].filter((st) => st === 201)).toHaveLength(1);
      expect(await fx.rowsForSlot(s.clinicDoctorId, startAt)).toHaveLength(1);
    });
  });

  // ==========================================================================
  // RECLAIMING AN EXPIRED HOLD - the FOR UPDATE path
  // ==========================================================================
  it('two customers racing to reclaim the same expired hold: one reclaims, one gets 409 SLOT_HELD', async () => {
    await repeat(REPS, async () => {
      const s = await fx.slot();
      const startAt = s.slots[0];
      const original = await hold(alice, s.clinicDoctorId, startAt);
      expect(original.status).toBe(201);
      await fx.expireHold(original.body.data.appointment.id);

      const [first, second] = (await Promise.all([
        hold(bob, s.clinicDoctorId, startAt),
        hold(carol, s.clinicDoctorId, startAt),
      ])) as [Res, Res];

      noServerError(first, second);
      expect([first.status, second.status].filter((st) => st === 201)).toHaveLength(1);
      const loser = first.status === 201 ? second : first;
      expect(loser.status).toBe(409);
      expect(code(loser)).toBe('SLOT_HELD');

      // The reclaim reuses the original row: still exactly one, ever.
      const rows = await fx.rowsForSlot(s.clinicDoctorId, startAt);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(original.body.data.appointment.id);
      expect([bob.id, carol.id]).toContain(rows[0].customer_id);
    });
  });

  // ==========================================================================
  // CONFIRM RACES
  // ==========================================================================
  it('a non-holder racing the holder on the same held row is rejected, and only the holder confirms', async () => {
    await repeat(REPS, async () => {
      const s = await fx.slot();
      const startAt = s.slots[0];
      const held = await hold(alice, s.clinicDoctorId, startAt);
      expect(held.status).toBe(201);
      const id = held.body.data.appointment.id as string;

      const [byHolder, byStranger] = (await Promise.all([confirm(alice, id), confirm(bob, id)])) as [Res, Res];

      noServerError(byHolder, byStranger);
      expect(byHolder.status).toBe(200);
      // Identical to "no such appointment" - never a 403 that confirms the id.
      expect(byStranger.status).toBe(404);
      expect(code(byStranger)).toBe('APPOINTMENT_NOT_FOUND');

      const row = await fx.appointmentRow(id);
      expect(row.status).toBe('CONFIRMED');
      expect(row.customer_id).toBe(alice.id);
      expect(await fx.activeRowsForSlot(s.clinicDoctorId, startAt)).toHaveLength(1);
    });
  });

  it('the holder double-confirming the same row lands exactly one CONFIRMED and one 409', async () => {
    await repeat(REPS, async () => {
      const s = await fx.slot();
      const held = await hold(alice, s.clinicDoctorId, s.slots[0]);
      expect(held.status).toBe(201);
      const id = held.body.data.appointment.id as string;

      const [first, second] = (await Promise.all([confirm(alice, id), confirm(alice, id)])) as [Res, Res];

      noServerError(first, second);
      expect([first.status, second.status].filter((st) => st === 200)).toHaveLength(1);
      const loser = first.status === 200 ? second : first;
      expect(loser.status).toBe(409);
      expect(code(loser)).toBe('APPOINTMENT_NOT_HELD');

      // One HELD -> CONFIRMED transition, not two.
      const history = await fx.history(id);
      expect(history.filter((h: { new_status: string }) => h.new_status === 'CONFIRMED')).toHaveLength(1);
    });
  });

  it('confirm racing an admin cancel always settles on one terminal row, never a 500', async () => {
    await repeat(REPS, async () => {
      const s = await fx.slot();
      const held = await hold(alice, s.clinicDoctorId, s.slots[0]);
      expect(held.status).toBe(201);
      const id = held.body.data.appointment.id as string;

      const [confirmRes, cancelRes] = (await Promise.all([confirm(alice, id), adminCancel(id)])) as [Res, Res];

      noServerError(confirmRes, cancelRes);
      expect(cancelRes.status).toBe(200); // admin cancel is allowed from HELD and from CONFIRMED
      if (confirmRes.status !== 200) {
        expect(confirmRes.status).toBe(409);
        expect(code(confirmRes)).toBe('APPOINTMENT_NOT_HELD');
      }

      expect((await fx.appointmentRow(id)).status).toBe('CANCELLED_BY_CLINIC');
      // Cancelled means the slot is out of the unique index: free again.
      expect(await fx.activeRowsForSlot(s.clinicDoctorId, s.slots[0])).toHaveLength(0);
    });
  });
});
