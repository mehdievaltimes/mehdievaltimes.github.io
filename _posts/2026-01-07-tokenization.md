---
layout: post
title: "On Tokenization"
date: 2026-01-07
categories: Tokenization
tags: [LLMs, AI, NLP, Transformers, Machine-Learning]
---
I’m sure you have all seen some version of this meme:

![LLM meme showing matrix multiplication as a virtual girlfriend](https://mehdievaltimes.github.io/assets/img/virtualgfmeme.jpg)

This obviously oversimplified yet vaguely accurate caricature says all LLMs do math on the series of characters we feed into them. As part of this process, LLMs inevitably convert these strings to a series of numbers so that they can begin "math-ing." In other words, computers do not process language natively. We developers have to map every possible string to numbers so the computer can do math on it and give us an output.

The simplest way of mapping English to numbers is to assign a number to every character in the alphabet—i.e., a is 1, b is 2, c is 3, and so on. If we limit the model to English, we’ll have 26 letters (double that for uppercase), punctuation, and whitespace, totaling 57 tokens. We can technically build and train models this way, but it comes with a massive set of problems. Before I talk about those, however, I need to briefly go over how machines “understand” language.

It’s fairly easy for a computer to memorize the meanings of words. The full Oxford English Dictionary occupies no more than 2 GB. However, a computer lacks understanding of the language despite knowing the possible meanings of every word. To a dictionary, the following two sentences are nearly identical:

> Joey is a nice person with a big heart.
>
> Baby Kangaroo is a preprocessing Homo sepien with a full-sized aortic pump.

Obviously, dictionary software cannot fully understand language alone because it doesn't know anything about contextual cues. It doesn't know that "Joey" here is likely the name of a person, rather than a literal marsupial.

To instill contextual understanding, AI devs of the 50s and 60s tried to hard-code specific triggers. For instance, Joseph Weizenbaum’s ELIZA program relied on rigid "scripts." If a user typed, "I am feeling sad about my mother," ELIZA didn't actually "understand" grief; it was simply programmed with a rule: If [input] contains "mother," then [output] "Tell me more about your family." It was a "canned" response that collapsed the moment the user stepped outside the pre-defined patterns.

Nowadays, it’s not controversial to say LLMs can easily understand context. When we write, “The cat sat on the mat, and it played with its toy,” an LLM understands that "it" refers to “the cat.” The way the machine captures contextual cues is through a mechanism called [Self-Attention](https://arxiv.org/abs/1706.03762), which uses three vectors: Queries, Keys, and Values.

Think of the model as a giant office of filing cabinets:

- Query: Every token (like the word "it") holds a sticky note asking a question: "I’m a pronoun. Which noun in this sentence do I belong to?"
- Key: Every other token has a label on its cabinet drawer. The cabinet for "cat" is labeled: "I am a feline noun." The cabinet for "mat" is labeled: "I am a floor covering."
- Value: Inside the "cat" cabinet is the actual information, a list of numbers representing the "meaning" of a cat.

When the model processes the sentence, the Query for "it" scans all the Keys. It finds a high mathematical match with the "cat" Key. The model then opens that drawer and pulls out the Value, blending that information into the "it" token.

In this process, each “token” pays “attention” to other tokens. You can already see that if we treat every letter as a separate token, we have a massive computational problem. If a sentence has 50 characters, we need to process 50² (2,500) operations for just one layer of attention. Current GPT models condense that same sentence into roughly 13 tokens, reducing the operations to just 169. More importantly, letters alone lack semantic meaning; it’s nonsensical and inefficient for a model to know how much the `c` in cat should pay attention to the `t` in mat. If we treat each word as a distinct token, things get easier and more intuitive. We know "cat" should pay some amount of attention to "mat," and it should pay attention to "cat" for its value.

But here’s where things get interesting: you’ve probably heard how older LLMs cannot tell us there are 3 r's in the word strawberry. That’s because of tokenization! When we feed strawberry to an LLM, it treats it as three tokens: st-raw-berry. It can tell us about the history of the fruit, the etymology, it can make up stories about magical strawberries; but it doesn't "see" the individual letters s-t-r-a-w-b-e-r-r-y.

This also explains why LLMs are historically bad at simple arithmetic or why they struggle with harder-to-tokenize languages like Japanese. The workaround for the first two problems is to let the model run Python code! When we ask a modern LLM, it secretly runs a script to count the letters:

```python
word = "strawberry"
count = word.lower().count('r')
print(count)
```
Here's a (brief) list of problems with the way we currently tokenize language:
- The Case-Sensitivity Glitch: To a tokenizer, Hello, hello, and HELLO are often three completely different "numbers."
- The "SolidGoldMagikarp" Glitch: Some tokenizers include strings that appeared often in the training data but were never "explained" to the model (like specific usernames or weird Reddit tags). If the model sees these "hallucination tokens," it can completely lose its mind and start outputting gibberish.
- The ASCII Art Failure: Ever wonder why LLMs can't draw a simple cat with slashes and dashes?
- Subword "Garbage" in Code: In programming, specific variable names like idx_to_str might be broken into idx, _to, and _str. If the tokenizer is bad, it might break it into i, dx, _t, o_s, tr. This makes it much harder for the model to reason about the logic of the code because the variable name looks like a word salad.

Ideally, we want to get rid of this cumbersome process of tokenization entirely and treat inputs as streams of bytes, allowing the model to process words quasi-natively. Several papers have been written on the subject, such as [Megabyte](https://arxiv.org/abs/2305.07185), but there is currently no definitive empirical proof that it can outperform tokenization.

Notes: 
- I want to mention Andrej Karpathy's [lecture on Tokenization](https://www.youtube.com/watch?v=zduSFxRajkE), as most of the ideas here were shamelessly stolen from him. 
- You can play around with GPT's tokenizers [here](https://platform.openai.com/tokenizer). 