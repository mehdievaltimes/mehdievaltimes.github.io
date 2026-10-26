import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://mehdievaltimes.github.io',
  trailingSlash: 'ignore',
  integrations: [sitemap({ filter: (page) => !/\/(new|roaree|sae|now|sigsegv|wafer-thin-mint|thoughts|about|resume|projects|tweets|tags|categories|archives)\/?$/.test(page) })],
  redirects: {
    // Pages that were taken down.
    '/roaree': '/',
    '/sae': '/',
    // From when thoughts were their own section.
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
  },
  markdown: {
    processor: unified({ remarkPlugins: [remarkMath], rehypePlugins: [rehypeKatex] }),
    shikiConfig: { themes: { light: 'night-owl-light', dark: 'night-owl' } },
  },
});
