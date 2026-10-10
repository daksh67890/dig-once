"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

type Severity = "high" | "medium" | "low";
type ConflictType = "NO_DIG_PERIOD" | "WRONG_ORDER" | "BUNDLE_OPPORTUNITY";

interface Conflict {
  project_id: number;
  title: string;
  department: string;
  type: string;
  status: string;
  start_date: string;
  end_date: string;
  distance_m: number;
  conflict_type: ConflictType;
  severity: Severity;
  message: string;
  days_saved: number | null;
}

interface CheckResult {
  valid: boolean;
  errors: string[];
  conflicts: Conflict[];
  road?: string | null;
  project_id?: number | null;
}

interface RoadOption {
  id: number;
  name: string | null;
}

const PROJECT_TYPES = [
  { value: "pipeline", label: "Water pipeline" },
  { value: "drainage", label: "Drainage" },
  { value: "cable", label: "Underground cable" },
  { value: "resurfacing", label: "Road resurfacing" },
  { value: "other", label: "Other" },
];

const severityStyle: Record<Severity, string> = {
  high: "border-delayed text-delayed",
  medium: "border-ongoing text-ongoing",
  low: "border-planned text-planned",
};

const conflictLabel: Record<ConflictType, string> = {
  NO_DIG_PERIOD: "No-dig period",
  WRONG_ORDER: "Wrong work order",
  BUNDLE_OPPORTUNITY: "Bundle opportunity",
};

const emptyForm = {
  title: "",
  type: "pipeline",
  department: "",
  contractor: "",
  budget: "",
  start_date: "",
  end_date: "",
  road_id: "",
};
type FormState = typeof emptyForm;

function buildPayload(f: FormState, preview: boolean) {
  return {
    title: f.title.trim() || (preview ? "Preview" : ""),
    type: f.type,
    department: f.department.trim() || (preview ? "Preview" : ""),
    contractor: f.contractor.trim() || null,
    budget: f.budget,
    start_date: f.start_date,
    end_date: f.end_date,
    road_id: f.road_id,
    status: "planned",
  };
}

