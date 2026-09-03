/**
 * Coquille du portail — squelette P0/P1.
 * Le tableau de bord, le planning drag-and-drop et les grilles denses
 * (TanStack Table) arrivent en P3–P5 (Plan §11).
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LoginForm } from "./components/LoginForm.js";
import { switchLocale } from "./i18n.js";

export default function App(): JSX.Element {
  const { t } = useTranslation();
  const [loggedIn, setLoggedIn] = useState(false);

  if (!loggedIn) {
    return <LoginForm onSuccess={() => setLoggedIn(true)} />;
  }

  const navItems = ["dashboard", "presence", "planning", "absences", "anomalies", "reports", "devices", "employees", "settings"] as const;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b bg-white px-6 py-3">
        <h1 className="text-lg font-semibold">{t("common.appName")}</h1>
        <div className="flex items-center gap-2">
          {(["fr", "ar", "en"] as const).map((l) => (
            <button
              key={l}
              onClick={() => switchLocale(l)}
              className="rounded border px-2 py-1 text-xs uppercase hover:bg-slate-100"
            >
              {l}
            </button>
          ))}
        </div>
      </header>
      <div className="flex">
        <nav className="w-56 border-e bg-white p-4">
          <ul className="space-y-1">
            {navItems.map((key) => (
              <li key={key}>
                <a className="block rounded px-3 py-2 text-sm hover:bg-slate-100" href="#">
                  {t(`nav.${key}`)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="flex-1 p-6">
          <p className="text-sm text-slate-600">
            {t("common.loading")} — squelette P1 : les écrans métier arrivent en P3–P5.
          </p>
        </main>
      </div>
    </div>
  );
}
