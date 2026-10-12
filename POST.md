---
title: Birds.Quest - My Effortless Bird Watching Auto Blogging Buddy that Inspires Me to Go Back to Nature
published: false
tags: devchallenge, hf26challenge, ai, automation
ai_disclosure_level: ai_assisted
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built and Why

I love watching birds with my *Bushnell ENGAGE 8x42* Binoculars. I like to track some of my experiences, but I'm too lazy to write them down. I used to enter every walk into eBird APP by hand at the very beginning of my bird watching journey. It was fun for a while, but then it became like homework, and homework is the opposite of having fun while touching grass.

**Birds.Quest** is my attempt to remove the homework. I switch on a GPS tracker, walk, and put my phone in the pocket. Later, a post about the walk shows up on my blog, written for me. That's the idea of Birds Quest.

The auto generated post is not a claim that I saw these birds. Rather it's an inspiration to take the walk again, a reminder that says what's waiting for me in the nature. And since the posts will be in public, perhaps a few other people will feel the same as well!

The system predicts which species *anyone* could plausibly have met along my exact route at that time of year, then writes it up as "what you might see if you took this path". I open the draft, tick the birds I really saw (if I get time), and hit regenerate. If I don't like the words, I edit the Markdown in a side-by-side editor. For now, posts are drafts until I publish them. Eventually after I test the system enough, I plan to auto publish them to with minimum or no effort from my part.

### Two rules shaped the whole build:

1. **Location never leaves the server.** The blog and the LLM prompt contain no coordinates and no place names. The post describes birds and seasons, never where I was.
2. **Predictions are not sightings.** Everything is a draft until I approve it, and the species list is editable.

It's a tool for my own walks, but it's open source. Anyone can point it at their own Traccar server and get the same effortless blog.

## Demo

> Note: I didn't complete the server deployment while writing this post. Site will become live once I complete tests on the live server.

