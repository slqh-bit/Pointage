/**
 * Initialisation i18next — FR / AR (RTL) / EN (Plan §01).
 * La direction du document suit la langue ; les styles utilisent des
 * propriétés CSS logiques dès le premier commit (margin-inline-start…).
 */
import { ar, dir, en, fr, type LocaleCode } from "@pointage/i18n";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

export function initI18n(locale: LocaleCode): typeof i18n {
  void i18n.use(initReactI18next).init({
    resources: {
      fr: { translation: fr },
      ar: { translation: ar },
      en: { translation: en },
    },
    lng: locale,
    fallbackLng: "fr",
    interpolation: { escapeValue: false },
  });
  document.documentElement.lang = locale;
  document.documentElement.dir = dir(locale);
  return i18n;
}

export function switchLocale(locale: LocaleCode): void {
  void i18n.changeLanguage(locale);
  document.documentElement.lang = locale;
  document.documentElement.dir = dir(locale);
}
