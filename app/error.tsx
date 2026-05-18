"use client";

import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-3xl items-center px-4 py-8 sm:px-6 lg:px-8">
      <section className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-6">
        <h1 className="text-xl font-semibold text-rose-100">Terminal view failed</h1>
        <p className="mt-2 text-sm text-rose-200">{error.message || "An unexpected error occurred."}</p>
        <Button className="mt-5" onClick={reset} type="button" variant="secondary">
          Retry
        </Button>
      </section>
    </main>
  );
}
