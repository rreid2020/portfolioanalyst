import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { getUser, touchUser } from "@/lib/portfolios";

// Asking Clerk for the profile is a network call; the users row answers on every other page view.
const PROFILE_REFRESH_MS = 12 * 60 * 60 * 1000;

/** The signed-in Clerk user id; signed-out visitors go to /sign-in. Saved portfolios hang off this id. */
export const requireUser = cache(async (): Promise<string> => {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
});

/**
 * requireUser, with the email and name to show. They come from the users row; Clerk is asked (and the
 * row created or refreshed) only on a first visit or when the row is more than 12 hours old.
 */
export const requireUserProfile = cache(async () => {
  const userId = await requireUser();
  const row = await getUser(userId);
  if (row && Date.now() - Date.parse(row.lastSeenAt) < PROFILE_REFRESH_MS) return { userId, email: row.email, name: row.name };
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
  await touchUser(userId, email, name);
  return { userId, email, name };
});
