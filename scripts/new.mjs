#!/usr/bin/env node
// npm run new                          -> blank thought
// npm run new -- --now "a thought"     -> thought with the text already in it
// npm run new -- --post "Some title"   -> post
// add --draft to any of these           -> only visible in `npm run dev`
import { writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const draft = args.includes('--draft');
const now = args.includes('--now');
const post = args.includes('--post');
const dir = `src/content/${post ? 'posts' : 'thoughts'}`;
const text = args.filter((a) => !a.startsWith('--')).join(' ').trim();

const d = new Date();
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const off = -d.getTimezoneOffset();
const tz = `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const title = text && !now ? text : '';
let slug = title ? slugify(title) : `${stamp}-${time.replace(':', '')}`;
let path = `${dir}/${slug}.md`;
for (let i = 2; existsSync(path); i++) path = `${dir}/${slug}-${i}.md`;

const fm = ['---', `date: ${stamp}T${time}:00${tz}`];
if (post && !title) { console.error('posts need a title'); process.exit(1); }
if (title) fm.push(`title: ${JSON.stringify(title)}`);
if (draft) fm.push('draft: true');
fm.push('---', '', now ? text : '', '');

writeFileSync(path, fm.join('\n'));
console.log(`created ${path}`);
