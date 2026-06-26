---
title: Mapping Token to Word Attention
date: 2026-06-25 18:10:00 -0400
---

Because Large Language Models use subword tokenization (like BPE), a word like `indubitably` might be split into `in`, `du`, `bit`, `ably`. If you try to visualize the raw attention matrix, you get a massive `Token × Token` grid that looks like a noisy, unreadable mess to human eyes.

To build a human-readable **Word-Level Attention Map**, we have to mathematically aggregate those token weights.

If Word A is made of 3 tokens, and Word B is made of 2 tokens, how much does Word A attend to Word B? We calculate the "attention from Word A to Word B" by taking the mathematical average (or sum) of the attention weights going from all 3 sub-tokens of A to all 2 sub-tokens of B. 

It's a mathematical compromise, but it collapses the massive token grid into a clean `Word × Word` 2D matrix that we can actually interpret and visualize.
