// Keep this registry small and evidence-based. Domains must come from the
// organisation's own published anti-fraud or contact documentation.
export const TRUSTED_ORGANIZATIONS = Object.freeze([
  Object.freeze({
    id: 'esun_bank',
    name: '玉山銀行',
    aliases: Object.freeze(['玉山銀行', '玉山網路銀行', '玉山信用卡', 'e.sun bank', 'esun bank', 'esunbank']),
    officialDomains: Object.freeze(['esunbank.com', 'esunbank.com.tw', 'esun.co'])
  }),
  Object.freeze({
    id: 'ikala',
    name: 'iKala',
    aliases: Object.freeze(['ikala']),
    officialDomains: Object.freeze(['ikala.ai', 'ikala.tv'])
  })
]);

export function hostnameMatchesDomain(hostname, domain) {
  const host = String(hostname ?? '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  const expected = String(domain ?? '').toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  return Boolean(host && expected && (host === expected || host.endsWith(`.${expected}`)));
}

export function findClaimedOrganizations(text) {
  const content = String(text ?? '').toLowerCase();
  return TRUSTED_ORGANIZATIONS.filter(organization => organization.aliases.some(alias => content.includes(alias.toLowerCase())));
}
