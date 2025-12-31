---
layout: post
title: "Predicting Brain Responses to Images"
date: 2025-12-30
categories: [cognitive-science, deep-learning, neuroscience]
tags: [img2fmri, fMRI, ResNet, BOLD5000, brain-modeling]
---

I recently came across [img2fmri](https://github.com/dpmlab/img2fmri.git), an NPM package developed by my beloved professor Chris Baldassano, and I think more people should know about it!

So what does it do? img2fmri predicts how the brain responds to images. Now, what does that even mean?

Whenever we see something, certain regions of our brain light up… obviously! But it’s not random: the brain processes different types of images differently. Take this masterpiece example: a picture of Gandalf versus a picture of Rivendell. 

The Lateral Occipital Complex (LOC), tucked away in the ventral visual pathway, is obsessed with objects; Show it Gandalf and it’ll fire like crazy. The Retrosplenial Cortex (RSC) and Parahippocampal Place Area (PPA), which help us navigate and make sense of scenes, both perk up for Rivendell, noticing the spiraling elven architecture and basically saying: “Yep, that’s a place and it’s beautiful.”

img2fmri can predict which regions are activated based on the image, and it does so using deep learning. Shocking, I know!

The model combines a pretrained ResNet-18 (a type of convolutional neural network that’s great at recognizing visual patterns) with a linear regression layer that maps the network’s output to predicted fMRI responses. The model was trained on [BOLD5000](https://bold5000-dataset.github.io/website/), a dataset of fMRI responses from three subjects viewing 4,916 images (I wonder what the other 84 images were that they didn't include). 

Even though our brains are messy spaghetti codes, visual processing is surprisingly consistent across people, which makes this possible. And because our brains process visuals in nearly identical ways, this tool is awesome for cognitive modeling!
