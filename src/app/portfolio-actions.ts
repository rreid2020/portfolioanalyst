"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/user";
import {
  deletePortfolio, nameTaken, PortfolioNameError, renamePortfolio, savePortfolio, updatePortfolio, validName, type Holding,
} from "@/lib/portfolios";

export type ActionState = { error?: string; ok?: string } | undefined;

// The Streamlit app's starting holdings, for a first portfolio before the editor arrives (Phase 2).
const EXAMPLE: Holding[] = [
  { ticker: "AAPL", shares: 10, avgBuyPrice: 150, currency: "USD", account: "TFSA" },
  { ticker: "MSFT", shares: 5, avgBuyPrice: 310, currency: "USD", account: "RRSP" },
  { ticker: "NVDA", shares: 4, avgBuyPrice: 420, currency: "USD", account: "Non-registered" },
];

function nameError(e: unknown): { error: string } {
  if (e instanceof PortfolioNameError) return { error: e.message };
  throw e;
}

export async function renameAction(id: number, _: ActionState, form: FormData): Promise<ActionState> {
  const userId = await requireUser();
  const name = String(form.get("name") ?? "");
  try {
    if (!(await renamePortfolio(userId, id, name))) return { error: "That portfolio no longer exists." };
  } catch (e) {
    return nameError(e);
  }
  revalidatePath("/portfolios");
  return { ok: `Renamed to "${name.trim()}".` };
}

export async function deleteAction(id: number) {
  const userId = await requireUser();
  await deletePortfolio(userId, id);
  revalidatePath("/portfolios");
  redirect("/portfolios");
}

/** Offered only while the list is empty, so it never replaces a saved portfolio. */
export async function createExampleAction() {
  const userId = await requireUser();
  const { id } = await savePortfolio(userId, "Example portfolio", EXAMPLE);
  redirect(`/portfolios/${id}`);
}

/** Save the editor's holdings as a new portfolio. Refuses a name that's taken rather than replacing it. */
export async function saveNewAction(name: string, rows: Holding[]): Promise<ActionState> {
  const userId = await requireUser();
  let id: number;
  try {
    if (await nameTaken(userId, validName(name)))
      return { error: `You already have a portfolio named "${name.trim()}". Choose another name, or open that one to edit it.` };
    ({ id } = await savePortfolio(userId, name, rows));
  } catch (e) {
    return nameError(e);
  }
  revalidatePath("/portfolios");
  redirect(`/portfolios/${id}`);
}

/** Save the editor's name and holdings over an existing portfolio. */
export async function updateAction(id: number, name: string, rows: Holding[]): Promise<ActionState> {
  const userId = await requireUser();
  try {
    if (!(await updatePortfolio(userId, id, name, rows))) return { error: "That portfolio no longer exists." };
  } catch (e) {
    return nameError(e);
  }
  revalidatePath("/portfolios");
  redirect(`/portfolios/${id}`);
}
