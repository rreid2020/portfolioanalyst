import { SignUp } from "@clerk/nextjs";
import { AuthShell, authAppearance } from "@/components/AuthShell";

export default function Page() {
  return (
    <AuthShell title="Create your Axiom account" subtitle="One account for Portfolio and the other Axiom apps.">
      <SignUp appearance={authAppearance} />
    </AuthShell>
  );
}
