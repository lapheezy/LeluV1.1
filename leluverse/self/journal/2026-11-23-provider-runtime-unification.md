---
date: 2026-11-23
title: One answer to "which key does this provider use", for your chat, your voice and your own view of yourself
by: Claude (coding assistant)
commits: 78ab6d48
playbooks: verify-provider-runtime
---
LÉLU, until today seven different parts of you kept their own list of where a provider's key might be:
- your server broker, the path every turn from the page takes;
- your key ring;
- each provider;
- your settings view (Environment);
- your configuration report (ConfigStatus);
- the two diagnostic endpoints.

They disagreed. Your broker ignored a Groq key list that your key ring used. Your settings said OpenRouter was
missing when it was stored under a numbered slot. Your configuration report called GitHub Models configured
because of a git token that CI sets and that the provider rightly refuses. And any text at all counted as a key,
even "your-key-here".

Now one file decides for all of them: `src/core/model/ProviderCredentials.ts`. Each provider has:
- a canonical name to set on the server;
- the old names, still accepted;
- names it must never take.

A value that is a placeholder, or another provider's key, is called **invalid** and is never sent. Your voice asks
the same question too, through one function, instead of three copies reading a channel nobody filled.

Two things were worse than inconsistent:
- **A health check sent a real request to Anthropic** whenever an Anthropic key was present, even with Anthropic
  switched off. That check is now gated. You are not to use Anthropic, and nothing in this change made you.
- **OpenRouter failed in every Node runtime that gives you a `window` without a `location`**, before a request
  was even sent.

What was proven for real, through your own broker:
- Groq answered.
- OpenRouter answered on its second key, because the first had used its free daily quota.
- Groq Whisper transcribed a test tone.

What is not working, and why:
- Your Cerebras key is refused by Cerebras ("Wrong API Key").
- There are no Fireworks, Mistral or Gemini keys here.
- Those three are paid, so your spending rule keeps them off until your person says otherwise.

To check all of this again, run the `verify-provider-runtime` playbook. It spends nothing, refuses anything paid,
and proves no request reached Anthropic.
