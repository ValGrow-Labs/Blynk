import { db } from '../../database/connection.js';
import { AppError } from '../../middleware/error.middleware.js';
import { writeAudit, type AuditActor } from '../audit/audit.writer.js';
import type { TemplateInput } from './campaigns.schema.js';
import { assertTemplateText } from './placeholders.js';

/**
 * Saved SMS texts (migration 066; owner's brother, 2026-11-03): a name plus the Sinhala, Tamil and
 * English text, picked in the compose screens. The same placeholder and length rules as any SMS text
 * apply when a template is saved. Names are unique ignoring upper/lower case.
 */

interface TemplateRow {
  id: string;
  name: string;
  message_si: string | null;
  message_ta: string | null;
  message_en: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
  created_by_name?: string | null;
}

export const templateView = (r: TemplateRow) => ({
  id: r.id,
  name: r.name,
  messages: { si: r.message_si, ta: r.message_ta, en: r.message_en },
  created_by_name: r.created_by_name ?? null,
  created_at: new Date(r.created_at).toISOString(),
  updated_at: new Date(r.updated_at).toISOString(),
});

const notFound = () => new AppError('That template was not found.', 404, 'TEMPLATE_NOT_FOUND');

function checked(input: TemplateInput) {
  if (!input.messages.si?.trim() && !input.messages.ta?.trim() && !input.messages.en?.trim()) {
    throw new AppError('Write at least one text.', 400, 'OFFER_TEXT_MISSING');
  }
  assertTemplateText(input.messages);
  return {
    name: input.name,
    message_si: input.messages.si?.trim() || null,
    message_ta: input.messages.ta?.trim() || null,
    message_en: input.messages.en?.trim() || null,
  };
}

const taken = (err: unknown) =>
  (err as { code?: string }).code === '23505' ? new AppError('A template with this name already exists.', 409, 'TEMPLATE_NAME_TAKEN') : err;

const select = () =>
  db.selectFrom('sms_templates as t').leftJoin('users as s', 's.id', 't.created_by').selectAll('t').select('s.full_name as created_by_name');

export async function listTemplates() {
  const rows = (await select().orderBy('t.name').execute()) as unknown as TemplateRow[];
  return rows.map(templateView);
}

export async function getTemplate(id: string) {
  const row = (await select().where('t.id', '=', id).executeTakeFirst()) as unknown as TemplateRow | undefined;
  if (!row) throw notFound();
  return templateView(row);
}

export async function createTemplate(actor: AuditActor, input: TemplateInput) {
  const values = checked(input);
  try {
    const id = await db.transaction().execute(async (trx) => {
      const row = await trx
        .insertInto('sms_templates')
        .values({ ...values, created_by: actor.actorId })
        .returning('id')
        .executeTakeFirstOrThrow();
      await writeAudit(trx, actor, { action: 'SMS_TEMPLATE_CREATED', entityType: 'sms_template', entityId: row.id, newValues: { name: values.name } });
      return row.id;
    });
    return await getTemplate(id);
  } catch (err) {
    throw taken(err);
  }
}

export async function updateTemplate(actor: AuditActor, id: string, input: TemplateInput) {
  const values = checked(input);
  try {
    await db.transaction().execute(async (trx) => {
      const before = await trx.selectFrom('sms_templates').selectAll().where('id', '=', id).forUpdate().executeTakeFirst();
      if (!before) throw notFound();
      await trx.updateTable('sms_templates').set({ ...values, updated_at: new Date() }).where('id', '=', id).execute();
      await writeAudit(trx, actor, {
        action: 'SMS_TEMPLATE_UPDATED',
        entityType: 'sms_template',
        entityId: id,
        oldValues: { name: before.name },
        newValues: { name: values.name },
      });
    });
  } catch (err) {
    throw taken(err);
  }
  return getTemplate(id);
}

export async function deleteTemplate(actor: AuditActor, id: string) {
  await db.transaction().execute(async (trx) => {
    const before = await trx.selectFrom('sms_templates').select(['id', 'name']).where('id', '=', id).forUpdate().executeTakeFirst();
    if (!before) throw notFound();
    await trx.deleteFrom('sms_templates').where('id', '=', id).execute();
    await writeAudit(trx, actor, { action: 'SMS_TEMPLATE_DELETED', entityType: 'sms_template', entityId: id, oldValues: { name: before.name } });
  });
}
