// Words the terminal prints that aren't files: the 8-ball, man pages, the neofetch logo.

export const EIGHT_BALL = [
  'Yes. Now go do it before you talk yourself out of it.',
  'No. And you knew that before you asked.',
  "Ask again after you've slept.",
  'Signs point to yes, but read the docs first.',
  "Outlook hazy. Write it down; it'll clear up.",
  'Absolutely. Ship it.',
  'Not today. Tomorrow looks better.',
  "Only if you'd still do it with nobody watching.",
  "The answer is in a paper you haven't read yet.",
  'Yes, but start smaller than you think.',
  "Doubtful. Talk to someone who's done it.",
  "It's already working. Stop checking.",
  'Take a walk first. Then yes.',
  'Unclear. Run the experiment.',
  'Yes, if you can explain it to a friend in one sentence.',
  "Don't count on it. Have a plan B.",
  'Without a doubt. Drink some water anyway.',
  'My sources say no. My sources are a random number generator.',
  "Ask the person you've been avoiding asking.",
  'Yes. Future you says thanks.',
  'Concentrate and ask again. Or just decide.',
  'The 8-ball abstains. Flip a coin and notice how you feel about the result.',
  'Go for it, but commit your work first.',
  'Probably. Be kind about it.',
];

/** The same answer all day, for the greeting. */
export function adviceOfTheDay(d = new Date()) {
  const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  let h = 0;
  for (const c of key) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return EIGHT_BALL[h % EIGHT_BALL.length];
}

// name -> [one-line summary, usage]. `man -k` lists only the PUBLIC ones.
export const MAN: Record<string, [string, string]> = {
  help: ['list the commands', 'help [-v]     -v lists all of them'],
  ls: ['list directory contents', 'ls [-a] [-l] [DIR...]'],
  cd: ['change directory', 'cd [DIR]     no DIR goes home; cd - goes back'],
  cat: ['print files', 'cat [FILE...]     reads stdin when given no files'],
  pwd: ['print the working directory', 'pwd'],
  whoami: ['print your user name', 'whoami'],
  id: ['print user and group ids', 'id'],
  echo: ['print a line', 'echo [TEXT...]     $USER, $HOME, $PWD and $? expand'],
  env: ['print the environment', 'env'],
  grep: ['print lines that match a pattern', 'grep [-i] [-v] [-n] [-r] PATTERN [FILE...]'],
  head: ['first lines of a file', 'head [-n N] [FILE...]'],
  tail: ['last lines of a file', 'tail [-n N] [FILE...]'],
  wc: ['count lines, words and bytes', 'wc [-l] [-w] [-c] [FILE...]'],
  sort: ['sort lines', 'sort [-r] [-n] [-u] [FILE...]'],
  uniq: ['drop repeated adjacent lines', 'uniq [-c] [FILE...]'],
  find: ['look for files', "find [DIR] [-name 'GLOB'] [-type f|d]"],
  tree: ['list a directory as a tree', 'tree [-a] [DIR]'],
  date: ['print the date and time', 'date'],
  uname: ['print system information', 'uname [-a]'],
  hostname: ['print or set the machine name', 'hostname [NAME]'],
  man: ['read a manual page', 'man COMMAND\nman -k .     list every page'],
  open: ['open a page of this site', 'open home | puppy-bench | sandbox\nopen writing/FILE.md     open a post'],
  lucky: ["I'm feeling lucky: ask the magic 8-ball", 'lucky [QUESTION]\n8ball [QUESTION]'],
  neofetch: ['system info, with a logo', 'neofetch'],
  history: ['list or clear past commands', 'history [-c]\nCtrl+R searches it.'],
  clear: ['clear the screen', 'clear     (or Ctrl+L)'],
  exit: ['leave the shell', 'exit'],
  base64: ['encode or decode base64', 'base64 [-d] [FILE]'],
  git: ['the stupid content tracker', 'git <command> [<args>]'],
  sudo: ['run a command as another user', 'sudo COMMAND'],
  su: ['switch user', 'su [USER]'],
  vim: ['Vi IMproved, a text editor', 'vim [-c CMD] [FILE]\nTo leave: :q'],
  rm: ['remove files or directories', 'rm [-r] [-f] [--no-preserve-root] PATH...'],
  motd: ['print or set the message of the day', 'motd [TEXT]\nmotd --reset'],
  reboot: ['restart the machine', 'reboot'],
  shutdown: ['power off the machine', 'shutdown'],
  submit: ['submit an answer to the autograder', 'submit <answer>'],
};

export const PUBLIC = [
  'help', 'ls', 'cd', 'cat', 'pwd', 'whoami', 'echo', 'grep', 'head', 'tail', 'wc', 'sort', 'uniq',
  'find', 'tree', 'date', 'uname', 'man', 'open', 'lucky', 'neofetch', 'history', 'clear',
];

export const LOGO = [
  ' __  __ ',
  '|  \\/  |',
  '| |\\/| |',
  '| |  | |',
  '|_|  |_|',
];
