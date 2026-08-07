import type { Prisma } from '@prisma/client';
import type { PlanCreate, PlanTemplateItem, PlanUpdate } from '@overload/shared';
import { prisma } from '../lib/prisma.js';

export const planInclude = { days: { orderBy: { dayIndex: 'asc' } } } satisfies Prisma.PlanInclude;
export type PlanFull = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

export function serializePlan(p: PlanFull) {
  return {
    id: p.id,
    name: p.name,
    status: p.status,
    startDate: p.startDate.toISOString().slice(0, 10),
    weeks: p.weeks,
    daysPerWeek: p.daysPerWeek,
    deloadWeeks: JSON.parse(p.deloadWeeks) as number[],
    notes: p.notes,
    createdBy: p.createdBy,
    days: p.days.map((d) => ({
      id: d.id,
      dayIndex: d.dayIndex,
      name: d.name,
      mode: d.mode,
      weekday: d.weekday,
      targetMuscles: JSON.parse(d.targetMuscles) as string[],
      template: JSON.parse(d.template) as PlanTemplateItem[],
    })),
  };
}

function dayData(d: PlanCreate['days'][number]) {
  return {
    dayIndex: d.dayIndex,
    name: d.name,
    mode: d.mode ?? null,
    weekday: d.weekday ?? null,
    targetMuscles: JSON.stringify(d.targetMuscles),
    template: JSON.stringify(d.template),
  };
}

export async function validateTemplateExercises(days: PlanCreate['days']): Promise<string[] | null> {
  const ids = [...new Set(days.flatMap((d) => d.template.map((t) => t.exerciseId)))];
  if (!ids.length) return null;
  const found = await prisma.exercise.findMany({ where: { id: { in: ids } }, select: { id: true } });
  const missing = ids.filter((id) => !found.some((f) => f.id === id));
  return missing.length ? missing : null;
}

export async function createPlanForUser(
  userId: string,
  body: PlanCreate,
  createdBy: string,
): Promise<PlanFull> {
  // A new active plan archives the previous active one.
  await prisma.plan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } });
  return prisma.plan.create({
    data: {
      userId,
      name: body.name,
      weeks: body.weeks,
      daysPerWeek: body.daysPerWeek,
      deloadWeeks: JSON.stringify(body.deloadWeeks),
      startDate: body.startDate ? new Date(body.startDate) : new Date(),
      notes: body.notes ?? null,
      createdBy,
      days: { create: body.days.map(dayData) },
    },
    include: planInclude,
  });
}

/**
 * Partial update: omitted fields stay unchanged. When `days` is present it
 * defines the new day list, but days are matched by dayIndex so unchanged
 * indexes keep their database identity (ids referenced elsewhere survive).
 */
export async function updatePlanForUser(userId: string, id: string, body: PlanUpdate): Promise<PlanFull | null> {
  const existing = await prisma.plan.findFirst({ where: { id, userId } });
  if (!existing) return null;

  if (body.status === 'active' && existing.status !== 'active') {
    await prisma.plan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } });
  }

  await prisma.plan.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.weeks !== undefined ? { weeks: body.weeks } : {}),
      ...(body.daysPerWeek !== undefined ? { daysPerWeek: body.daysPerWeek } : {}),
      ...(body.deloadWeeks !== undefined ? { deloadWeeks: JSON.stringify(body.deloadWeeks) } : {}),
      ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    },
  });

  if (body.days !== undefined) {
    const keepIndexes = body.days.map((d) => d.dayIndex);
    await prisma.planDay.deleteMany({ where: { planId: id, dayIndex: { notIn: keepIndexes } } });
    for (const d of body.days) {
      const data = dayData(d);
      await prisma.planDay.upsert({
        where: { planId_dayIndex: { planId: id, dayIndex: d.dayIndex } },
        update: data,
        create: { planId: id, ...data },
      });
    }
  }

  return prisma.plan.findUniqueOrThrow({ where: { id }, include: planInclude });
}
