---
title: Birds.Quest - My Effortless Bird Watching Auto Blogging Buddy that Inspires Me to Go Back to Nature
published: false
tags: devchallenge, hf26challenge, ai, automation
ai_disclosure_level: ai_assisted
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built and Why

Bird watching has always been a passion of mine, but keeping a detailed journal of my sightings and experiences was often cumbersome. Birds.Quest automates the process of blogging about my bird watching adventures, making it effortless to document and share my experiences. It encourages me to spend more time in nature while still maintaining a rich record of my observations.

I used to manually give entries to eBird. It was cool in the beginning, but it quickly became tedious and time-consuming, especially when I wanted to focus on enjoying the birds rather than documenting every detail. Birds.Quest solves this problem by automatically generating blog posts from my bird watching sessions, allowing me to effortlessly keep a comprehensive record of my observations.

The autoblogging feature of Birds.Quest takes the raw data from my bird watching sessions and transforms it into well-structured, engaging blog posts. This means I no longer have to spend time writing and formatting my entries manually; the system handles it all, allowing me to focus on enjoying the birds and the natural environment around me.

Granted, the auto generated posts are approximations and may not capture every nuance of my experience perfectly, but they provide a solid foundation that I can easily refine if needed. This balance allows me to maintain a detailed and engaging bird watching blog without the burden of manual documentation every single time.

While the entire setup is for my own use, anyone can adapt the Open Source Birds.Quest repository from [GitHub](https://github.com/SweaDev/birds.quest) to their own bird watching routines and enjoy the same effortless blogging experience.

## Demo

{%embed https://birds.quest %}

## Code

{%embed https://github.com/SweaDev/birds.quest %}

## How I Built It

- BirdNET GeoModel (ONNX): https://birdnet-team.github.io/geomodel/
- Google Gemma-4 E2B model for local test, and 31B for production using Digital Ocean Serverless AI Inference.

## Why Does Open Innovation Matter?

I wanted to use a model that I can use locally when needed, and one in the server that doesn't change overtime without me specifically updating it. This ensures consistency and reliability in my bird watching documentation.


## Prize Categories
<!-- Which partner categories are you entering?  List every one that applies, or remove this section. -->