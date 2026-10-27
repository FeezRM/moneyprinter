"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending(true);
    setError(null);
    const { error } =
      mode === "signup"
        ? await authClient.signUp.email({ email, password, name: String(form.get("name")) })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Something went wrong");
      return;
    }
    router.push("/app/automations");
    router.refresh();
  }

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-24">
      <h1 className="mb-6 text-2xl font-semibold">{mode === "signup" ? "Create your account" : "Sign in"}</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "signup" && <Field name="name" label="Name" autoComplete="name" />}
        <Field name="email" label="Email" type="email" autoComplete="email" />
        <Field
          name="password"
          label="Password"
          type="password"
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          disabled={pending}
          className="mt-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {pending ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-600">
        {mode === "signup" ? (
          <>
            Have an account? <Link className="underline" href="/login">Sign in</Link>
          </>
        ) : (
          <>
            New here? <Link className="underline" href="/signup">Create an account</Link>
          </>
        )}
      </p>
    </main>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <input required className="rounded-md border border-zinc-300 px-3 py-2" {...props} />
    </label>
  );
}
