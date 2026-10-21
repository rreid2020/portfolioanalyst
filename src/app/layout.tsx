import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio by Axiom",
  description: "Live prices, performance, dividends and account-by-account views of your holdings, with an AI analyst to review them.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. Grammarly) add attributes to <body> before React hydrates; ignore those only. */}
      <body className="antialiased" suppressHydrationWarning>
        <ClerkProvider
          signInFallbackRedirectUrl="/portfolios"
          signUpFallbackRedirectUrl="/portfolios"
          appearance={{ variables: { colorPrimary: "#0E7C86" } }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
