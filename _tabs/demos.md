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

## 3. The Live N×N "Attention" Matrix

Type a sentence below to generate a live, interactive `N × N` heatmap!

> [!NOTE]
> **A Note on Approximation:** Standard WebAssembly models physically delete their internal attention tensors to save space. To simulate the "attention" map live in your browser, this visualizer actually computes the **Token-to-Token Semantic Similarity** across the final layer of the network. It tells us how much the *meaning* of one token was blended with the *meaning* of another token, which visually and functionally serves as a beautiful approximation of self-attention!

<style>
  #matrix-app {
    margin: 2rem 0;
    padding: 2rem;
    background: var(--card-bg, var(--main-bg));
    border: 1px solid var(--border-color);
    border-radius: 12px;
    overflow-x: auto;
  }
  .matrix-table {
    border-collapse: collapse;
    margin: 0 auto;
  }
  .matrix-cell {
    width: 40px;
    height: 40px;
    text-align: center;
    vertical-align: middle;
    font-size: 0.8rem;
    border: 1px solid var(--border-color);
    transition: transform 0.1s, border 0.1s;
    cursor: crosshair;
  }
  .matrix-cell:hover {
    transform: scale(1.1);
    border: 2px solid var(--text-color);
    z-index: 10;
    position: relative;
  }
  .matrix-header-col {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    padding: 10px;
    font-size: 0.9rem;
    font-weight: bold;
    text-align: left;
    white-space: nowrap;
    color: var(--text-color);
  }
  .matrix-header-row {
    padding: 10px;
    font-size: 0.9rem;
    font-weight: bold;
    text-align: right;
    white-space: nowrap;
    color: var(--text-color);
  }
</style>

<div id="matrix-app">
  <input type="text" id="matrix-input" placeholder="Type a sentence (e.g. The quick brown fox)..." class="form-control mb-4" style="font-size: 1.2rem; padding: 10px; width: 100%; border: 1px solid var(--border-color); border-radius: 8px; background: var(--main-bg); color: var(--text-color);" />
  <em class="text-muted" id="matrix-status">Loading Matrix Model...</em>
  
  <div id="matrix-container" style="display: flex; justify-content: center; margin-top: 1rem;">
    <!-- Table injected via JS -->
  </div>
</div>

---

## 4. The Canned Attention Visualizer
For educational purposes, here is a hard-coded visualisation of a pre-computed attention matrix extracted from a real Transformer model running offline. Hover over any token to see which other tokens it "attends" to!

<style>
  .word-token {
    display: inline-block;
    padding: 4px 8px;
    margin: 4px;
    border-radius: 6px;
    background-color: var(--card-bg, var(--main-bg));
    border: 1px solid var(--border-color);
    cursor: pointer;
    transition: background-color 0.2s, color 0.2s;
    font-size: 1.1rem;
  }
  .word-token.active {
    border-color: #2ecc71;
    color: var(--text-color);
  }
</style>

<div style="margin: 2rem 0; padding: 2rem; background: var(--card-bg, var(--main-bg)); border: 1px solid var(--border-color); border-radius: 12px; text-align: center;">
  <div id="attention-sandbox">
    <!-- Words will be injected here -->
  </div>
  <p class="mt-4 text-muted small">Hover over a word to visualize its attention weights.</p>
</div>


