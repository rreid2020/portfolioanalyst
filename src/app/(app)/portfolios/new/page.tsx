import { PageHeader } from "@/components/ui";
import { HoldingsEditor } from "../HoldingsEditor";

export default function NewPortfolioPage() {
  return (
    <>
      <PageHeader title="New portfolio" subtitle="Add your holdings by hand, paste them from a spreadsheet, or import your broker's export." back={{ href: "/portfolios", label: "Portfolios" }} />
      <HoldingsEditor />
    </>
  );
}
