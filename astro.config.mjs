import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://mehdievaltimes.github.io',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !/\/(new|now|sigsegv|wafer-thin-mint|thoughts|about|resume|projects|tweets|tags|categories|archives|rss\.xml|feed\.xml)\/?$/.test(page) })],
  // Old URLs from when thoughts were their own section.
  redirects: {
    // Sections that no longer exist.
    '/thoughts': '/',
    '/thoughts/[slug]': '/posts/[slug]',
    // Old Jekyll/Chirpy URLs.
    '/now': '/',
    '/about': '/',
    '/resume': '/',
    '/projects': '/',
    '/tweets': '/',
    '/tags': '/',
    '/categories': '/',
    '/archives': '/',
    '/rss.xml': '/',
    '/feed.xml': '/',
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { themes: { light: 'night-owl-light', dark: 'night-owl' } },
  },
});
