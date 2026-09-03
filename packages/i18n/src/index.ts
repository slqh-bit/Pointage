/**
 * Point d'entrée i18n — FR / AR (RTL) / EN (Plan §01, §03).
 *
 * Règle RTL (§01) : direction gérée au niveau du document via `dir`,
 * styles en propriétés CSS logiques (margin-inline-start, pas margin-left).
 */
import { fr, type Messages } from "./fr/index.js";
import { ar } from "./ar/index.js";
import { en } from "./en/index.js";

export const locales = { fr, ar, en } as const;
export type LocaleCode = keyof typeof locales;
export const defaultLocale: LocaleCode = "fr";

export function isRtl(locale: LocaleCode): boolean {
  return locale === "ar";
}

export function dir(locale: LocaleCode): "ltr" | "rtl" {
  return isRtl(locale) ? "rtl" : "ltr";
}

export type { Messages };
export { fr, ar, en };
