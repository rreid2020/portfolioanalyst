import { SignIn } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/AuthShell";

export default function Page() {
  return (
    <AuthShell title="Sign in" subtitle="Use your Axiom account to open your portfolios.">
      <SignIn appearance={authAppearance} />
    </AuthShell>
  );
}
