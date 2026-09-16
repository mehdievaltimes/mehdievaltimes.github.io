---
title: "Thoughts on AI Safety"
date: 2026-07-04
tags: [LLMs, AI, NLP, Transformers, Mechanistic Interpretability]
---

Frontier labs currently rely on behavioral evaluations to test model safety. Basically, they have a dataset of "dangerous" questions they give to the model, and if it doesn't comply it's considered safe. But what if the model knows it's being tested, so it **deceptively aligns** itself with humans while internally harboring misaligned goals? 

To put it simply, we cannot trust the output of the model to be truthful. The output is designed to trick you. 