# RevOpt

Optimizing a program without its source. The agent gets a stripped FFmpeg binary built at `-O0` and has to hand back a faster executable, working only from the binary with reverse-engineering tools (Ghidra, gdb, radare2, angr, binutils), no internet, and a 3-hour limit.

The submission first has to pass two gates: 591 correctness workloads, including FFmpeg's FATE suite, and hardening checks that the original's protections survive (PIE, RELRO, CET, stack protectors). If it passes, it is scored out of 6 on measured speedup over the original, with `gcc -O3` of the same source as the reference.
