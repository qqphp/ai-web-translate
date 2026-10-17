import { describe, expect, it } from "vitest";
import { getLocale, localeMessages, localeNames, setLocale, t } from "./i18n";
import { contentMessages } from "../generated/content-locales";
import { LANGUAGE_OPTIONS } from "./languages";

describe("UI locale selection", () => {
  it("supports every target language as an interface language", () => {
    expect(getLocale("zh-CN")).toBe("zh-CN");
    expect(getLocale("zh-HK")).toBe("zh-TW");
    expect(getLocale("en-US")).toBe("en");
    expect(getLocale("ja-JP")).toBe("ja");
    for (const language of LANGUAGE_OPTIONS) expect(getLocale(`${language.value}-test`)).toBe(language.value);
  });

  it("falls back to English", () => expect(getLocale("nl-NL")).toBe("en"));
  it("supports an explicit settings-page override", () => {
    setLocale("ja"); expect(t("title")).toBe("AI大模型-沉浸式翻译-免费-极简");
    setLocale("zh-CN"); expect(t("uiLanguage")).toBe("界面语言");
    setLocale("fr"); expect(t("uiLanguage")).toBe("Langue de l’interface");
    setLocale(null);
  });

  it("keeps settings and in-page messages aligned for every supported locale", () => {
    for (const language of LANGUAGE_OPTIONS) {
      const locale = language.value as keyof typeof contentMessages;
      expect(localeMessages[locale]).toBeDefined();
      expect(localeNames[locale]).toBeTruthy();
      expect(contentMessages[locale]).toBeDefined();
      expect(contentMessages[locale].completion).toContain("{count}");
      expect(contentMessages[locale].partialCompletion).toContain("{failed}");
    }
  });

  it("localizes the API guidance, credential notices, and about links in every locale", () => {
    for (const values of Object.values(localeMessages)) {
      for (const key of ["baseUrl", "baseUrlHint", "credentialPrivacy", "storeReview", "technicalBlog", "sourceCode"]) {
        expect(values[key]).toBeTruthy();
        if (values !== localeMessages.en) expect(values[key]).not.toBe(localeMessages.en[key]);
      }
      expect(values.baseUrlHint).toContain("https://api.openai.com/v1");
      expect(values.baseUrlHint).toContain("https://example.com/openai/v1");
    }
  });
});
