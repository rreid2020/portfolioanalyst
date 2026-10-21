import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Everything needs a signed-in user except the sign-in pages and the Python API, which checks the
// Clerk session token itself (clerk_auth.py) so it can answer 401 JSON rather than a redirect.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)", "/api/py(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files
    "/((?!_next|[^?]*\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    // Clerk's auto-proxy for its frontend API
    "/__clerk/:path*",
  ],
};
