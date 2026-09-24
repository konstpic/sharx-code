"use client";

import { Globe, KeyRound, Lock, User } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { postJson } from "@/lib/api";
import { changeLanguage, panelSelectLangValue, supported } from "@/lib/i18n";
import { easeStandard, durations } from "@/lib/motion";
import { parsePanelTheme, applyPanelTheme } from "@/lib/panelTheme";
import { p } from "@/lib/paths";
import { usePublicAppMeta } from "@/lib/usePublicAppMeta";
import { Button, Input, SelectNative, Spinner, useToast } from "@/components/ui";
import { PanelHeaderAppMeta, PanelTelegramNavLink, Surface } from "@/components/panel";

export default function LoginPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [form, setForm] = useState({ username: "", password: "", twoFactorCode: "" });
  const [ready, setReady] = useState(false);
  const [awaiting2FA, setAwaiting2FA] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const publicMeta = usePublicAppMeta();
  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    setAwaiting2FA(false);
    setResendIn(0);
  }, [form.username, form.password]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = window.setTimeout(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => window.clearTimeout(id);
  }, [resendIn]);

  useEffect(() => {
    const theme = parsePanelTheme(publicMeta?.panelTheme);
    applyPanelTheme(theme);
  }, [publicMeta?.panelTheme]);

  const submitLogin = async (resend: boolean) => {
    setLoading(true);
    try {
      const v = { ...form, twoFactorCode: resend ? "" : form.twoFactorCode };
      const res = await postJson(p("login"), v);
      if (res.success) {
        toast.success(res.msg || t("pages.login.toasts.successLogin"));
        if (typeof window !== "undefined") {
          sessionStorage.setItem("showWhatsNew", "true");
          window.location.href = p("panel/");
        }
        return;
      }
      const obj = res.obj as
        | { needTwoFactor?: boolean; telegramSent?: boolean; resendIn?: number }
        | undefined;
      if (obj?.needTwoFactor) {
        if (obj.telegramSent) {
          toast.success(t("pages.login.toasts.twoFactorTelegramSent"));
        } else if (typeof obj.resendIn === "number") {
          toast.info(
            t("pages.login.toasts.twoFactorResendWait", {
              defaultValue: "A code was already sent. You can request a new one in {{seconds}} s.",
              seconds: obj.resendIn,
            }),
          );
        } else {
          toast.info(res.msg || t("pages.login.toasts.needTwoFactor"));
        }
        if (typeof obj.resendIn === "number") setResendIn(obj.resendIn);
        setAwaiting2FA(true);
        return;
      }
      toast.error(res.msg || t("pages.login.toasts.wrongUsernameOrPassword"));
    } catch {
      toast.error(t("fail"));
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (awaiting2FA && !form.twoFactorCode.trim()) {
      toast.error(t("pages.login.toasts.needTwoFactor"));
      return;
    }
    await submitLogin(false);
  };

  if (!ready) {
    return (
      <div
        className="relative grid min-h-dvh place-items-center overflow-hidden"
        style={{ color: "var(--fg)" }}
      >
        <div className="login-backdrop" aria-hidden />
        <div className="relative z-10">
          <Spinner size={40} />
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden"
      style={{ color: "var(--fg)" }}
    >
      <div className="login-backdrop" aria-hidden />
      <header className="panel-navbar relative z-10 overflow-visible">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="panel-navbar-brand min-w-0">
            <span className="font-heading block text-base font-bold tracking-[-0.5px] text-[var(--panel-chrome-fg)]">SharX</span>
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-[var(--panel-chrome-fg-muted)]">
              Panel
            </span>
          </div>
          <div className="flex min-w-0 max-w-full flex-1 items-center justify-end gap-2 sm:max-w-none sm:flex-initial sm:gap-3">
            <PanelTelegramNavLink />
            <PanelHeaderAppMeta variant="login" />
            <div className="flex min-w-0 max-w-[11rem] items-center gap-1.5 sm:max-w-[14rem] sm:gap-2">
              <Globe
                className="size-4 shrink-0 text-[var(--panel-chrome-fg-muted)]"
                aria-hidden
                strokeWidth={1.75}
              />
              <label htmlFor="login-lang" className="sr-only">
                {t("pages.settings.language")}
              </label>
              <SelectNative
                id="login-lang"
                className="min-w-0 flex-1"
                value={panelSelectLangValue()}
                onChange={async (e) => {
                  await changeLanguage(e.target.value);
                }}
                aria-label={t("pages.settings.language")}
              >
                {supported.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.label}
                  </option>
                ))}
              </SelectNative>
            </div>
          </div>
        </div>
      </header>
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 pb-20 sm:px-6 lg:px-8">
        <motion.div
          className="w-full max-w-md"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: durations.slow,
            ease: easeStandard,
          }}
        >
          <motion.h1
            className={`font-login-welcome mb-2 text-center leading-[1.08] text-balance ${reduceMotion ? "text-[var(--fg)]" : ""}`}
            style={{ fontSize: "clamp(1.75rem, 1rem + 2.8vw, 2.75rem)" }}
            initial={reduceMotion ? false : { opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={reduceMotion ? { opacity: 1, y: 0, filter: "blur(0px)" } : { opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: durations.slow, delay: 0.04, ease: easeStandard }}
          >
            {reduceMotion ? (
              t("pages.login.hello")
            ) : (
              <motion.span
                className="inline-block bg-clip-text text-transparent [background-size:200%_100%] [background-image:linear-gradient(105deg,var(--fg)_0%,color-mix(in_oklab,var(--accent)_26%,var(--fg))_45%,var(--fg)_100%)]"
                initial={{ backgroundPosition: "0% 50%" }}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%"] }}
                transition={{
                  backgroundPosition: {
                    duration: 6.5,
                    ease: "easeInOut",
                    repeat: Number.POSITIVE_INFINITY,
                    repeatType: "reverse",
                    delay: 0.5,
                  },
                }}
              >
                {t("pages.login.hello")}
              </motion.span>
            )}
          </motion.h1>
          <p
            className="mb-8 text-center text-[var(--fg-muted)] text-balance"
            style={{ fontSize: "clamp(0.875rem, 0.8rem + 0.35vw, 0.9375rem)" }}
          >
            SharX Panel
          </p>
          <Surface>
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {!awaiting2FA ? (
                <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="u">
                  {t("username")}
                </label>
                <div className="relative">
                  <User
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]"
                    aria-hidden
                  />
                  <Input
                    id="u"
                    name="username"
                    autoComplete="username"
                    inputSize="lg"
                    className="!pl-10"
                    placeholder={t("username")}
                    value={form.username}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="p">
                  {t("password")}
                </label>
                <div className="relative">
                  <Lock
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]"
                    aria-hidden
                  />
                  <Input
                    id="p"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    inputSize="lg"
                    className="!pl-10"
                    placeholder={t("password")}
                    value={form.password}
                    onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                    required
                  />
                </div>
              </div>
                </>
              ) : null}
              {awaiting2FA ? (
                <motion.div
                  className="flex flex-col gap-4"
                  initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: durations.base, ease: easeStandard }}
                >
                  <p className="text-center text-sm text-[var(--fg-muted)] text-balance">
                    {t("pages.login.twoFactorStepHint", {
                      defaultValue: "Enter the code to finish signing in.",
                    })}
                  </p>
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[var(--fg-muted)]" htmlFor="t">
                      {t("twoFactorCode")}
                    </label>
                    <div className="relative">
                      <KeyRound
                        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--fg-subtle)]"
                        aria-hidden
                      />
                      <Input
                        id="t"
                        name="twoFactorCode"
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        autoFocus
                        inputSize="lg"
                        className="!pl-10"
                        placeholder={t("twoFactorCode")}
                        value={form.twoFactorCode}
                        onChange={(e) => setForm((f) => ({ ...f, twoFactorCode: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs">
                    <button
                      type="button"
                      className="text-[var(--fg-muted)] hover:text-[var(--fg)]"
                      onClick={() => {
                        setAwaiting2FA(false);
                        setResendIn(0);
                        setForm((f) => ({ ...f, twoFactorCode: "" }));
                      }}
                    >
                      {t("back")}
                    </button>
                    <button
                      type="button"
                      className="text-[var(--accent)] disabled:cursor-not-allowed disabled:text-[var(--fg-subtle)]"
                      disabled={loading || resendIn > 0}
                      onClick={() => void submitLogin(true)}
                    >
                      {resendIn > 0
                        ? t("pages.login.resendCodeIn", {
                            defaultValue: "Resend code in {{seconds}} s",
                            seconds: resendIn,
                          })
                        : t("pages.login.resendCode", { defaultValue: "Resend code" })}
                    </button>
                  </div>
                </motion.div>
              ) : null}
              <Button
                type="submit"
                variant="primary"
                className="!mt-2 w-full !py-3"
                loading={loading}
              >
                {awaiting2FA ? t("confirm") : t("login")}
              </Button>
            </form>
          </Surface>
        </motion.div>
      </div>
    </div>
  );
}
