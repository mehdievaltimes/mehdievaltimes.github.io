# Trajectories

Files for [mehdievaltimes.github.io/trajectories](https://mehdievaltimes.github.io/trajectories/). Anything committed here is published on the next deploy.

- [`data/`](data/): agent runs. Each run's result `.json` and event stream `.jsonl` become a page at `/trajectories/<run>/`.
- [`scripts/`](scripts/): code and other files to share (harnesses, graders, prompts). Each file gets a viewer at `/trajectories/scripts/<file>/`.

To add files from GitHub, open a folder and use **Add file → Upload files** (25 MB per file in the browser). From a clone, `npm run add-trajectory -- <files or folder> [--to <subfolder>]` checks runs before copying them into `data/`.
