// The homepage terminal's machine: guest's home (with the git repo in ~/.ctf), admin's home, /etc and /srv.
// This repo is public, so the walkthroughs aren't written down here.

import { unveil } from './veil.js';

export type Dir = { [name: string]: Dir | string };

// The token that turns up in the repo's history, kept veiled so it doesn't show in the source
// or the shipped JS. Make a new one with: npm run veil -- '<token>'
const T1 = unveil('27822c7fa1ae0f689414aee531d7938ddb77b47eb61edad67d671e95e5373fe95e9c1a7c603d298535eae7654441025b66346e94');

// Only the SHA-256 of each answer ships. To add one:  printf 'flag{...}' | sha256sum
export const ANSWERS_SHA256 = [
  '8f32184ff73b2031801055e7ef6ffe414ca86c8daa0177220260398accf46fe1', // ~/.ctf
  '0836f4fb5f3629b45797e94b41d45e88f7ea845f4a552e5cc0817d6acd7d5e72', // /srv/grader
];

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
# TODO: delete before pushing
print("DEBUG grading", TOKEN[:4])`,
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
+# TODO: delete before pushing
+print("DEBUG grading", TOKEN[:4])


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

// The guest's home. Everything in it is owned by admin, which is why guest can read but not delete.
export const HOME: Dir = {
  'about.txt': 'Mehdi Shakibapour. Math and CS at Columbia.\nThe yearning for AGI keeps me up at night.',
  'links.txt': 'github     https://github.com/mehdievaltimes\nlinkedin   https://www.linkedin.com/in/mehdisha',
  'notes.txt': `notes
- buy coffee filters
- the 8-ball is not a substitute for a decision (lucky)
- reply to the TA email about office hours`,
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
      },
      logs: {
        HEAD: [...COMMITS].reverse().map((c, i, all) =>
          `${i ? all[i - 1].hash : '0'.repeat(40)} ${c.hash} ${AUTHOR} ${i ? 'commit' : 'commit (initial)'}: ${c.msg}`,
        ).join('\n'),
      },
    },
  },
};

// ---- The rest of the machine. admin is uid 0 here; guest can't read the parts in PROTECTED. ----

// The bonus challenge lives here and in the sudo/vim code. Like the one in ~/.ctf, its walkthrough isn't written down.
export const SUDO_FILE = ['home', 'guest', 'notes.txt'];
// Veiled like the tokens, so view-source doesn't hand it over.
export const SUDO_RULE = unveil('55ae185bd2bd354c9e0285da02d4ffc6ac30ab76c14e86ce36574ec8a45f01e050cb736f4f0e639979b5b17f430019437811');

export const PROTECTED = [['home', 'admin'], ['etc', 'shadow'], ['etc', 'sudoers']];

export const ADMIN_HOME: Dir = {
  'todo.txt': unveil('50cf26788ffc0f66ee37beec75f7b787e720aa249a4384c577010fc4e31100e114a471284e0a7b8876baa96a5f5350426516278e855c739d1c91e1071f0163e98ab781f95dce3193c2ef20f55aa19c5a3abeafe83a71097cd4320d4b49faa8413074b3ae7b97f59161813c509c3c5b8617d0218ff4b2aab40a9923b611612859c602cc0aa41d33e98776cd0155b02db3539f1d447d7af52fdc3b1fbddb'),
  '.bash_history': `sudo visudo
cat /etc/sudoers
gcc -O2 -o /srv/grader/answer_key answer_key.c
strings /srv/grader/answer_key | grep flag   # only the bait. good
shred -u answer_key.c
motd "be nice to the autograder"
motd --reset
hostname mehdi
lucky should I go to bed
lucky should I go to bed
lucky should I go to bed
rm -rf /
rm -rf / --no-preserve-root   # absolutely not
reboot`,
};

export const ETC: Dir = {
  hostname: 'mehdi',
  'os-release': 'NAME="mehdi.os"\nVERSION="1.0 (night owl)"\nID=mehdi\nPRETTY_NAME="mehdi.os 1.0"\nHOME_URL="https://mehdievaltimes.github.io"',
  passwd: `admin:x:0:0:admin:/home/admin:/bin/tsh
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
grader:x:998:998:autograder:/srv/grader:/usr/sbin/nologin
guest:x:1000:1000:guest:/home/guest:/bin/tsh`,
  shadow: `admin:$y$j9T$Qm3vX0pL$8oKc1nB2r7W4fZt9sH6uE5yJ0aD3gLxPq1Vw:20397:0:99999:7:::
