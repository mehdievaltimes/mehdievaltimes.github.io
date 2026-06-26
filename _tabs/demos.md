---
layout: page
title: Demos
icon: fas fa-flask
order: 4
---

# The Mechanistic Sandbox

Welcome to the sandbox! The demos below run **100% locally in your browser** using WebAssembly and [Transformers.js](https://huggingface.co/docs/transformers.js/index). 

*(Note: The first time you interact with them, they will take a few seconds to download the neural networks into your browser's cache. Subsequent loads will be instant!)*

---

## 1. The Tokenizer Sandbox
Before an LLM can understand language or pay attention to it, it has to chop words up into subword "tokens." Type any sentence below and watch how the `bert-base-uncased` tokenizer slices your text into pieces in real-time. Notice how rare words (like *indubitably*) are shattered into multiple tokens!

<div id="tokenizer-app" style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px;">
  <input type="text" id="token-input" placeholder="Type a sentence here..." class="form-control mb-3" style="font-size: 1.2rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  <div id="token-output" style="display: flex; flex-wrap: wrap; gap: 8px; min-height: 40px; align-items: center; margin-top: 1rem;">
    <em class="text-muted" id="token-status">Loading Tokenizer...</em>
  </div>
</div>

---

## 2. The Semantic Brain (Embeddings)
How does a neural network know that *"The monarch rested"* is similar to *"The king sat"* even though they share no words? 

We use a feature extraction model (`all-MiniLM-L6-v2`) to turn text into a 384-dimensional dense vector space, and then calculate the **Cosine Similarity** between them! Try typing two sentences below to see their mathematical similarity.

<div id="semantic-app" style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px;">
  <input type="text" id="sem-input-1" placeholder="Sentence A (e.g. The king sat on the throne)" class="form-control mb-2" style="font-size: 1.1rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color); margin-bottom: 10px;" />
  <input type="text" id="sem-input-2" placeholder="Sentence B (e.g. The monarch rested on his chair)" class="form-control mb-3" style="font-size: 1.1rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  
  <div style="display: flex; align-items: center; gap: 1rem; margin-top: 1.5rem;">
    <div style="flex-grow: 1; background: var(--border-color); height: 24px; border-radius: 12px; overflow: hidden; position: relative;">
      <div id="similarity-bar" style="height: 100%; width: 0%; background: #2ecc71; transition: width 0.3s, background-color 0.3s;"></div>
    </div>
    <span id="similarity-score" style="font-weight: bold; font-size: 1.2rem; min-width: 60px;">0.00</span>
  </div>
  <em class="text-muted small mt-3 d-block" id="sem-status">Loading Semantic Model (80MB)... This may take a moment when you first type.</em>
</div>

---

## 3. Word-Level Attention Visualizer
*(Static Educational Demo)*

Because standard WebAssembly ONNX models drop internal attention matrices to save memory, this specific demo uses a **pre-computed** attention matrix from a real BERT model for the sentence: *"The animal didn't cross the street because it was too tired."*

Hover over **"it"** to see which noun the model mathematically decided the pronoun refers to!

<style>
  #attention-demo {
    margin: 2rem 0;
    padding: 2rem;
    background: var(--card-bg, var(--main-bg));
    border: 1px solid var(--border-color);
    border-radius: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    font-size: 1.5rem;
    font-weight: bold;
    justify-content: center;
  }
  .att-word {
    padding: 0.5rem 1rem;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.2s, transform 0.1s;
    color: var(--text-color);
  }
  .att-word:hover {
    transform: scale(1.05);
  }
</style>

<div id="attention-demo">
  <!-- Words injected via JS -->
</div>

<script type="module">
  import { pipeline, AutoTokenizer, cos_sim } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0/dist/transformers.min.js';

  // ==========================================
  // 1. Tokenizer Sandbox Logic
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('token-status');
    const inputEl = document.getElementById('token-input');
    const outputEl = document.getElementById('token-output');
    
    // Array of beautiful colors for tokens
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FDCB6E', '#6C5CE7', '#55E6C1', '#FDA7DF', '#D980FA'];
    
    try {
      const tokenizer = await AutoTokenizer.from_pretrained('Xenova/bert-base-uncased');
      statusEl.style.display = 'none';
      inputEl.placeholder = "Type a sentence here (Tokenizer Ready!)...";
      
      const renderTokens = () => {
        const text = inputEl.value;
        if (!text) {
          outputEl.innerHTML = '';
          return;
        }
        const ids = tokenizer.encode(text);
        const tokens = tokenizer.model.convert_ids_to_tokens(ids);
        
        outputEl.innerHTML = '';
        tokens.forEach((t, i) => {
          // Skip CLS and SEP if we want it cleaner, or keep them! Let's keep them.
          const badge = document.createElement('span');
          badge.style.padding = '4px 10px';
          badge.style.borderRadius = '6px';
          badge.style.color = '#fff';
          badge.style.fontWeight = 'bold';
          badge.style.fontFamily = 'monospace';
          badge.style.fontSize = '1rem';
          badge.style.backgroundColor = colors[i % colors.length];
          badge.innerText = t;
          outputEl.appendChild(badge);
        });
      };

      inputEl.addEventListener('input', renderTokens);
      // Run once on load just in case there's default text
      renderTokens();
    } catch (e) {
      statusEl.innerText = "Error loading tokenizer.";
      console.error(e);
    }
  })();

  // ==========================================
  // 2. Semantic Brain Logic
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('sem-status');
    const input1 = document.getElementById('sem-input-1');
    const input2 = document.getElementById('sem-input-2');
    const bar = document.getElementById('similarity-bar');
    const scoreText = document.getElementById('similarity-score');
    
    let extractor = null;
    let isExtracting = false;

    // Load pipeline lazily when user first clicks or types, to save initial bandwidth
    const loadPipeline = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Downloading Semantic Model (80MB)... Please wait.";
            statusEl.style.color = "#e67e22";
            try {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                statusEl.innerText = "Model loaded successfully! Type to compute similarity.";
                statusEl.style.color = "#2ecc71";
            } catch(e) {
                statusEl.innerText = "Failed to load model.";
                statusEl.style.color = "#e74c3c";
            }
        }
    };

    input1.addEventListener('focus', loadPipeline);
    input2.addEventListener('focus', loadPipeline);

    const computeSimilarity = async () => {
        if (!extractor) return;
        const text1 = input1.value;
        const text2 = input2.value;
        if (!text1 || !text2) {
            bar.style.width = '0%';
            scoreText.innerText = "0.00";
            return;
        }

        const out1 = await extractor(text1, { pooling: 'mean', normalize: true });
        const out2 = await extractor(text2, { pooling: 'mean', normalize: true });
        
        let score = cos_sim(out1.data, out2.data);
        score = Math.max(0, Math.min(1, score)); // Clamp 0 to 1 for visual
        
        scoreText.innerText = score.toFixed(2);
        bar.style.width = `${score * 100}%`;
        
        // Color gradient from red (0) to green (1)
        if (score > 0.7) bar.style.backgroundColor = '#2ecc71'; // Green
        else if (score > 0.4) bar.style.backgroundColor = '#f1c40f'; // Yellow
        else bar.style.backgroundColor = '#e74c3c'; // Red
    };

    input1.addEventListener('input', computeSimilarity);
    input2.addEventListener('input', computeSimilarity);
  })();

  // ==========================================
  // 3. Static Attention Visualizer
  // ==========================================
  document.addEventListener("DOMContentLoaded", () => {
      const words = ["The", "animal", "didn't", "cross", "the", "street", "because", "it", "was", "too", "tired", "."];
      const attentionMatrix = [
          [0.8, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1], 
          [0.1, 0.6, 0.1, 0.1, 0.0, 0.0, 0.0, 0.1, 0.0, 0.0, 0.0, 0.0], 
          [0.0, 0.2, 0.5, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1], 
          [0.0, 0.1, 0.1, 0.5, 0.1, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 
          [0.0, 0.0, 0.0, 0.1, 0.7, 0.2, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 
          [0.0, 0.0, 0.0, 0.2, 0.2, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], 
          [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.8, 0.1, 0.0, 0.0, 0.1, 0.0], 
          [0.0, 0.7, 0.0, 0.1, 0.0, 0.0, 0.1, 0.1, 0.0, 0.0, 0.0, 0.0], // it -> strong attention to 'animal'
          [0.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.1, 0.3, 0.5, 0.0, 0.0, 0.0], 
          [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 0.6, 0.3, 0.0], 
          [0.0, 0.3, 0.0, 0.0, 0.0, 0.0, 0.1, 0.1, 0.1, 0.2, 0.2, 0.0], // tired -> attends to 'animal'
          [0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.9]  
      ];

      const container = document.getElementById("attention-demo");
      if (!container) return; // in case DOM is weird
      const wordElements = [];

      words.forEach((word, index) => {
          const el = document.createElement("div");
          el.className = "att-word";
          el.innerText = word;
          el.dataset.index = index;
          container.appendChild(el);
          wordElements.push(el);
          
          el.addEventListener("mouseenter", () => {
              const focusIndex = parseInt(el.dataset.index);
              const weights = attentionMatrix[focusIndex];
              wordElements.forEach((targetEl, targetIndex) => {
                  const weight = weights[targetIndex];
                  targetEl.style.backgroundColor = `rgba(231, 76, 60, ${Math.max(0, Math.min(1, weight * 1.5))})`;
                  if (weight > 0.4) targetEl.style.color = "white";
                  else targetEl.style.color = "var(--text-color)";
              });
          });
          
          el.addEventListener("mouseleave", () => {
              wordElements.forEach(targetEl => {
                  targetEl.style.backgroundColor = "transparent";
                  targetEl.style.color = "var(--text-color)";
              });
          });
      });
  });
</script>
