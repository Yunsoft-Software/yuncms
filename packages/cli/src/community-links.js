export const COMMUNITY_LINKS = Object.freeze({
  github: 'https://github.com/Yunsoft-Software/yuncms',
  services: 'https://yunsoft.com/contact?utm_source=cli&utm_medium=yuncms&utm_campaign=yuncms-services',
  sponsorship: 'https://github.com/sponsors/Yunsoft-Software',
});

export function printCommunityLinks({ output = console, env = process.env, isTTY = process.stdout.isTTY, help = false } = {}) {
  if (!help && (!isTTY || env.CI)) return;
  output.log?.(`\nEnjoy YunCMS? Star the project: ${COMMUNITY_LINKS.github}\nBuild with Yunsoft — setup, migration and AI workflows: ${COMMUNITY_LINKS.services}\nSponsor YunCMS: ${COMMUNITY_LINKS.sponsorship}`);
}
