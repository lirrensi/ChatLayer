import { createI18n } from "vue-i18n";

// Import all locale files
// To add a new language: create a new JSON file in src/locales/ (e.g., de.json)
// The system will automatically pick it up on next build
import en from "./locales/en.json";
import ru from "./locales/ru.json";
import zh from "./locales/zh.json";
import es from "./locales/es.json";
import fr from "./locales/fr.json";
import ar from "./locales/ar.json";
import pt from "./locales/pt.json";
import ja from "./locales/ja.json";

// Locale metadata interface
export interface LocaleMetadata {
    code: string;
    locale: string;
    langNativeName: string;
    rtl: boolean;
}

// Raw locale data with metadata
const rawLocales = {
    en,
    ru,
    zh,
    es,
    fr,
    ar,
    pt,
    ja,
} as const;

// Extract supported locale codes
export type SupportedLocale = keyof typeof rawLocales;

// Build messages object (without metadata for vue-i18n)
const messages: Record<SupportedLocale, Record<string, string>> = {} as any;
const localeMetadata: Record<SupportedLocale, LocaleMetadata> = {} as any;

// Process each locale to separate messages from metadata
(Object.keys(rawLocales) as SupportedLocale[]).forEach((code) => {
    const data = rawLocales[code] as any;
    
    // Store metadata
    localeMetadata[code] = {
        code,
        locale: data.locale,
        langNativeName: data.langNativeName,
        rtl: data.rtl,
    };
    
    // Build messages object (exclude metadata fields)
    const { locale, langNativeName, rtl, ...messageData } = data;
    messages[code] = messageData;
});

const STORAGE_KEY = "locale";
const RTL_STORAGE_KEY = "rtl";

/**
 * Get metadata for all available locales
 */
export function getAvailableLocales(): LocaleMetadata[] {
    return (Object.keys(localeMetadata) as SupportedLocale[]).map(
        (code) => localeMetadata[code]
    );
}

/**
 * Get metadata for a specific locale
 */
export function getLocaleMetadata(locale: SupportedLocale): LocaleMetadata {
    return localeMetadata[locale];
}

/**
 * Check if a locale requires RTL layout
 */
export function isRTLLocale(locale: SupportedLocale): boolean {
    return localeMetadata[locale]?.rtl ?? false;
}

/**
 * Apply or remove RTL direction on document
 */
export function applyRTL(isRTL: boolean): void {
    if (typeof document === "undefined") return;
    
    const html = document.documentElement;
    if (isRTL) {
        html.setAttribute("dir", "rtl");
        html.classList.add("rtl");
    } else {
        html.removeAttribute("dir");
        html.classList.remove("rtl");
    }
    
    // Persist preference
    try {
        localStorage.setItem(RTL_STORAGE_KEY, isRTL ? "1" : "0");
    } catch {}
}

/**
 * Validate if a string is a supported locale
 */
function isValidLocale(locale: string): locale is SupportedLocale {
    return locale in rawLocales;
}

/**
 * Detect default locale from storage or browser
 */
function detectDefaultLocale(): SupportedLocale {
    // Check stored preference
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved && isValidLocale(saved)) return saved;
    } catch {}
    
    // Detect from browser
    if (typeof navigator !== "undefined") {
        const lang = navigator.language || (navigator as any).userLanguage;
        if (lang) {
            // Try exact match first
            const normalized = lang.toLowerCase().split("-")[0];
            if (isValidLocale(normalized)) return normalized;
            
            // Try language family matching
            const langMap: Record<string, SupportedLocale> = {
                zh: "zh",
                es: "es",
                fr: "fr",
                ar: "ar",
                pt: "pt",
                ja: "ja",
                ru: "ru",
                en: "en",
            };
            
            for (const [prefix, code] of Object.entries(langMap)) {
                if (lang.startsWith(prefix)) return code;
            }
        }
    }
    
    return "en";
}

const defaultLocale = detectDefaultLocale();

// Apply RTL on initialization based on locale metadata
if (typeof document !== "undefined") {
    applyRTL(isRTLLocale(defaultLocale));
}

export const i18n = createI18n({
    legacy: false,
    locale: defaultLocale,
    fallbackLocale: "en",
    messages,
});

export function setLocale(locale: SupportedLocale) {
    // Update storage
    try {
        localStorage.setItem(STORAGE_KEY, locale);
    } catch {}
    
    // Update runtime locale (works with Composition API)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = i18n.global;
    if (g && typeof g.locale === "object" && "value" in g.locale) {
        g.locale.value = locale;
    } else {
        g.locale = locale;
    }
    
    // Auto-toggle RTL based on locale metadata
    applyRTL(isRTLLocale(locale));
}

export function t(key: string, params?: Record<string, unknown>) {
    return i18n.global.t(key as any, (params ?? {}) as any) as unknown as string;
}

// Re-export for convenience
export { localeMetadata };
