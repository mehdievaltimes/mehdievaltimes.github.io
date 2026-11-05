// Everything the homepage terminal knows: its files, and the git repo in ~/.ctf.
// This repo is public, so the walkthrough isn't written down here.
// Only the SHA-256 of the answer ships. To change it:  printf 'flag{...}' | sha256sum

import { unveil } from './veil.js';

export type Dir = { [name: string]: Dir | string };

// The two tokens that turn up in the repo, kept veiled so they don't show in the source or
// the shipped JS. Make new ones with: npm run veil -- '<token>'
const T1 = unveil('27822c7fa1ae0f689414aee531d7938ddb77b47eb61edad67d671f98');
const T2 = unveil('19a83c7ba3ae356bac1480ef0cc88b80d977e171b474df9d');

export const ANSWER_SHA256 = '8f32184ff73b2031801055e7ef6ffe414ca86c8daa0177220260398accf46fe1';

const README = `# autograder

Grades the weekly problem sets for the course I TA.

Students answer from the course shell:

    submit <answer>

Tokens and keys come from the environment. Nothing secret lives in this repo.`;

const GRADER = `import hashlib, os, yaml

cfg = yaml.safe_load(open("config.yml"))
TOKEN = os.environ["GRADER_TOKEN"]


def late_penalty(hours_late):
    # 10% per day, rounded down to the nearest whole day
    return min(1.0, 0.1 * (hours_late // 24))


def grade(answer, expected_sha256):
    return hashlib.sha256(answer.encode()).hexdigest() == expected_sha256`;

const GRADER_STASHED = GRADER.replace(
  'TOKEN = os.environ["GRADER_TOKEN"]',
  `TOKEN = os.environ["GRADER_TOKEN"]
# TODO: delete before pushing. fallback while the env var is broken on the lab machines
FALLBACK_TOKEN = "${T2}"`,
);

const CONFIG_OLD = `course: coms-ta
endpoint: https://grader.internal/api
api_token: "${T1}"
timeout: 30`;
const CONFIG = CONFIG_OLD.replace(`api_token: "${T1}"`, 'api_token: ${GRADER_TOKEN}');

export type Commit = { hash: string; date: string; msg: string; diff: string };

const AUTHOR = 'mehdi <mehdi@grader.internal>';

// Newest first, like `git log`.
export const COMMITS: Commit[] = [
  {
    hash: '78d1ba60612111a793d3c533fd0cd8e4ba487df2',
    date: 'Thu Sep 10 01:12:44 2026 -0400',
    msg: 'move grader token to env var',
    diff: `diff --git a/config.yml b/config.yml
index 3b18e51..9d1c2f4 100644
--- a/config.yml
+++ b/config.yml
@@ -1,4 +1,4 @@
 course: coms-ta
 endpoint: https://grader.internal/api
-api_token: "${T1}"
+api_token: \${GRADER_TOKEN}
 timeout: 30`,
  },
  {
    hash: 'b0c27ba004c614b0d0990cc4befb93d0f3a265e2',
    date: 'Wed Sep 9 23:40:02 2026 -0400',
    msg: 'fix late penalty rounding',
    diff: `diff --git a/grader.py b/grader.py
index 51e0a7c..c2d8b19 100644
--- a/grader.py
+++ b/grader.py
@@ -7,8 +7,8 @@ TOKEN = os.environ["GRADER_TOKEN"]

 def late_penalty(hours_late):
-    # 10% per day
-    return min(1.0, 0.1 * hours_late / 24)
+    # 10% per day, rounded down to the nearest whole day
+    return min(1.0, 0.1 * (hours_late // 24))
 `,
  },
  {
    hash: 'eebed0f1378edf6e48fc0ebbba39c54facec3cec',
    date: 'Thu Sep 3 18:05:31 2026 -0400',
    msg: 'add grader config',
    diff: `diff --git a/config.yml b/config.yml
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/config.yml
@@ -0,0 +1,4 @@
+course: coms-ta
+endpoint: https://grader.internal/api
+api_token: "${T1}"
+timeout: 30
diff --git a/.gitignore b/.gitignore
new file mode 100644
index 0000000..a1f3c07
--- /dev/null
+++ b/.gitignore
@@ -0,0 +1,3 @@
+__pycache__/
+*.pyc
+.env`,
  },
  {
    hash: '80ac40bd8364c64db00f05fd27b78aefbf6e2251',
    date: 'Wed Sep 2 14:21:09 2026 -0400',
    msg: 'initial commit',
    diff: `diff --git a/README.md b/README.md
new file mode 100644
index 0000000..e69a4f2
--- /dev/null
+++ b/README.md
@@ -0,0 +1,${README.split('\n').length} @@
${README.split('\n').map((l) => '+' + l).join('\n')}
diff --git a/grader.py b/grader.py
new file mode 100644
index 0000000..51e0a7c
--- /dev/null
+++ b/grader.py
@@ -0,0 +1,${GRADER.split('\n').length} @@
${GRADER.replace('# 10% per day, rounded down to the nearest whole day', '# 10% per day').replace('0.1 * (hours_late // 24)', '0.1 * hours_late / 24').split('\n').map((l) => '+' + l).join('\n')}`,
  },
];

