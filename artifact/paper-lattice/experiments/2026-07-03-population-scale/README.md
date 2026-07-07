# 2026-07-03-population-scale — vendored shared helper

This directory carries `ask-memo.js`, the shared **durable-ask memo** helper (content-addressed
replay of model calls) that the `2026-07-03-lattice-riddles` and `2026-07-03-defab-gext` campaigns
require at `../2026-07-03-population-scale/ask-memo.js`. The population-scale campaign itself is not
part of this reproducibility package — only the helper the shipped campaigns need to replay their
tables bit-for-bit from their local `memo/` stores, without a GPU.
