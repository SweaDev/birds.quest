---
title: Birds.Quest - My Effortless Bird Watching Auto Blogging Buddy that Inspires Me to Go Back to Nature
published: false
tags: devchallenge, hf26challenge, ai, automation
ai_disclosure_level: ai_assisted
---

*This is a submission for the [Hacktoberfest Open-Source AI Challenge Week 1: Touch Grass](https://dev.to/challenges/hacktoberfest-week1-2026-10-05)*

## What I Built and Why

I love watching birds, and I'm bad at writing it down. I used to enter every walk into eBird by hand. It was fun for a while, then it became homework, and homework is the opposite of touching grass.

**Birds.Quest** removes the homework. I switch on a GPS tracker, walk, and put my phone away. Later, a post about the walk shows up on my blog, written for me.

The post is not a claim that I saw these birds. The system predicts which species *anyone* could plausibly have met along my exact route at that time of year, then writes it up as "what you might see if you took this path". I open the draft, tick the birds I really saw, and hit regenerate. If I don't like the words, I edit the Markdown in a side-by-side editor. Posts are drafts until I publish them.

Two rules shaped the whole build:

1. **Location never leaves the server.** The blog and the LLM prompt contain no coordinates and no place names. The post describes birds and seasons, never where I was.
2. **Predictions are not sightings.** Everything is a draft until I approve it, and the species list is editable.

It's a tool for my own walks, but it's open source. Anyone can point it at their own Traccar server and get the same effortless blog.

## Demo

{%embed https://birds.quest %}

## Code

{%embed https://github.com/SweaDev/birds.quest %}

## Using the project

Here's a real run on a real track. I exported a GPS track from my Traccar server as a KML file: 82 positions, about 10.4 km, around 10–11 October 2026. I'm not publishing the coordinates, for the same reason the blog doesn't.

The pipeline processed it like this:

| Step | What happened |
| --- | --- |
| Discover | Traccar positions became one finished trip (more than 10 minutes, then idle). |
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

## Why Does Open Innovation Matter?

I want the same model on my laptop and on my server.

With an open-weight model I can develop offline on a 2B-class Gemma, then ship the exact same model family to production on a 31B version. I can also pin a specific model ID, so my blog's voice doesn't shift under me because someone upstream quietly retrained a hosted model. For a journal I want to keep for years, that consistency matters.

The same goes for the rest of the stack. BirdNET's GeoModel is open, so I can run it myself, and Traccar is open, so my GPS history sits on my own droplet and not in someone else's cloud. That is what makes the privacy rule realistic: my location data is only used on a machine I control, and only the species list ever goes to the inference endpoint. Because every piece is open, you can fork the repo, point it at your own Traccar and run the same thing.

## Prize Categories

- **Best Use of DigitalOcean:** the whole production deployment runs on a DigitalOcean Droplet (Traccar, MariaDB, Caddy, the Next.js app, the worker timer and git-push deploys), and post generation goes through DigitalOcean Serverless Inference.
- **Best Use of Gemma:** Gemma 4 E2B for local development and Gemma 4 31B in production write every post, behind a prompt and output filter designed so that no location data ever reaches the model.