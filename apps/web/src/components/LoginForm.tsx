import { useState } from "react";
import { useTranslation } from "react-i18next";

/** Formulaire de connexion — appelle POST /api/v1/auth/login (module auth P1). */
export function LoginForm({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const { t } = useTranslation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error === "ACCOUNT_LOCKED" ? t("auth.accountLocked") : t("auth.loginFailed"));
        return;
      }
      const body = (await res.json()) as { accessToken: string };
      sessionStorage.setItem("accessToken", body.accessToken);
      onSuccess();
    } catch {
      setError(t("auth.loginFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100">
      <form onSubmit={(e) => void submit(e)} className="w-80 rounded-lg border bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-center text-lg font-semibold">{t("common.appName")}</h1>
        <label className="mb-1 block text-sm">{t("auth.username")}</label>
        <input
          className="mb-3 w-full rounded border px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <label className="mb-1 block text-sm">{t("auth.password")}</label>
        <input
          className="mb-4 w-full rounded border px-3 py-2"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded bg-slate-800 py-2 text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {t("auth.login")}
        </button>
      </form>
    </div>
  );
}
