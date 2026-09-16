import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

export default defineConfig({
  site: 'https://mehdievaltimes.github.io',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  // Old URLs from when thoughts were their own section.
  redirects: {
    '/thoughts': '/',
    '/thoughts/[slug]': '/posts/[slug]',
  },
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
  },
});
