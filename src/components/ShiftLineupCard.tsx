import type { ShiftLineup } from "@/lib/types";

type Props = {
  shift: ShiftLineup;
  playerNameById: Map<string, string>;
};

export default function ShiftLineupCard({ shift, playerNameById }: Props) {
  const renderList = (ids: string[]) =>
    ids.map((id) => playerNameById.get(id) ?? "Unknown").join(", ");

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
            Quarter {shift.quarter} · Shift {shift.shiftInQuarter}
          </p>
          <h2 className="text-xl font-semibold text-slate-900">Shift {shift.shiftIndex + 1}</h2>
        </div>
        <div className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-700">
          Bench {shift.bench.length}
        </div>
      </div>

      <div className="space-y-4 text-sm text-slate-700">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Goalie</p>
            <p className="mt-2 text-base font-medium text-slate-900">
              {shift.goalie ? playerNameById.get(shift.goalie) ?? shift.goalie : "None"}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Bench</p>
            <p className="mt-2 text-base font-medium text-slate-900">
              {shift.bench.length > 0 ? renderList(shift.bench) : "Empty"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Offense</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{renderList(shift.offense) || "None"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Midfield</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{renderList(shift.midfield) || "None"}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Defense</p>
            <p className="mt-2 text-sm font-medium text-slate-900">{renderList(shift.defense) || "None"}</p>
          </div>
        </div>

        {shift.warnings.length > 0 ? (
          <div className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">Warnings</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {shift.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
