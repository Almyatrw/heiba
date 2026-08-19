import { useState } from "react";
import { Redirect } from "wouter";
import { apiErrorMessage, useAuth } from "@/lib/auth";
import { useI18n, useT } from "@/lib/i18n";
import { Button, ErrorBox, Field, Input } from "@/components/ui";

export default function LoginPage() {
  const { user, isLoading, login } = useAuth();
  const t = useT();
  const { locale, setLocale } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isLoading && user) return <Redirect to="/" />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login({ email, password });
    } catch (err) {
      setError(apiErrorMessage(err, t("login.failed")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-glow flex min-h-full items-center justify-center p-6">
      <button
        onClick={() => setLocale(locale === "ar" ? "en" : "ar")}
        className="fixed end-4 top-4 rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-xs text-muted transition-colors hover:text-bone"
      >
        {t("common.language")}
      </button>
      <div className="rise w-full max-w-md">
        <div className="mb-10 text-center">
          <div className="flicker-in font-display text-6xl font-semibold tracking-tight text-bone">
            Heiba
          </div>
          <div className="mt-2 font-mono text-[11px] tracking-[0.4em] text-ember uppercase">
            {t("brand.room")}
          </div>
          <div className="mx-auto mt-6 h-px w-24 bg-gradient-to-r from-transparent via-ember/60 to-transparent" />
        </div>
        <form
          onSubmit={submit}
          className="space-y-5 rounded-2xl border border-line bg-panel/80 p-8 shadow-2xl backdrop-blur"
        >
          <Field label={t("login.email")}>
            <Input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              dir="ltr"
            />
          </Field>
          <Field label={t("login.password")}>
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              dir="ltr"
            />
          </Field>
          {error ? <ErrorBox message={error} /> : null}
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? t("login.entering") : t("login.enter")}
          </Button>
          <p className="text-center text-xs text-muted">
            {t("login.inviteOnly")}
          </p>
        </form>
      </div>
    </div>
  );
}
