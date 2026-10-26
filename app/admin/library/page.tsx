'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ShieldCheck } from 'lucide-react';
import Link from 'next/link';

interface AdminCourse {
  id: string;
  name: string;
  description?: string;
  ownerId: string;
  isPublic: boolean;
  generationComplete: boolean;
  createdAt: number;
  updatedAt: number;
  sceneCount: number;
}

interface AdminLibraryResponse {
  courses: AdminCourse[];
  total: number;
  limit: number;
  offset: number;
}

export default function AdminLibraryPage() {
  const [result, setResult] = useState<AdminLibraryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let active = true;
    void fetch(`/api/admin/library?limit=50&offset=${offset}`, { credentials: 'include' })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as
          | AdminLibraryResponse
          | { error?: { message?: string } }
          | null;
        if (!response.ok)
          throw new Error(
            body && 'error' in body ? body.error?.message : 'Unable to load admin library',
          );
        if (active) setResult(body as AdminLibraryResponse);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : 'Unable to load admin library');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [offset]);

  return (
    <main className="min-h-[100dvh] bg-background px-5 py-8 text-foreground sm:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="mb-3 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to library
            </Link>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <ShieldCheck className="size-6 text-primary" aria-hidden="true" />
              Admin course library
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All live courses stored in the deployment database.
            </p>
          </div>
          {result && <p className="text-sm text-muted-foreground">{result.total} courses</p>}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading courses…
          </div>
        ) : error ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
            role="alert"
          >
            {error}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/70">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-start text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Course</th>
                    <th className="px-4 py-3 font-medium">Owner</th>
                    <th className="px-4 py-3 font-medium">Scenes</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {result?.courses.map((course) => (
                    <tr key={course.id} className="hover:bg-muted/30">
                      <td className="px-4 py-3">
                        <p className="font-medium">{course.name}</p>
                        <p className="mt-1 max-w-md truncate text-xs text-muted-foreground">
                          {course.id}
                        </p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {course.ownerId}
                      </td>
                      <td className="px-4 py-3">{course.sceneCount}</td>
                      <td className="px-4 py-3">
                        {course.generationComplete ? 'Complete' : 'In progress'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(course.updatedAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                  {result?.courses.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                        No courses found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-3 text-sm">
              <span className="text-muted-foreground">
                Showing {(result?.offset ?? 0) + 1}–
                {Math.min(
                  (result?.offset ?? 0) + (result?.courses.length ?? 0),
                  result?.total ?? 0,
                )}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={offset === 0}
                  onClick={() => {
                    setLoading(true);
                    setOffset(Math.max(0, offset - 50));
                  }}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!result || offset + result.limit >= result.total}
                  onClick={() => {
                    setLoading(true);
                    setOffset(offset + 50);
                  }}
                  className="rounded-lg border px-3 py-1.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
