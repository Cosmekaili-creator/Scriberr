import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { en } from './en'
import { fr } from './fr'
import { useAuthStore } from '@/features/auth/store/authStore'

export type SupportedLanguage = 'en' | 'fr'
export const SUPPORTED: SupportedLanguage[] = ['en', 'fr']

const catalogs: Record<SupportedLanguage, typeof en> = { en, fr }

export function detectBrowserLanguage(): SupportedLanguage {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const code = lang.split('-')[0].toLowerCase() as SupportedLanguage
    if (SUPPORTED.includes(code)) return code
  }
  return 'en'
}

export const LanguageContext = createContext<{
  language: SupportedLanguage
  setLanguage: (lang: SupportedLanguage) => void
  t: (key: string) => string
}>({ language: 'en', setLanguage: () => {}, t: (k) => k })

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, _setLanguage] = useState<SupportedLanguage>(() => {
    const cached = localStorage.getItem('ascribe_language') as SupportedLanguage
    return SUPPORTED.includes(cached) ? cached : detectBrowserLanguage()
  })

  const token = useAuthStore(state => state.token)

  useEffect(() => {
    if (!token) return
    fetch('/api/v1/user/settings', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.language && SUPPORTED.includes(data.language as SupportedLanguage)) {
          _apply(data.language as SupportedLanguage)
        }
      })
      .catch(() => {})
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  function _apply(lang: SupportedLanguage) {
    _setLanguage(lang)
    localStorage.setItem('ascribe_language', lang)
  }

  function setLanguage(lang: SupportedLanguage) {
    _apply(lang)
    if (token) {
      fetch('/api/v1/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ language: lang }),
      }).catch(() => {})
    }
  }

  const t = (key: string): string => catalogs[language][key] ?? catalogs['en'][key] ?? key

  return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useTranslation = () => useContext(LanguageContext)

const localeMap: Record<SupportedLanguage, string> = { en: 'en-US', fr: 'fr-FR' }
// eslint-disable-next-line react-refresh/only-export-components
export const useLocale = () => localeMap[useContext(LanguageContext).language]
