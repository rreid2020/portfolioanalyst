import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { touchUser } from "@/lib/portfolios";

/** The signed-in Clerk user id; signed-out visitors go to /sign-in. Saved portfolios hang off this id. */
export const requireUser = cache(async (): Promise<string> => {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  return userId;
});

/** requireUser, and keep the users row (email, name, last seen) current. Once per page render. */
export const requireUserProfile = cache(async () => {
  const userId = await requireUser();
  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
  await touchUser(userId, email, name);
  return { userId, email, name };
});
