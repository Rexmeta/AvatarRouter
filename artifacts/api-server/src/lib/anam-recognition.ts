import { SessionProblem } from "./session-service";

// Provider contract: https://anam.ai/docs/personas/voices/multilingual
// Explicit Anam STT supports all of these languages (including the beta set).
// Deepgram and Cartesia Ink-2 do not support Korean. Never inherit an
// organization STT provider when an explicit input language was requested.
const languageNames: Record<string, string> = {
  english: "en", afrikaans: "af", arabic: "ar", armenian: "hy",
  azerbaijani: "az", belarusian: "be", bosnian: "bs", bulgarian: "bg",
  catalan: "ca", chinese: "zh", croatian: "hr", czech: "cs",
  danish: "da", dutch: "nl", estonian: "et", finnish: "fi",
  french: "fr", galician: "gl", german: "de", greek: "el",
  hebrew: "he", hindi: "hi", hungarian: "hu", icelandic: "is",
  indonesian: "id", italian: "it", japanese: "ja", kannada: "kn",
  kazakh: "kk", korean: "ko", latvian: "lv", lithuanian: "lt",
  macedonian: "mk", malay: "ms", maori: "mi", marathi: "mr",
  nepali: "ne", norwegian: "no", persian: "fa", polish: "pl",
  portuguese: "pt", romanian: "ro", russian: "ru", serbian: "sr",
  slovak: "sk", slovenian: "sl", spanish: "es", swahili: "sw",
  swedish: "sv", tagalog: "tl", tamil: "ta", thai: "th",
  turkish: "tr", ukrainian: "uk", urdu: "ur", vietnamese: "vi",
  welsh: "cy", bengali: "bn", cantonese: "yue", gujarati: "gu",
  hausa: "ha", lingala: "ln", maltese: "mt", occitan: "oc",
  tajik: "tg", telugu: "te",
};
const supportedCodes = new Set(Object.values(languageNames));
const aliases: Record<string, string> = {
  "한국어": "ko", "조선말": "ko", "日本語": "ja", "中文": "zh", "mandarin": "zh",
};

function normalizeLanguage(value: string) {
  const normalized = value.trim().toLowerCase();
  const named = Object.hasOwn(languageNames, normalized) ? languageNames[normalized]
    : Object.hasOwn(aliases, normalized) ? aliases[normalized] : undefined;
  if (named) return named;
  try {
    // Convert locale tags such as ko-KR / zh-Hans to Anam's ISO language code.
    const tag = normalized.replace(/_/g, "-");
    const locale = new Intl.Locale(tag);
    // Intl canonicalizes tl to fil, but Anam's documented code is tl.
    const base = tag.split("-")[0];
    const code = supportedCodes.has(base) ? base : locale.language;
    if (supportedCodes.has(code)) return code;
  } catch { /* Explicit invalid values must not fall through to org defaults. */ }
  throw new SessionProblem(400, "ANAM_UNSUPPORTED_LANGUAGE",
    "Anam requires a supported language code, locale tag or language name for input transcription.");
}

export function anamRecognitionConfig(languages?: readonly string[]) {
  // Preserve legacy organization defaults only when no language was supplied.
  if (!languages?.length) return {};
  const codes = [...new Set(languages.map(normalizeLanguage))];
  if (codes.length !== 1) {
    throw new SessionProblem(400, "ANAM_MULTIPLE_INPUT_LANGUAGES",
      "Anam input transcription requires one language per session; distinct languages cannot be selected silently.");
  }
  return { languageCode: codes[0], voiceDetectionOptions: { sttProvider: "anam" as const } };
}