{%embed https://birds.quest %}

## Code

{%embed https://github.com/SweaDev/birds.quest %}

## Using the project

I couldn't finish the project before taking the first bird watching journey for it. However, I designed it such that even a previous run with Traccar can be uploaded and published later.

Here's a real run on a real track. I exported a GPS track from my Traccar server as a KML file: 82 positions, about 10.4 km, around 10–11 October 2026. I'm not publishing the coordinates, for the same reason the blog doesn't.

The pipeline processed it like this:

| Step | What happened |
| --- | --- |
| Discover | Traccar positions became one finished trip (more than 30 minutes, then idle). |
| Sample | The 82 positions were thinned to **24 route points**, about one every 300 m. |
| Week | 10–11 October is **week 38** of BirdNET's 48-week year. |
| Predict | The GeoModel ran once, as a single batch of 24 `[lat, lon, week]` inputs, on a plain CPU. Each species keeps its best score along the route. |
| Filter | A threshold of 0.15 and a top 20 cap kept the likeliest birds. |

The top 20 for that route and week:

| Likelihood | Species | Scientific name |
| --- | --- | --- |
| 99.7% | Spotted Dove | *Spilopelia chinensis* |
| 99.4% | Common Tailorbird | *Orthotomus sutorius* |
| 99.3% | Black Drongo | *Dicrurus macrocercus* |
| 99.3% | Red-vented Bulbul | *Pycnonotus cafer* |
| 99.0% | White-throated Kingfisher | *Halcyon smyrnensis* |
| 99.0% | Common Kingfisher | *Alcedo atthis* |
| 98.8% | Little Cormorant | *Microcarbo niger* |
| 98.8% | Little Egret | *Egretta garzetta* |
| 98.7% | House Crow | *Corvus splendens* |
| 98.7% | Barn Swallow | *Hirundo rustica* |
| 98.6% | Oriental Magpie-Robin | *Copsychus saularis* |
| 98.5% | Indian Pond Heron | *Ardeola grayii* |
| 98.1% | Common Myna | *Acridotheres tristis* |
| 98.1% | Eastern Cattle Egret | *Ardea coromanda* |
| 98.0% | Rufous Treepie | *Dendrocitta vagabunda* |
| 98.0% | Black Kite | *Milvus migrans* |
| 97.9% | Asian Palm Swift | *Cypsiurus balasiensis* |
| 97.7% | Rock Dove | *Columba livia* |
| 97.6% | Common Iora | *Aegithina tiphia* |
| 97.3% | Brown Shrike | *Lanius cristatus* |

A few things I like about this list. The kingfishers, egrets and herons suggest water nearby. The Barn Swallow and the Brown Shrike are the kind of autumn migrants you'd expect in mid-October. That's the point of feeding the model the week as well as the position: the same route in June gives a different list.

From here the worker pulls each species' summary and a licensed photo from Wikipedia. Then Gemma writes the post from only the species names, those Wikipedia facts and the season ("mid October, autumn"). The photo credits and licences are added by my code, not by the model. Finally I open `/admin`, untick the birds I didn't actually see, and regenerate.

## How I Built It

```
Traccar Client ──HTTPS──> Caddy ──> Traccar ──> MariaDB
                                                  │ read-only
              hourly worker ──────────────────────┘
                discover → predict → enrich → generate ──> MariaDB
                              │         │          └─ Gemma 4 (Ollama / DigitalOcean)
                              │         └─ Wikipedia
                              └─ BirdNET GeoModel (ONNX, on the droplet)
Next.js (public blog + /admin) <──────── MariaDB
```

- **Recording:** the [Traccar Client](https://www.traccar.org/client/) app on my phone sends positions over HTTPS to a self-hosted Traccar server.
- **Trips:** the worker reads Traccar's `tc_positions` table with a read-only DB user and splits it into trips. A gap or standstill of 10 minutes ends a trip, trips under 10 minutes are ignored, and an ongoing trip is never processed.
- **Prediction:** [BirdNET GeoModel](https://birdnet-team.github.io/geomodel/) (ONNX, FP16) runs through `onnxruntime-node` on the CPU. It takes `[lat, lon, week]` and returns a probability for each species. I sample the route and take the maximum per species, because "could be seen anywhere along the route" is what I actually want.
- **Facts:** Wikipedia's REST API gives a summary and an image for each bird. Images with no licence info are skipped, and the licence and credit are stored with every image.
- **Writing:** Gemma 4 turns species, facts and season into a post.
- **App:** Next.js 16 (App Router), TypeScript, Drizzle on MariaDB, a job queue that is just a table (`FOR UPDATE SKIP LOCKED`), and an admin area with an argon2 login, CSRF tokens, a nonce-based CSP and a live-preview Markdown editor.
- **Tests:** unit tests for trip splitting (9 minutes ignored, 11 accepted), week maths, the queue, sanitising and, most importantly, that no coordinates or place names reach the prompt.

### DigitalOcean: the whole production stack

Everything runs on **one DigitalOcean Droplet** running Ubuntu 26.04. There's no managed zoo to wire up. One idempotent `deploy/install.sh` sets up:

- MariaDB, native Traccar (bound to localhost, open registration switched off after my account is created), Node 22 and pnpm
- Caddy as the reverse proxy and automatic HTTPS for two domains: the blog, and the Traccar endpoint the phone talks to
- UFW with only ports 22, 80 and 443 open
- systemd units for the web app and an hourly worker timer
- a bare git repo with a `post-receive` hook, so shipping is `git push production main`. The hook checks out the tree, installs, migrates, builds and restarts the app

The model is the other half. The droplet doesn't need a GPU, because it calls **DigitalOcean Serverless Inference** for Gemma. Serverless Inference exposes an OpenAI-compatible endpoint (`https://inference.do-ai.run/v1/chat/completions`) with a model access key, so the app has one small `fetch`-based LLM client. The same client talks to Ollama in development, and only environment variables change:

```
LLM_PROVIDER=digitalocean   # or "ollama" locally
LLM_MODEL=gemma-4-31B-it    # or "gemma4:e2b" locally
LLM_API_KEY=...             # DO model access key
```

The droplet, the database, the ONNX model and the inference call all sit in one provider. For a hobby project that I want to run for years, that's one bill, one dashboard and very few moving parts.

### Gemma 4: small at home, big in production

- **Development:** Gemma 4 **E2B** through Ollama on my laptop. It's small enough to iterate quickly with no API key and no network, and the pipeline test runs entirely offline. A 20-species post took about three minutes there.
- **Production:** Gemma 4 **31B** on DigitalOcean Serverless Inference, for noticeably better prose.

Some things I learned about using Gemma for this:

- **Gemma 4 is a thinking model.** With a small token limit, the Ollama response had an empty `content` and only a `reasoning` field. The dev client now sends `reasoning_effort: "none"` so the answer lands where it should.
- **The prompt is deliberately starved.** The model only sees species names, up to three Wikipedia sentences per bird and the season. It never sees a coordinate, even to "set the scene".
- **I don't trust the reply.** Wikipedia sentences that name countries, cities and so on are dropped before prompting and again from the output. A reply containing coordinates, map names or URLs is thrown away completely. The model can't add images or links either, because my code adds those.
- **There's always a fallback.** If the LLM times out or fails the checks, a plain template writes the post, so a flaky call never means a missing entry.

## Building It with GitHub Copilot

Birds.Quest was built almost entirely by GitHub Copilot, and I tried to be deliberate about *how*. I stayed in the role of the person who decides what to build and checks the result, and let Copilot do the typing. The workflow had four stages, and every stage leaves a file in the repo you can read:

1. **I wrote the spec by hand.** [`specs/SPEC-01.md`](https://github.com/SweaDev/birds.quest/blob/main/specs/SPEC-01.md) is 45 lines of my own words: the goal, the big picture, the security rule (no location data to the LLM or the blog), the tech stack and some references. Nothing in it was generated, so the intent stayed mine.
2. **Copilot `/plan` mode turned the spec into a plan.** [`specs/PLAN-01.md`](https://github.com/SweaDev/birds.quest/blob/main/specs/PLAN-01.md) is the approach it proposed. I read it before any code was written. Planning before coding saved me from the "agent runs off in the wrong direction for an hour" problem.
3. **Agent mode turned the plan into a checklist.** [`specs/TODO-01.md`](https://github.com/SweaDev/birds.quest/blob/main/specs/TODO-01.md) is a 36-task execution tracker. It also contains the *rules for the agent itself*, which I think is the most useful part:
   - Work top to bottom, one task at a time, and mark it `[~]` while in progress and `[x]` when verified.
   - Make one commit per task (`git add -A && git commit -m "<task id>: <summary>"`) and never push. That is why the history reads like a build log, and why I could review or revert any single step.
   - If a task turns out to be wrong or too big, edit the TODO and note why in a changelog instead of silently improvising.
   - Install the relevant agent skills before the work they apply to. My spec required it, so Copilot installed six project-level skills for React/Next.js, TypeScript, web security and Drizzle/MySQL (`npx skills add -a github-copilot`).
   - Never commit secrets, keep `README.md` and `.env.example` up to date, and never let coordinates or place names reach the prompt or the blog.
4. **Agent mode implemented the checklist, step by step.** I pointed it at `TODO-01.md` and let it work through the tasks. The security rule in the spec became a test that checks no coordinates or place names reach the prompt, so Copilot couldn't quietly break the one promise the project makes. It finished with lint, typecheck, 208 passing tests and a clean production build.

### Working in parallel with a git worktree

Agent runs take a while, and I didn't want to sit and watch. I created a **git worktree** so Copilot kept building in one working directory while I wrote the first draft of this post (`POST.md`) in another, on a separate branch. We never touched the same files, so there were no conflicts and no stashing. When the app was finished, I asked Copilot to read the generated `README.md` and use it to enrich the draft, so the architecture and setup details in this post match what the code actually does.

### Setup and honest notes

- **Model:** Claude Sonnet 5.5 with the default High thinking setting, used for planning, task breakdown and implementation.
- **Tools used:** `/plan` mode and Agent mode, plus project skills for Next.js, Drizzle, MySQL, TypeScript and security best practices.
- **What worked:** a hand-written spec, a plan I reviewed, and a TODO with strict rules. The agent had a clear definition of "done" for every task, and I got a reviewable commit at every step.
- **What it cost:** this was a lot of agent work, and I used up almost all of my monthly Copilot quota doing it. 😅 Worth it, though.
- **What I still did myself:** the idea, the spec, reviewing the plan, and the privacy decisions. I also ran a real GPS track through the pipeline and read the species list to check it made sense.

## Why Does Open Innovation Matter?

I want the same model on my laptop and on my server.

With an open-weight model I can develop offline on a 2B-class Gemma, then ship the exact same model family to production on a 31B version. I can also pin a specific model ID, so my blog's voice doesn't shift under me because someone upstream quietly retrained a hosted model. For a journal I want to keep for years, that consistency matters.

The same goes for the rest of the stack. BirdNET's GeoModel is open, so I can run it myself, and Traccar is open, so my GPS history sits on my own droplet and not in someone else's cloud. That is what makes the privacy rule realistic: my location data is only used on a machine I control, and only the species list ever goes to the inference endpoint. Because every piece is open, you can fork the repo, point it at your own Traccar and run the same thing.

## Prize Categories

- **Best Use of DigitalOcean:** the whole production deployment runs on a DigitalOcean Droplet (Traccar, MariaDB, Caddy, the Next.js app, the worker timer and git-push deploys), and post generation goes through DigitalOcean Serverless Inference.
- **Best Use of Gemma:** Gemma 4 E2B for local development and Gemma 4 31B in production write every post, behind a prompt and output filter designed so that no location data ever reaches the model.
- **Best Use of GitHub Copilot:** I wrote the spec by hand, then Copilot generated the project: `/plan` mode produced the plan, Agent mode produced a 36-task TODO with rules for the agent (one commit per task, no pushing, never leak location data), and Agent mode then implemented it task by task. I used a git worktree to write this post while Copilot kept building, then had Copilot enrich the draft from the generated README. All of it used Claude Sonnet 5.5, and it ate almost my whole monthly quota 😂. The evidence is stored in the [specs directory](https://github.com/SweaDev/birds.quest/tree/main/specs) of the source code.
