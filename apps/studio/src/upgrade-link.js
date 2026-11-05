export function premiumContactUrl(locale) {
  const contactPage = locale === 'tr' ? 'tr/iletisim' : 'contact';
  return `https://yunsoft.com/${contactPage}?utm_source=studio&utm_medium=yuncms&utm_campaign=yuncms-premium`;
}
