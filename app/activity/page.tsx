import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getActivityComplianceRows } from "@/lib/activity-compliance";
import { SESSION_COOKIE_NAME } from "@/lib/auth";
import { canViewAdminSections } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

function yesterdayDisplay(count: number) {
  if (count === 0) {
    return <span className="text-red-600">❌ No</span>;
  }
  if (count === 1) {
    return <span className="text-amber-600">⚠️</span>;
  }
  return <span className="text-green-700">✅</span>;
}

function weeklyActiveClass(days: number) {
  if (days <= 2) return "text-red-600";
  if (days <= 5) return "text-amber-600";
  return "text-green-700";
}

function lastActivityLabel(at: Date | null): string {
  if (!at) return "—";
  const diffMs = at.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return rtf.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 48) return rtf.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 14) return rtf.format(diffDay, "day");
  return at.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function ActivityPage() {
  const cookieStore = await cookies();
  const sessionUserId = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const user = sessionUserId
    ? await prisma.user.findUnique({
      where: { id: sessionUserId },
      select: { id: true, role: true },
    })
    : null;

  if (!canViewAdminSections(user?.role)) {
    redirect("/");
  }

  const rows = await getActivityComplianceRows({
    viewer: { id: user!.id, role: user!.role },
  });

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center gap-4 text-sm">
        <Link href="/" className="underline">
          Back to deals
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">Yesterday Activity Compliance</h1>
      <p className="text-sm text-gray-600">
        Dates use IST (Asia/Kolkata). Logs are counted per manager/rep via deal ownership.
      </p>

      <div className="overflow-x-auto border rounded-lg">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left p-3 font-medium">User Name</th>
              <th className="text-left p-3 font-medium">Yesterday</th>
              <th className="text-left p-3 font-medium">Last Activity</th>
              <th className="text-left p-3 font-medium">Count</th>
              <th className="text-left p-3 font-medium">7D Active Days</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId} className="border-b last:border-0">
                <td className="p-3 font-medium">{row.name}</td>
                <td className="p-3">{yesterdayDisplay(row.yesterdayCount)}</td>
                <td className="p-3">{lastActivityLabel(row.lastActivityAt)}</td>
                <td className="p-3">{row.yesterdayCount}</td>
                <td className={`p-3 font-medium ${weeklyActiveClass(row.weeklyActiveDays)}`}>
                  {row.weeklyActiveDays}
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-4 text-gray-600">
                  No users in scope.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </main>
  );
}