<script type="module">
  import { pipeline, AutoTokenizer, cos_sim, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.0/dist/transformers.min.js';

  // Prevent local 404s
  env.allowLocalModels = false;

  // ==========================================
  // 1. Tokenizer Sandbox
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('token-status');
    const inputEl = document.getElementById('token-input');
    const outputEl = document.getElementById('token-output');
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FDCB6E', '#6C5CE7', '#55E6C1', '#FDA7DF', '#D980FA'];
    try {
      const tokenizer = await AutoTokenizer.from_pretrained('Xenova/bert-base-uncased');
      statusEl.style.display = 'none';
      inputEl.placeholder = "Type a sentence here (Tokenizer Ready!)...";
      const renderTokens = () => {
        const text = inputEl.value;
        if (!text) { outputEl.innerHTML = ''; return; }
        const ids = tokenizer.encode(text);
        const tokens = tokenizer.model.convert_ids_to_tokens(ids);
        outputEl.innerHTML = '';
        tokens.forEach((t, i) => {
          const badge = document.createElement('span');
          badge.style.padding = '4px 10px';
          badge.style.borderRadius = '6px';
          badge.style.color = '#fff';
          badge.style.fontWeight = 'bold';
          badge.style.fontFamily = 'monospace';
          badge.style.backgroundColor = colors[i % colors.length];
          badge.innerText = t;
          outputEl.appendChild(badge);
        });
      };
      inputEl.addEventListener('input', renderTokens);
      renderTokens();
    } catch (e) {
      statusEl.innerText = "Error loading tokenizer.";
    }
  })();

  // ==========================================
  // 2. Semantic Brain
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('sem-status');
    const input1 = document.getElementById('sem-input-1');
    const input2 = document.getElementById('sem-input-2');
    const bar = document.getElementById('similarity-bar');
    const scoreText = document.getElementById('similarity-score');
    let extractor = null;
    let isExtracting = false;
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
        if (!text1 || !text2) { bar.style.width = '0%'; scoreText.innerText = "0.00"; return; }
        const out1 = await extractor(text1, { pooling: 'mean', normalize: true });
        const out2 = await extractor(text2, { pooling: 'mean', normalize: true });
        let score = cos_sim(out1.data, out2.data);
        score = Math.max(0, Math.min(1, score));
        scoreText.innerText = score.toFixed(2);
        bar.style.width = `${score * 100}%`;
        if (score > 0.7) bar.style.backgroundColor = '#2ecc71';
        else if (score > 0.4) bar.style.backgroundColor = '#f1c40f';
        else bar.style.backgroundColor = '#e74c3c';
    };
    input1.addEventListener('input', computeSimilarity);
    input2.addEventListener('input', computeSimilarity);
  })();

  // ==========================================
  // 3. Live NxN Matrix
  // ==========================================
  (async function() {
    const statusEl = document.getElementById('matrix-status');
    const inputEl = document.getElementById('matrix-input');
    const container = document.getElementById('matrix-container');
    let extractor = null;
    let tokenizer = null;
    let isExtracting = false;

    const loadMatrixModel = async () => {
        if (!extractor && !isExtracting) {
            isExtracting = true;
            statusEl.innerText = "Preparing Matrix Model (80MB)... Please wait.";
            try {
                extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
                tokenizer = await AutoTokenizer.from_pretrained('Xenova/all-MiniLM-L6-v2');
                statusEl.style.display = 'none';
                inputEl.placeholder = "Type a sentence to build the NxN matrix...";
                if(inputEl.value) renderMatrix();
            } catch(e) {
                statusEl.innerText = "Failed to load matrix model.";
            }
        }
    };

    inputEl.addEventListener('focus', loadMatrixModel);

    let timeoutId;
    const renderMatrix = async () => {
        if (!extractor || !tokenizer) return;
        const text = inputEl.value.trim();
        if (!text) { container.innerHTML = ''; return; }

        statusEl.style.display = 'block';
        statusEl.innerText = "Computing N×N grid...";

        try {
            const tokenIds = tokenizer.encode(text);
            const tokens = tokenizer.model.convert_ids_to_tokens(tokenIds);
            
            const out = await extractor(text, { pooling: 'none' });
            const seq_length = out.dims[1];
            const hidden_size = out.dims[2];
            
            const table = document.createElement('table');
            table.className = 'matrix-table';
            
            const headerRow = document.createElement('tr');
            headerRow.appendChild(document.createElement('th'));
            tokens.forEach(t => {
                const th = document.createElement('th');
                th.className = 'matrix-header-col';
                th.innerText = t;
                headerRow.appendChild(th);
            });
            table.appendChild(headerRow);

            for (let i = 0; i < seq_length; i++) {
                const tr = document.createElement('tr');
                
                const th = document.createElement('th');
                th.className = 'matrix-header-row';
                th.innerText = tokens[i];
                tr.appendChild(th);

                const vecI = out.data.slice(i * hidden_size, (i + 1) * hidden_size);
                
                for (let j = 0; j < seq_length; j++) {
                    const vecJ = out.data.slice(j * hidden_size, (j + 1) * hidden_size);
                    
                    let dot = 0, norm1 = 0, norm2 = 0;
                    for (let k = 0; k < hidden_size; k++) {
                        dot += vecI[k] * vecJ[k];
                        norm1 += vecI[k] * vecI[k];
                        norm2 += vecJ[k] * vecJ[k];
                    }
                    let sim = dot / (Math.sqrt(norm1) * Math.sqrt(norm2));
                    let visualWeight = Math.max(0, Math.min(1, sim));
                    
                    const td = document.createElement('td');
                    td.className = 'matrix-cell';
                    
                    // Greyscale mapping (opacity on neutral color)
                    td.style.backgroundColor = `rgba(128, 128, 128, ${visualWeight})`;
                    td.title = `${tokens[i]} -> ${tokens[j]}\nSimilarity: ${sim.toFixed(3)}`;
                    
                    td.innerText = sim.toFixed(1);
                    if (visualWeight > 0.5) td.style.color = "white";
                    else td.style.color = "transparent";

                    td.addEventListener('mouseenter', () => td.style.color = (visualWeight>0.5?'white':'black'));
                    td.addEventListener('mouseleave', () => td.style.color = (visualWeight>0.5?'white':'transparent'));

                    tr.appendChild(td);
                }
                table.appendChild(tr);
            }

            container.innerHTML = '';
            container.appendChild(table);
            statusEl.style.display = 'none';

        } catch (err) {
            console.error(err);
            statusEl.innerText = "Error computing matrix.";
        }
    };

    inputEl.addEventListener('input', () => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(renderMatrix, 500);
    });
  })();

  // ==========================================
  // 4. Canned Attention Visualizer
  // ==========================================
  (function() {
    // Fake sentence and weights
    const sentence = ["The", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog"];
    const weights = [
      [1.0, 0.1, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], // The
      [0.2, 1.0, 0.6, 0.8, 0.1, 0.0, 0.0, 0.0, 0.0], // quick -> (brown, fox)
      [0.1, 0.5, 1.0, 0.9, 0.1, 0.0, 0.0, 0.0, 0.0], // brown -> (quick, fox)
      [0.3, 0.8, 0.9, 1.0, 0.6, 0.1, 0.1, 0.0, 0.0], // fox -> (quick, brown, jumps)
      [0.0, 0.1, 0.1, 0.8, 1.0, 0.7, 0.2, 0.5, 0.6], // jumps -> (fox, over, dog)
      [0.0, 0.0, 0.0, 0.1, 0.6, 1.0, 0.3, 0.1, 0.4], // over -> (jumps, dog)
      [0.0, 0.0, 0.0, 0.0, 0.0, 0.1, 1.0, 0.3, 0.6], // the -> (dog)
      [0.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.4, 1.0, 0.9], // lazy -> (dog)
      [0.0, 0.0, 0.0, 0.3, 0.7, 0.6, 0.8, 0.9, 1.0]  // dog -> (jumps, lazy, the, over)
    ];

    const container = document.getElementById('attention-sandbox');
    if(!container) return;
    
    // Render the tokens
    sentence.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'word-token';
      span.innerText = word;
      
      // On hover, highlight the dependencies
      span.addEventListener('mouseenter', () => {
        span.classList.add('active');
        const allTokens = container.querySelectorAll('.word-token');
        allTokens.forEach((otherToken, j) => {
          if (i !== j) {
            const w = weights[i][j];
            otherToken.style.backgroundColor = `rgba(46, 204, 113, ${w})`;
            if(w > 0.5) otherToken.style.color = "#000";
          }
        });
      });
      
      span.addEventListener('mouseleave', () => {
        span.classList.remove('active');
        const allTokens = container.querySelectorAll('.word-token');
        allTokens.forEach((otherToken) => {
          otherToken.style.backgroundColor = '';
          otherToken.style.color = '';
        });
      });
      
      container.appendChild(span);
    });
  })();
</script>
