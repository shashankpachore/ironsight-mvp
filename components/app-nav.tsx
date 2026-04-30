import Link from "next/link";
import { canViewAdminSections } from "@/lib/permissions";

type AppNavProps = {
  role: string | null | undefined;
};

export function AppNav({ role }: AppNavProps) {
  const showAdminNav = canViewAdminSections(role);

  return (
    <nav className="border-b bg-white">
      <div className="mx-auto max-w-5xl p-3 flex flex-wrap gap-4 text-sm">
        <Link href="/" className="underline">
          Deals
        </Link>
        <Link href="/accounts" className="underline">
          Accounts
        </Link>
        <Link href="/today" className="underline">
          Today
        </Link>
        <Link href="/pipeline" className="underline">
          Pipeline
        </Link>
        <Link href="/weekly-report" className="underline">
          Weekly Report
        </Link>
        <Link href="/expired" className="underline">
          Expired
        </Link>
        {showAdminNav ? (
          <>
            <Link href="/users" className="underline">
              Users
            </Link>
            <Link href="/audit" className="underline">
              Audit
            </Link>
            <Link href="/activity" className="underline">
              Activity
            </Link>
          </>
        ) : null}
        <a href="/api/export" className="underline">
          Export Data
        </a>
      </div>
    </nav>
  );
}
