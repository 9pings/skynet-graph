# Validation dossier — gsm8k-stock@v1

Dataset: **gsm8k-stock**  ·  forge: **Qwen3.6-27B-Q6_K.gguf**  ·  model calls: 108
Bundle sha256: `f88f306c3cc4fb68ab0c2943bccc94600ec5348b59120cb511028bebbc1a46d8`

| class | n | model shape | gold shape | crystallized | gold-gate |
|---|---|---|---|---|---|
| `divide>multiply` | 3 | `divide>multiply` | `divide>multiply` | no | ⛔ model-inconsistent |
| `multiply>multiply>add` | 3 | `multiply>multiply>add` | `multiply>multiply>add` | no | ⛔ model-inconsistent |
| `multiply>divide` | 3 | `divide>subtract>subtract` | `multiply>divide` | no | ⛔ model-inconsistent |
| `add>subtract` | 3 | `subtract>subtract` | `add>subtract` | yes | ⛔ model-inconsistent |
| `multiply>subtract` | 3 | `multiply>multiply>subtract` | `multiply>subtract` | yes | ⛔ model-inconsistent |
| `multiply>add` | 3 | `multiply>add` | `multiply>add` | yes | ✅ admitted |
| `subtract>divide` | 3 | `subtract>divide` | `subtract>divide` | yes | ✅ admitted |
| `multiply>multiply` | 3 | `multiply>multiply` | `multiply>multiply` | yes | ✅ admitted |
| `add>add` | 3 | `add>add` | `add>add` | yes | ⛔ model-inconsistent |
| `multiply>multiply>subtract` | 3 | `add>subtract>multiply` | `multiply>multiply>subtract` | no | ⛔ model-inconsistent |
| `divide>divide` | 3 | `divide>divide` | `divide>divide` | no | ⛔ model-inconsistent |
| `add>multiply` | 3 | `multiply>add>multiply` | `add>multiply` | no | ⛔ model-inconsistent |

## Summary
- classes attempted: **12**
- admitted (gold-verified): **3**
- FALSE admitted (shape ≠ gold): **0** (the gate keeps the stock clean)

## Soundness gates
- ✅ gold-gate: 0 false admitted (shape != gold never enters)
- ✅ stock packs to .sgc and reloads cross-deployment
- ✅ neg-control: a corrupted shape is rejected

**Verdict: ✅ PASS** — a gold-verified `.sgc` stock certified from the dataset oracle.