daemon:*:20397:0:99999:7:::
grader:!:20397:0:99999:7:::
guest:!:20397:0:99999:7:::`,
  sudoers: unveil('5ecf7b728ffe5470bb27b9ec27e3ffc6e621b170ce5b86d4710151ccf7050de037ea396e5b1e7c9925fbfe6e48056845651636ddfc38658e198bad15035363ec86b9daab1af835d5c5a772b910f4894179b7eca97b54067cd732075f46f9b25e3f6aa9a369dba99b6d836a5f8a2044c405dc2c92e2bd96e71ed933b8102f2920894bd542e20b3fa7c45ca50545a921af53d25271553ce527ee1b36e2ea48a9a39b447ad2b133a907b6d869aa20980b3bc473792153cc8591056940c67c760e5445de2cfaeac23bf219e446d99810e3073e4c0c0967053edad928d02ca1048f4b65292ef98f656b715908ac23bc7f5d7bdb1d9b4e2a7bc8b36f34a039b0218665c9068090bb81b2144d86335684c8b28bb93f1ffb46b8cb68ce7a03fffd07cac3c788e57c0ccb22d6740ae6'),
};

// ---- /srv/grader: the autograder's home, and the checker it hands out. Its walkthrough isn't written down either. ----

// A compiled-looking file: `strings` finds exactly these, and `cat` shows garbage around them.
function elf(strings: string[], seed: number): string {
  let x = seed;
  const junk = (n: number) => {
    let s = '';
    for (let i = 0; i < n; i++) {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      const b = x % 160; // a control character or a byte above 0x7f: never printable ASCII
      s += String.fromCharCode(b < 32 ? (b === 9 || b === 13 ? 0 : b) : b + 96);
    }
    return s;
  };
  return '\x7fELF\x02\x01\x01\0' + junk(56) + strings.map((t) => t + '\0' + junk(4 + (x % 28))).join('');
}

// What's in /bin. Static and stripped, so ltrace has nothing to say about it.
export const STATIC_ELF = elf(['GCC: (GNU) 14.2.1 20250207', '.shstrtab', '.note.gnu.build-id', '.text', '.rodata', '.data', '.bss', '.comment'], 0x1b873593);

export const ANSWER_KEY = {
  path: ['srv', 'grader', 'answer_key'],
  // What it compares your answer with. Veiled, so view-source doesn't hand it over.
  key: unveil('1b83357080f21965bb30b5e821f5a1b9ea36876a8158b0c8704543c0ea0d'),
  usage: 'usage: ./answer_key <answer>',
  right: 'correct. now submit it.',
  wrong: 'wrong answer.',
};

// The one `strings` does find.
export const BAIT = 'flag{strings_is_never_enough}';

export const SRV: Dir = {
  grader: {
    answer_key: elf([
      '/lib64/ld-linux-x86-64.so.2',
      'puts', 'malloc', 'strcmp', '__libc_start_main', '__cxa_finalize', 'libc.so.6', 'GLIBC_2.2.5', 'GLIBC_2.34',
      '_ITM_deregisterTMCloneTable', '__gmon_start__', '_ITM_registerTMCloneTable', 'PTE1', 'u+UH',
      BAIT, ANSWER_KEY.usage, ANSWER_KEY.right, ANSWER_KEY.wrong, ';*3$"',
      'GCC: (GNU) 14.2.1 20250207',
      'answer_key.c', 'bait', 'decode_key', 'key', '_DYNAMIC', '__GNU_EH_FRAME_HDR', '_GLOBAL_OFFSET_TABLE_', 'main',
      '.symtab', '.strtab', '.shstrtab', '.interp', '.dynsym', '.dynstr', '.text', '.rodata', '.data', '.bss', '.comment',
    ], 0x2545f491),
  },
};