export default function DepartmentPage() {
  const [form, setForm] = useState<FormState>(emptyForm);
  const [roads, setRoads] = useState<RoadOption[]>([]);
  const [roadsError, setRoadsError] = useState("");
  const [checked, setChecked] = useState<{ key: string; result: CheckResult } | null>(null);
  const [checkError, setCheckError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string[]>([]);
  const [successId, setSuccessId] = useState<number | null>(null);

  // load roads for the dropdown, and prefill the department from the profile if logged in
  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.from("roads").select("id,name").order("name");
      if (error) setRoadsError("Could not load roads: " + error.message);
      else setRoads((data ?? []) as RoadOption[]);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("department_name")
          .eq("id", user.id)
          .single();
        const dept = profile?.department_name as string | null | undefined;
        if (dept) setForm((f) => (f.department ? f : { ...f, department: dept }));
      }
    }
    load();
  }, []);

  // everything the conflict check depends on, as one key
  const ready = form.road_id !== "" && form.start_date !== "" && form.end_date !== "";
  const key = JSON.stringify([form.road_id, form.type, form.start_date, form.end_date, form.title, form.department]);

  // live conflict check, debounced; result is only shown if it matches the current inputs
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(async () => {
      const { data, error } = await supabase.rpc("submit_project", {
        p: buildPayload(form, true),
        p_commit: false,
      });
      if (error) {
        setCheckError("Conflict check failed: " + error.message);
        return;
      }
      setCheckError("");
      setChecked({ key, result: data as CheckResult });
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready]);

  const result = ready && checked && checked.key === key ? checked.result : null;
  const checking = ready && !result && !checkError;
  const conflicts = result?.conflicts ?? [];
  const hasHigh = conflicts.some((c) => c.severity === "high");
  const canSubmit =
    !submitting &&
    form.title.trim() !== "" &&
    form.department.trim() !== "" &&
    ready &&
    (result?.valid ?? false);

  function update<K extends keyof FormState>(name: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [name]: value }));
    setSuccessId(null);
    setSubmitError([]);
  }

  async function submit() {
    setSubmitting(true);
    setSubmitError([]);
    const { data, error } = await supabase.rpc("submit_project", {
      p: buildPayload(form, false),
      p_commit: true,
    });
    setSubmitting(false);
    if (error) {
      setSubmitError([error.message]);
      return;
    }
    const res = data as CheckResult;
    if (!res.valid) {
      setSubmitError(res.errors);
      return;
    }
    setSuccessId(res.project_id ?? null);
    setForm((f) => ({ ...emptyForm, department: f.department }));
    setChecked(null);
  }

  const input = "mt-1 block w-full rounded-sm border border-line bg-white px-2 py-2";

  return (
    <main className="mx-auto max-w-6xl p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-4xl font-bold">Submit a public works project</h1>
          <p className="mb-4 text-sm text-muted">
            Conflicts with nearby planned and past work appear as you fill in the form, before anything is
            dug.
          </p>
        </div>
        <Link href="/department/manage" className="mb-4 border border-line px-3 py-2 text-sm">
          Manage my projects
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 border border-line bg-white p-4">
          <label className="block text-sm">
            Project title
            <input
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
              placeholder="e.g. New water main"
              className={input}
            />
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Type of work
              <select value={form.type} onChange={(e) => update("type", e.target.value)} className={input}>
                {PROJECT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              Department
              <input
                value={form.department}
                onChange={(e) => update("department", e.target.value)}
                placeholder="e.g. Water Supply Board"
                className={input}
              />
            </label>
          </div>

          <label className="block text-sm">
            Road
            <select value={form.road_id} onChange={(e) => update("road_id", e.target.value)} className={input}>
              <option value="">Select a road</option>
              {roads.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name ?? `Road ${r.id}`}
                </option>
              ))}
            </select>
          </label>
          {roadsError && <p className="text-sm text-delayed">{roadsError}</p>}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Start date
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => update("start_date", e.target.value)}
                className={input}
              />
            </label>
            <label className="block text-sm">
              End date
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => update("end_date", e.target.value)}
                className={input}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              Contractor (optional)
              <input
                value={form.contractor}
                onChange={(e) => update("contractor", e.target.value)}
                className={input}
              />
            </label>
            <label className="block text-sm">
              Budget in rupees (optional)
              <input
                type="number"
                min={0}
                value={form.budget}
                onChange={(e) => update("budget", e.target.value)}
                className={input}
              />
            </label>
          </div>

          {submitError.length > 0 && (
            <ul className="border-l-4 border-delayed px-3 py-2 text-sm text-delayed">
              {submitError.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {successId !== null && (
            <p className="border-l-4 border-done px-3 py-2 text-sm text-done">
              Project submitted (#{successId}). <Link href="/map" className="underline">View on the map</Link>
            </p>
          )}

          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-sm bg-ink px-4 py-2 text-white disabled:opacity-50"
          >
            {submitting ? "Submitting..." : hasHigh ? "Submit anyway" : "Submit project"}
          </button>
        </section>

        <section>
          <h2 className="mb-2 font-display text-2xl font-semibold">Conflict check</h2>
          {!ready && (
            <p className="border border-line bg-white p-4 text-sm text-muted">
              Choose a road and dates to check for conflicts with other projects within 50 metres.
            </p>
          )}
          {checking && <p className="border border-line bg-white p-4 text-sm text-muted">Checking nearby projects...</p>}
          {checkError && <p className="border-l-4 border-delayed bg-white px-3 py-2 text-sm text-delayed">{checkError}</p>}

          {result && !result.valid && (
            <ul className="space-y-1 border-l-4 border-hazard bg-white px-3 py-2 text-sm">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}

          {result && result.valid && conflicts.length === 0 && (
            <p className="border-l-4 border-done bg-white px-3 py-2 text-sm text-done">
              No conflicts found{result.road ? ` on ${result.road}` : ""}. This work can go ahead as planned.
            </p>
          )}

          {result && result.valid && conflicts.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                {conflicts.length} conflict{conflicts.length === 1 ? "" : "s"} found
                {result.road ? ` on ${result.road}` : ""}.
              </p>
              <ul className="space-y-2">
                {conflicts.map((c) => (
                  <li key={`${c.project_id}-${c.conflict_type}`} className="border border-line bg-white p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium">{conflictLabel[c.conflict_type]}</span>
                      <span className={`border px-2 text-xs uppercase ${severityStyle[c.severity]}`}>
                        {c.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{c.message}</p>
                    <p className="mt-1 text-xs text-muted">
                      {c.title} ({c.department}), {c.start_date} to {c.end_date}, {c.status}
                      {c.days_saved ? `, bundling could save about ${c.days_saved} days` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
