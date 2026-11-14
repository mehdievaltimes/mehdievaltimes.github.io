import fs from 'node:fs';
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { unified } from '@astrojs/markdown-remark';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

// A page marked noindex (Base's `noindex` prop, or a redirect) stays out of the sitemap, so a hidden page
// only needs that prop. The sitemap runs after the build, so it can read the page it's about to list.
const noindex = (page) => {
  try {
    return fs.readFileSync(new URL(`./dist${new URL(page).pathname}index.html`, import.meta.url), 'utf8').includes('<meta name="robots" content="noindex">');
  } catch {
    return false;
  }
};

export default defineConfig({
  site: 'https://mehdievaltimes.github.io',
  trailingSlash: 'ignore',
  // Not at the default /sitemap-index.xml and not named in robots.txt: give its URL to search engines directly.
  integrations: [sitemap({ filenameBase: 'pages', filter: (page) => !noindex(page) })],
  redirects: {
    // Pages that were taken down.
    '/roaree': '/',
    '/sae': '/',
    '/posts/legalean': '/',
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
