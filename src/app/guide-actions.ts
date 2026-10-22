"use server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { requireUser } from "@/lib/user";
import { GUIDE_STEPS } from "@/lib/guide";
import { currentPeriod } from "@/lib/guide-facts";

function stepAndPeriod(form: FormData) {
  const step = GUIDE_STEPS.find((d) => d.key === String(form.get("step") ?? ""));
  if (!step) throw new Error("Unknown guide step.");
  return { step, period: step.monthly ? currentPeriod(new Date()).period : "setup" };
}

/** Marks a guide step done (confirmation) or skipped (not needed). Only optional or monthly steps can be skipped. */
export async function markGuideStep(form: FormData) {
  const userId = await requireUser();
  const { step, period } = stepAndPeriod(form);
  const status = String(form.get("status")) === "SKIPPED" ? "SKIPPED" : "DONE";
  if (status === "SKIPPED" && !step.optional && !step.monthly) throw new Error("This step can't be skipped.");
  if (status === "DONE" && !step.confirmable) throw new Error("This step completes itself when its checklist is done.");
  const at = new Date().toISOString();
  await db.insert(s.guideMarks).values({ userId, stepKey: step.key, period, status, at })
    .onConflictDoUpdate({ target: [s.guideMarks.userId, s.guideMarks.stepKey, s.guideMarks.period], set: { status, at } });
  revalidatePath("/", "layout");
}

export async function clearGuideStep(form: FormData) {
  const userId = await requireUser();
  const { step, period } = stepAndPeriod(form);
  await db.delete(s.guideMarks).where(and(eq(s.guideMarks.userId, userId), eq(s.guideMarks.stepKey, step.key), eq(s.guideMarks.period, period)));
  revalidatePath("/", "layout");
}