export const STASH = {
  hash: '8980e8bde003a6e20abbddf749f8c8b554541fff',
  date: 'Thu Sep 10 01:30:17 2026 -0400',
  msg: 'WIP on main: 78d1ba6 move grader token to env var',
  file: 'grader.py',
  stashed: GRADER_STASHED,
  stat: ' grader.py | 2 ++\n 1 file changed, 2 insertions(+)',
  diff: `diff --git a/grader.py b/grader.py
index c2d8b19..f41a6e0 100644
--- a/grader.py
+++ b/grader.py
@@ -2,6 +2,8 @@ import hashlib, os, yaml

 cfg = yaml.safe_load(open("config.yml"))
 TOKEN = os.environ["GRADER_TOKEN"]
+# TODO: delete before pushing. fallback while the env var is broken on the lab machines
+FALLBACK_TOKEN = "${T2}"


 def late_penalty(hours_late):`,
};

export const AUTHOR_LINE = AUTHOR;

// `git show <commit>:<path>`: a file as it was at a commit (index into COMMITS, newest first).
export function fileAt(i: number, path: string): string | null {
  const oldest = COMMITS.length - 1;
  if (path === 'README.md') return README;
  if (path === 'grader.py') return i <= 1 ? GRADER : GRADER.replace('# 10% per day, rounded down to the nearest whole day', '# 10% per day').replace('0.1 * (hours_late // 24)', '0.1 * hours_late / 24');
  if (path === 'config.yml') return i === 0 ? CONFIG : i < oldest ? CONFIG_OLD : null;
  if (path === '.gitignore') return i < oldest ? '__pycache__/\n*.pyc\n.env' : null;
  return null;
}

export const REPO_DIR = '.ctf';

export const FS: Dir = {
  'about.txt': 'Mehdi Shakibapour. Math and CS at Columbia.\nThe yearning for AGI keeps me up at night.',
  'links.txt': 'github     https://github.com/mehdievaltimes\nlinkedin   https://www.linkedin.com/in/mehdisha',
  [REPO_DIR]: {
    'README.md': README,
    'grader.py': GRADER,
    'config.yml': CONFIG,
    '.gitignore': '__pycache__/\n*.pyc\n.env',
    '.git': {
      HEAD: 'ref: refs/heads/main',
      config: '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\tlogallrefupdates = true\n[remote "origin"]\n\turl = ssh://git@grader.internal/autograder.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "main"]\n\tremote = origin\n\tmerge = refs/heads/main',
      description: "Unnamed repository; edit this file 'description' to name the repository.",
      COMMIT_EDITMSG: 'move grader token to env var',
      refs: {
        heads: { main: COMMITS[0].hash },
        stash: STASH.hash,
      },
      logs: {
        HEAD: [...COMMITS].reverse().map((c, i, all) =>
          `${i ? all[i - 1].hash : '0'.repeat(40)} ${c.hash} ${AUTHOR} ${i ? 'commit' : 'commit (initial)'}: ${c.msg}`,
        ).join('\n'),
      },
    },
  },
};
